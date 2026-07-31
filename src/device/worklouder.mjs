import { lightingForSlots } from "./palette.mjs";
import { createDeviceProvider } from "./provider.mjs";

export class WorkLouderDevice {
  constructor({
    provider = createDeviceProvider(),
    logger = console,
    onAgentKey = () => {},
    onVoiceButton = () => {},
    onDeviceDisconnect = () => {},
  } = {}) {
    this.provider = provider;
    this.logger = logger;
    this.onAgentKey = onAgentKey;
    this.onVoiceButton = onVoiceButton;
    this.onDeviceDisconnect = onDeviceDisconnect;
    this.comm = null;
    this.api = null;
    this.unsubscribeHid = null;
    this.unsubscribeConnection = null;
    this.reconnectTimer = null;
    this.connectPromise = null;
    this.started = false;
    this.state = "stopped";
    this.lastSlots = [];
    this.lastConnectionError = null;
    this.deviceMissingLogged = false;
    this.lastEventAt = null;
    this.lastEvent = null;
    this.voicePressed = false;
  }

  status() {
    return {
      state: this.state,
      error: this.lastConnectionError,
      runtime: this.provider.metadata(),
      lastEventAt: this.lastEventAt,
      lastEvent: this.lastEvent,
    };
  }

  loadLibrary() {
    return this.provider.load();
  }

  async start() {
    if (this.started) return;
    const kit = await this.loadLibrary();
    this.kit = kit;
    this.started = true;
    this.state = "waiting";
    await this.connect().catch((error) => this.reportConnectionError(error));
    this.reconnectTimer = setInterval(() => {
      if (this.started && !this.api) {
        this.connect().catch((error) => this.reportConnectionError(error));
      }
    }, 3000);
  }

  reportConnectionError(error) {
    const message = error?.message ?? String(error);
    this.state = "error";
    if (message === this.lastConnectionError) return;
    this.lastConnectionError = message;
    this.logger.error(
      `Could not open Codex Micro: ${message}. Retrying automatically...`,
    );
  }

  async connect() {
    if (!this.started || this.api) return Boolean(this.api);
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.openConnection();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async openConnection() {
    this.state = "connecting";
    const discovery = new this.kit.WLDeviceDiscovery();
    const codexMicroType =
      this.kit.DeviceType.CodexMicro ?? this.kit.DeviceType.Project2077;
    if (!codexMicroType) {
      throw new Error("This ChatGPT build does not include Codex Micro support.");
    }
    const devices = discovery.findWLDevices([codexMicroType]);
    if (!devices.length) {
      if (!this.deviceMissingLogged) {
        this.logger.info("Codex Micro not detected. Waiting for a connection...");
        this.deviceMissingLogged = true;
      }
      this.state = "waiting";
      return false;
    }
    this.deviceMissingLogged = false;

    const comm = new this.kit.WLDeviceCommImpl();
    const api = new this.kit.RPCApiOAI(comm);
    let connectionEnded = false;
    const unsubscribeConnection = comm.onConnectionEvent((event) => {
      if (
        event.type === this.kit.ConnectionEventType.DISCONNECTED ||
        event.type === this.kit.ConnectionEventType.ERROR
      ) {
        connectionEnded = true;
        unsubscribeConnection?.();
        if (this.comm !== comm) {
          comm.disconnect().catch((error) => this.reportConnectionError(error));
          return;
        }
        this.logger.info(
          "Codex Micro disconnected. Waiting for a connection...",
        );
        this.lastEventAt = new Date().toISOString();
        this.disconnect(comm).catch((error) =>
          this.reportConnectionError(error),
        );
      }
    });
    try {
      await comm.connect(devices[0]);
    } catch (error) {
      unsubscribeConnection?.();
      await comm.disconnect().catch(() => {});
      throw error;
    }
    if (!this.started || connectionEnded) {
      unsubscribeConnection?.();
      await comm.disconnect().catch(() => {});
      if (this.started) this.state = "waiting";
      return false;
    }
    this.comm = comm;
    this.api = api;
    this.unsubscribeConnection = unsubscribeConnection;
    this.state = "connected";
    this.lastConnectionError = null;
    this.lastEventAt = new Date().toISOString();
    this.lastEvent = {
      type: "connection",
      action: "connected",
      at: this.lastEventAt,
    };
    this.unsubscribeHid = api.onHidReceived((event) => {
      const match = /^AG0([0-5])$/.exec(event.key);
      if (event.act === 1 && match) {
        this.lastEventAt = new Date().toISOString();
        this.lastEvent = {
          type: "agent-key",
          action: "press",
          at: this.lastEventAt,
        };
        Promise.resolve()
          .then(() => this.onAgentKey(Number(match[1])))
          .catch((error) => {
            this.logger.error(
              `Agent Key action failed: ${error?.message ?? String(error)}`,
            );
          });
        return;
      }
      if (
        event.key === "ACT10" &&
        (event.act === 0 || event.act === 1)
      ) {
        const action = event.act === 1 ? "press" : "release";
        if (
          (action === "press" && this.voicePressed) ||
          (action === "release" && !this.voicePressed)
        ) {
          return;
        }
        this.voicePressed = action === "press";
        this.lastEventAt = new Date().toISOString();
        this.lastEvent = {
          type: "voice",
          action,
          at: this.lastEventAt,
        };
        Promise.resolve()
          .then(() => this.onVoiceButton(action))
          .catch((error) => {
            this.logger.error(
              `Voice input action failed: ${error?.message ?? String(error)}`,
            );
          });
      }
    });
    this.logger.info("Codex Micro connected.");
    if (this.lastSlots.length) await this.render(this.lastSlots);
    return true;
  }

  async render(slots) {
    this.lastSlots = slots;
    if (!this.api) return false;
    return this.api.sendThreadsLighting(lightingForSlots(slots));
  }

  async disconnect(expectedComm = this.comm) {
    if (expectedComm && this.comm !== expectedComm) return false;
    const wasConnected = Boolean(this.comm);
    this.unsubscribeHid?.();
    this.unsubscribeHid = null;
    this.unsubscribeConnection?.();
    this.unsubscribeConnection = null;
    if (this.voicePressed) {
      this.voicePressed = false;
      await Promise.resolve(this.onVoiceButton("release")).catch((error) => {
        this.logger.error(
          `Voice input release failed: ${error?.message ?? String(error)}`,
        );
      });
    }
    if (wasConnected) {
      await Promise.resolve(this.onDeviceDisconnect()).catch((error) => {
        this.logger.error(
          `Could not stop voice input after Codex Micro disconnected: ${error?.message ?? String(error)}`,
        );
      });
    }
    const comm = this.comm;
    this.comm = null;
    this.api = null;
    try {
      await comm?.disconnect();
    } finally {
      if (this.started) this.state = "waiting";
    }
    return true;
  }

  async stop() {
    this.started = false;
    this.state = "stopping";
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    await this.connectPromise?.catch(() => {});
    try {
      if (this.api) {
        await this.render(
          Array.from({ length: 6 }, (_, slot) => ({
            slot,
            state: "off",
            selected: false,
          })),
        );
      }
    } catch (error) {
      this.logger.error(`Could not clear Codex Micro lighting: ${error.message}`);
    } finally {
      await this.disconnect().catch((error) => {
        this.logger.error(`Could not disconnect Codex Micro: ${error.message}`);
      });
      try {
        this.provider.close();
      } finally {
        this.kit = null;
        this.state = "stopped";
        this.lastConnectionError = null;
        this.deviceMissingLogged = false;
        this.voicePressed = false;
      }
    }
  }
}

export class MockDevice {
  constructor({
    logger = console,
    onAgentKey = () => {},
    onVoiceButton = () => {},
    onDeviceDisconnect = () => {},
  } = {}) {
    this.logger = logger;
    this.onAgentKey = onAgentKey;
    this.onVoiceButton = onVoiceButton;
    this.onDeviceDisconnect = onDeviceDisconnect;
    this.started = false;
  }
  async start() {
    this.started = true;
    this.logger.info("Mock Codex Micro enabled.");
  }
  status() {
    return { state: this.started ? "connected" : "stopped", error: null };
  }
  async render(slots) {
    this.logger.info(
      slots.map((slot) => `${slot.slot + 1}:${slot.state}`).join("  "),
    );
    return true;
  }
  async stop() {
    if (this.started) await this.onDeviceDisconnect();
    this.started = false;
  }
}
