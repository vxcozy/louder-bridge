import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ClaudeAccessibilityVoice {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    run = execFileAsync,
  } = {}) {
    this.launcher = launcher;
    this.run = run;
    this.state = "idle";
    this.error = null;
    this.lastActionAt = null;
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
    };
  }

  async invoke(action) {
    if (!this.launcher) {
      throw new Error("The installed Louder Bridge launcher is unavailable.");
    }
    const previousError = this.error;
    this.state = action === "start" ? "starting" : "stopping";
    if (action === "start") this.error = null;
    try {
      await this.run(this.launcher, [`--claude-dictation-${action}`], {
        timeout: 5000,
        windowsHide: true,
      });
      this.state = action === "start" ? "recording" : "idle";
      this.error = action === "stop" ? previousError : null;
      this.lastActionAt = new Date().toISOString();
    } catch (error) {
      const detail = error?.stderr?.trim() || error?.message || String(error);
      this.state = "error";
      this.error = detail;
      this.lastActionAt = new Date().toISOString();
      throw new Error(detail);
    }
  }

  start() {
    return this.invoke("start");
  }

  stop() {
    return this.invoke("stop");
  }
}

export function createClaudeVoice(options) {
  return new ClaudeAccessibilityVoice(options);
}
