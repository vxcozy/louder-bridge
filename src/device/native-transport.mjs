import { spawn } from "node:child_process";
import { isNativeExecutable } from "../macos/native-executable.mjs";

const MAX_LINE_BYTES = 64 * 1024;
const STARTUP_TIMEOUT_MS = 3000;
const COMMAND_TIMEOUT_MS = 1000;
const CLOSE_TIMEOUT_MS = 1000;
const RUNTIME_ID = "native-iokit-protocol";
const RUNTIME_SUPPORT = "experimental";

export function inspectNativeMicroRuntime({
  launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
} = {}) {
  const available = isNativeExecutable(launcher);
  return {
    id: RUNTIME_ID,
    support: RUNTIME_SUPPORT,
    version: null,
    available,
    error: available
      ? null
      : "The installed Codex Micro driver is unavailable.",
  };
}

export function threadLightingMessage(lights) {
  return {
    m: "v.oai.thstatus",
    p: lights.map((light) => ({
      id: light.id,
      c: light.color,
      b: light.brightness,
      e: light.effect,
      s: light.speed,
      sk: light.syncKeysLighting ? 1 : 0,
      sa: light.syncAmbientLighting ? 1 : 0,
    })),
  };
}

export class NativeMicroTransport {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    spawnProcess = spawn,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    commandTimeoutMs = COMMAND_TIMEOUT_MS,
    closeTimeoutMs = CLOSE_TIMEOUT_MS,
  } = {}) {
    this.launcher = launcher;
    this.spawnProcess = spawnProcess;
    this.startupTimeoutMs = startupTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.closeTimeoutMs = closeTimeoutMs;
    this.child = null;
    this.connected = false;
    this.closing = false;
    this.transport = null;
    this.deviceStatus = null;
    this.stderr = "";
    this.onEvent = () => {};
    this.onDisconnect = () => {};
    this.disconnectReported = false;
  }

  metadata() {
    return {
      id: RUNTIME_ID,
      support: RUNTIME_SUPPORT,
      version: this.deviceStatus?.version ?? null,
      transport: this.transport,
    };
  }

  async connect({ onEvent = () => {}, onDisconnect = () => {} } = {}) {
    if (!isNativeExecutable(this.launcher)) {
      throw new Error("The installed Codex Micro driver is unavailable.");
    }
    if (this.child) return this.metadata();
    this.onEvent = onEvent;
    this.onDisconnect = onDisconnect;
    this.closing = false;
    this.disconnectReported = false;

    const child = this.spawnProcess(this.launcher, ["--micro-device"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.close().catch(() => {});
        reject(new Error("Codex Micro did not answer the device status check."));
      }, this.startupTimeoutMs);

      const finishStartup = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(this.metadata());
      };

      const processLine = (line) => {
        if (!line) return;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        const control = message?._louder;
        if (control?.type === "connected") {
          this.connected = true;
          this.transport = control.transport ?? "Unknown";
          this.deviceStatus = control.status ?? null;
          finishStartup();
          return;
        }
        if (control?.type === "disconnected") {
          this.reportDisconnect();
          return;
        }
        if (message?.m === "v.oai.hid" && message.p) {
          this.onEvent({
            key: message.p.k,
            act: message.p.act,
            agent: message.p.ag,
          });
        }
      };

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
        for (;;) {
          const newline = stdout.indexOf("\n");
          if (newline < 0) break;
          const line = stdout.slice(0, newline).trim();
          stdout = stdout.slice(newline + 1);
          processLine(line);
        }
        if (Buffer.byteLength(stdout) > MAX_LINE_BYTES) {
          finishStartup(new Error("Codex Micro sent an oversized response."));
          this.close().catch(() => {});
        }
      });
      child.stderr.on("data", (chunk) => {
        this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-4096);
      });
      child.once("error", (error) => {
        finishStartup(error);
        this.reportDisconnect(error);
      });
      child.once("exit", (code, signal) => {
        const detail = this.stderr.trim();
        const error =
          code === 0 || this.closing
            ? null
            : new Error(
                detail ||
                  `Codex Micro driver exited (${signal ?? `code ${code}`}).`,
              );
        finishStartup(
          error ??
            (this.connected
              ? null
              : new Error(detail || "Codex Micro driver stopped.")),
        );
        this.child = null;
        this.connected = false;
        this.reportDisconnect(error);
      });
    });
  }

  reportDisconnect(error = null) {
    if (this.disconnectReported || this.closing) return;
    this.disconnectReported = true;
    Promise.resolve()
      .then(() => this.onDisconnect(error))
      .catch(() => {});
  }

  async send(message) {
    const child = this.child;
    if (!child || !this.connected || child.stdin.destroyed) {
      throw new Error("Codex Micro is not connected.");
    }
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      throw new Error("Codex Micro command exceeds 64 KiB.");
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error) => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve();
        return true;
      };
      const recover = (error) => {
        if (!settle(error)) return;
        this.reportDisconnect(error);
        if (this.child === child) this.close().catch(() => {});
      };
      const onExit = () => {
        settle(
          new Error("Codex Micro disconnected before accepting a command."),
        );
      };
      const timer = setTimeout(() => {
        recover(new Error("Codex Micro did not accept a command in time."));
      }, this.commandTimeoutMs);
      child.once("exit", onExit);
      child.stdin.write(line, (error) => {
        if (error) recover(error);
        else settle();
      });
    });
  }

  async close() {
    const child = this.child;
    if (!child) return;
    this.closing = true;
    this.child = null;
    this.connected = false;
    if (!child.stdin.destroyed) child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (await this.waitForExit(child)) return;
    if (!child.kill("SIGTERM")) {
      if (await this.waitForExit(child)) return;
      throw new Error("Louder Bridge could not stop the Codex Micro driver.");
    }
    if (await this.waitForExit(child)) return;
    if (!child.kill("SIGKILL")) {
      if (await this.waitForExit(child)) return;
      throw new Error("Louder Bridge could not stop the Codex Micro driver.");
    }
    if (!(await this.waitForExit(child))) {
      throw new Error("The Codex Micro driver did not stop in time.");
    }
  }

  waitForExit(child) {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off("exit", onExit);
        resolve(false);
      }, this.closeTimeoutMs);
      child.once("exit", onExit);
    });
  }
}
