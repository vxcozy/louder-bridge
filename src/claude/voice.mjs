import { spawn } from "node:child_process";

const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;

function childFailure(stderr, fallback) {
  return stderr.trim() || fallback;
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class ClaudeAccessibilityVoice {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    spawnProcess = spawn,
    startTimeoutMs = START_TIMEOUT_MS,
    stopTimeoutMs = STOP_TIMEOUT_MS,
  } = {}) {
    this.launcher = launcher;
    this.spawnProcess = spawnProcess;
    this.startTimeoutMs = startTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.state = "idle";
    this.error = null;
    this.lastActionAt = null;
    this.method = null;
    this.child = null;
    this.exitPromise = null;
  }

  metadata() {
    return {
      id: "claude-accessibility-dictation",
      support: "experimental",
    };
  }

  status() {
    return {
      ...this.metadata(),
      state: this.state,
      error: this.error,
      lastActionAt: this.lastActionAt,
      method: this.method,
    };
  }

  async start() {
    if (!this.launcher) {
      throw new Error("The installed Louder Bridge launcher is unavailable.");
    }
    if (this.child) return;

    this.state = "starting";
    this.error = null;
    this.method = null;
    let stderr = "";
    let stdout = "";
    const child = this.spawnProcess(
      this.launcher,
      ["--claude-dictation-hold"],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    this.child = child;

    this.exitPromise = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4096);
    });

    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        const timer = setTimeout(() => {
          finish(new Error("Claude did not begin recording in time."));
        }, this.startTimeoutMs);
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString("utf8");
          const newline = stdout.indexOf("\n");
          if (newline < 0) return;
          const line = stdout.slice(0, newline).trim();
          const [status, method] = line.split(/\s+/, 2);
          if (status === "ready") {
            this.method = method ?? null;
            finish();
          }
        });
        this.exitPromise.then(
          ({ code, signal }) => {
            finish(new Error(childFailure(
              stderr,
              `Claude dictation exited before recording (${signal ?? code}).`,
            )));
          },
          finish,
        );
      });
      this.state = "recording";
      this.lastActionAt = new Date().toISOString();
      this.exitPromise.then(
        ({ code, signal }) => {
          if (this.child !== child) return;
          this.child = null;
          this.exitPromise = null;
          if (this.state === "stopping") return;
          this.state = "error";
          this.error = childFailure(
            stderr,
            `Claude dictation stopped unexpectedly (${signal ?? code}).`,
          );
          this.lastActionAt = new Date().toISOString();
        },
        (error) => {
          if (this.child !== child) return;
          this.child = null;
          this.exitPromise = null;
          this.state = "error";
          this.error = error.message;
          this.lastActionAt = new Date().toISOString();
        },
      );
    } catch (error) {
      if (this.child === child) {
        this.child = null;
        this.exitPromise = null;
      }
      child.kill();
      const detail = childFailure(stderr, error.message);
      this.state = "error";
      this.error = detail;
      this.lastActionAt = new Date().toISOString();
      throw new Error(detail);
    }
  }

  async stop() {
    const previousError = this.error;
    const child = this.child;
    const exitPromise = this.exitPromise;
    if (!child || !exitPromise) {
      this.state = "idle";
      this.lastActionAt = new Date().toISOString();
      return;
    }

    this.state = "stopping";
    try {
      child.stdin.end();
      const result = await withTimeout(
        exitPromise,
        this.stopTimeoutMs,
        "Claude did not stop recording in time.",
      );
      if (result.code !== 0) {
        throw new Error(
          `Claude dictation stopped unexpectedly (${result.signal ?? result.code}).`,
        );
      }
      if (this.child === child) {
        this.child = null;
        this.exitPromise = null;
      }
      this.state = "idle";
      this.error = previousError;
      this.lastActionAt = new Date().toISOString();
    } catch (error) {
      child.kill();
      if (this.child === child) {
        this.child = null;
        this.exitPromise = null;
      }
      this.state = "error";
      this.error = error.message;
      this.lastActionAt = new Date().toISOString();
      throw error;
    }
  }
}

export function createClaudeVoice(options) {
  return new ClaudeAccessibilityVoice(options);
}
