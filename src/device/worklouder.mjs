import { lightingForSlots } from "./palette.mjs";
import {
  inspectNativeMicroRuntime,
  NativeMicroTransport,
  threadLightingMessage,
} from "./native-transport.mjs";

export class WorkLouderDevice {
  constructor({
    transportFactory = () => new NativeMicroTransport(),
    runtime = inspectNativeMicroRuntime(),
    logger = console,
    onAgentKey = () => {},
    onVoiceButton = () => {},
    onSubmitButton = () => {},
    onDeviceDisconnect = () => {},
  } = {}) {
    this.transportFactory = transportFactory;
    this.runtime = runtime;
    this.logger = logger;
    this.onAgentKey = onAgentKey;
    this.onVoiceButton = onVoiceButton;
    this.onSubmitButton = onSubmitButton;
    this.onDeviceDisconnect = onDeviceDisconnect;
    this.transport = null;
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
    this.submitPressed = false;
  }

  status() {
    return {
      state: this.state,
      error: this.lastConnectionError,
      runtime: this.transport?.metadata() ?? this.runtime,
      lastEventAt: this.lastEventAt,
      lastEvent: this.lastEvent,
    };
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.state = "waiting";
    await this.connect().catch((error) => this.reportConnectionError(error));
    this.reconnectTimer = setInterval(() => {
      if (this.started && !this.transport) {
        this.connect().catch((error) => this.reportConnectionError(error));
      }
    }, 3000);
  }

  reportConnectionError(error) {
    const message = error?.message ?? String(error);
    this.state = message === "Codex Micro was not found." ? "waiting" : "error";
    if (message === this.lastConnectionError) return;
    this.lastConnectionError = message;
    if (this.state === "waiting") {
      if (!this.deviceMissingLogged) {
        this.logger.info("Codex Micro not detected. Waiting for a connection...");
        this.deviceMissingLogged = true;
      }
      return;
    }
    this.logger.error(
      `Could not open Codex Micro: ${message}. Retrying automatically...`,
    );
  }

  async connect() {
    if (!this.started || this.transport) return Boolean(this.transport);
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
    const transport = this.transportFactory();
    let connectionEnded = false;
    try {
      await transport.connect({
        onEvent: (event) => this.handleHidEvent(event),
        onDisconnect: (error) => {
          connectionEnded = true;
          if (this.transport !== transport) return;
          this.logger.info(
            "Codex Micro disconnected. Waiting for a connection...",
          );
          this.lastEventAt = new Date().toISOString();
          this.lastEvent = {
            type: "connection",
            action: "disconnected",
            at: this.lastEventAt,
          };
          this.disconnect(transport, { close: false })
            .then(() => {
              if (error) this.reportConnectionError(error);
            })
            .catch((cleanupError) =>
              this.reportConnectionError(cleanupError),
            );
        },
      });
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
    if (!this.started || connectionEnded) {
      await transport.close().catch(() => {});
      if (this.started) this.state = "waiting";
      return false;
    }

    this.transport = transport;
    this.runtime = transport.metadata();
    this.state = "connected";
    this.lastConnectionError = null;
    this.deviceMissingLogged = false;
    this.lastEventAt = new Date().toISOString();
    this.lastEvent = {
      type: "connection",
      action: "connected",
      at: this.lastEventAt,
    };
    this.logger.info("Codex Micro connected.");
    if (this.lastSlots.length) await this.render(this.lastSlots);
    return true;
  }

  handleHidEvent(event) {
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
      return;
    }
    if (event.key === "ACT12" && (event.act === 0 || event.act === 1)) {
      const pressed = event.act === 1;
      if (pressed === this.submitPressed) return;
      this.submitPressed = pressed;
      if (!pressed) return;
      this.lastEventAt = new Date().toISOString();
      this.lastEvent = {
        type: "submit",
        action: "press",
        at: this.lastEventAt,
      };
      Promise.resolve()
        .then(() => this.onSubmitButton())
        .catch((error) => {
          this.logger.error(
            `Send key action failed: ${error?.message ?? String(error)}`,
          );
        });
    }
  }

  async render(slots) {
    this.lastSlots = slots;
    if (!this.transport) return false;
    await this.transport.send(
      threadLightingMessage(lightingForSlots(slots)),
    );
    return true;
  }

  async disconnect(
    expectedTransport = this.transport,
    { close = true } = {},
  ) {
    if (
      expectedTransport &&
      this.transport &&
      this.transport !== expectedTransport
    ) {
      return false;
    }
    const wasConnected = this.transport === expectedTransport;
    if (wasConnected) this.transport = null;
    this.submitPressed = false;
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
    if (close) await expectedTransport?.close();
    if (this.started) this.state = "waiting";
    return true;
  }

  async stop() {
    this.started = false;
    this.state = "stopping";
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.reconnectTimer = null;
    await this.connectPromise?.catch(() => {});
    try {
      if (this.transport) {
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
      this.state = "stopped";
      this.lastConnectionError = null;
      this.deviceMissingLogged = false;
      this.voicePressed = false;
    }
  }
}

export class MockDevice {
  constructor({
    logger = console,
    onAgentKey = () => {},
    onVoiceButton = () => {},
    onSubmitButton = () => {},
    onDeviceDisconnect = () => {},
  } = {}) {
    this.logger = logger;
    this.onAgentKey = onAgentKey;
    this.onVoiceButton = onVoiceButton;
    this.onSubmitButton = onSubmitButton;
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
