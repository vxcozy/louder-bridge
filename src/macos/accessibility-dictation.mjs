import { spawn } from "node:child_process";

const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;
const CLEANUP_TIMEOUT_MS = 1000;
const MAX_STARTUP_RESPONSE_BYTES = 4096;

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

function exitsWithin(exitPromise, milliseconds) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), milliseconds);
  });
  return Promise.race([
    exitPromise.then(
      () => true,
      () => true,
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

async function terminateVoiceChild(
  child,
  exitPromise,
  { timeoutMs, endInput = true },
) {
  if (await exitsWithin(exitPromise, 0)) return;
  if (endInput && !child.stdin.destroyed && !child.stdin.writableEnded) {
    child.stdin.end();
    if (await exitsWithin(exitPromise, timeoutMs)) return;
  }
  child.kill("SIGTERM");
  if (await exitsWithin(exitPromise, timeoutMs)) return;
  child.kill("SIGKILL");
  if (await exitsWithin(exitPromise, timeoutMs)) return;
  throw new Error("Louder Bridge could not stop its dictation helper.");
}

export class AccessibilityDictationVoice {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    spawnProcess = spawn,
    startTimeoutMs = START_TIMEOUT_MS,
    stopTimeoutMs = STOP_TIMEOUT_MS,
    cleanupTimeoutMs = CLEANUP_TIMEOUT_MS,
    command,
    surface,
    adapterId,
  } = {}) {
    this.launcher = launcher;
    this.spawnProcess = spawnProcess;
    this.startTimeoutMs = startTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.cleanupTimeoutMs = cleanupTimeoutMs;
    this.command = command;
    this.surface = surface;
    this.adapterId = adapterId;
    this.state = "idle";
    this.error = null;
    this.lastActionAt = null;
    this.method = null;
    this.child = null;
    this.exitPromise = null;
  }

  metadata() {
    return {
      id: this.adapterId,
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
    if (!this.command || !this.surface || !this.adapterId) {
      throw new Error("The dictation adapter is incomplete.");
    }
    if (this.child) return;

    this.state = "starting";
    this.error = null;
    this.method = null;
    let stderr = "";
    let stdout = "";
    let child;
    try {
      child = this.spawnProcess(this.launcher, [this.command], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      const detail = "Louder Bridge could not start its dictation helper.";
      this.state = "error";
      this.error = detail;
      this.lastActionAt = new Date().toISOString();
      throw new Error(detail);
    }
    this.child = child;

    this.exitPromise = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
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
          child.stdout.off("data", onStdoutData);
          if (error) reject(error);
          else resolve();
        };
        const onStdoutData = (chunk) => {
          stdout += chunk.toString("utf8");
          if (Buffer.byteLength(stdout) > MAX_STARTUP_RESPONSE_BYTES) {
            finish(
              new Error(
                "Louder Bridge rejected an oversized dictation helper response.",
              ),
            );
            return;
          }
          const newline = stdout.indexOf("\n");
          if (newline < 0) return;
          const [status, method] = stdout.slice(0, newline).trim().split(/\s+/, 2);
          if (status === "ready") {
            this.method = method ?? null;
            finish();
          }
        };
        const timer = setTimeout(() => {
          finish(new Error(`${this.surface} did not begin recording in time.`));
        }, this.startTimeoutMs);
        child.stdout.on("data", onStdoutData);
        this.exitPromise.then(
          ({ code, signal }) => {
            finish(
              new Error(
                childFailure(
                  stderr,
                  `${this.surface} dictation exited before recording (${signal ?? code}).`,
                ),
              ),
            );
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
            `${this.surface} dictation stopped unexpectedly (${signal ?? code}).`,
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
      let cleanupError = null;
      try {
        await terminateVoiceChild(child, this.exitPromise, {
          timeoutMs: this.cleanupTimeoutMs,
        });
      } catch (caught) {
        cleanupError = caught;
      }
      if (this.child === child) {
        this.child = null;
        this.exitPromise = null;
      }
      const detail = [
        childFailure(stderr, error.message),
        cleanupError?.message,
      ].filter(Boolean).join(" ");
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
        `${this.surface} did not stop recording in time.`,
      );
      if (result.code !== 0) {
        throw new Error(
          `${this.surface} dictation stopped unexpectedly (${result.signal ?? result.code}).`,
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
      let failure = error;
      try {
        await terminateVoiceChild(child, exitPromise, {
          timeoutMs: this.cleanupTimeoutMs,
          endInput: false,
        });
      } catch (cleanupError) {
        failure = new Error(`${error.message} ${cleanupError.message}`);
      }
      if (this.child === child) {
        this.child = null;
        this.exitPromise = null;
      }
      this.state = "error";
      this.error = failure.message;
      this.lastActionAt = new Date().toISOString();
      throw failure;
    }
  }
}
