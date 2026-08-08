import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TERMINAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class GhosttyTerminalNavigator {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    run = execFileAsync,
  } = {}) {
    this.launcher = launcher;
    this.run = run;
    this.terminals = new Map();
  }

  metadata() {
    return {
      id: "ghostty-applescript-terminal",
      support: "experimental",
    };
  }

  async observe(sessionId) {
    if (!this.launcher) return false;
    try {
      const { stdout } = await this.run(
        this.launcher,
        ["--ghostty-front-terminal-id"],
        { timeout: 3000, maxBuffer: 4096, windowsHide: true },
      );
      const terminalId = stdout.trim();
      if (!TERMINAL_ID_PATTERN.test(terminalId)) return false;
      this.terminals.set(sessionId, terminalId);
      return true;
    } catch {
      return false;
    }
  }

  forget(sessionId) {
    this.terminals.delete(sessionId);
  }

  async open(sessionId) {
    if (!this.launcher) {
      throw new Error("The installed Louder Bridge launcher is unavailable.");
    }
    const terminalId = this.terminals.get(sessionId);
    if (!terminalId) {
      throw new Error(
        "Use this session in Ghostty once so Louder Bridge can associate its terminal.",
      );
    }
    try {
      await this.run(
        this.launcher,
        ["--ghostty-focus-terminal", terminalId],
        { timeout: 5000, maxBuffer: 4096, windowsHide: true },
      );
    } catch {
      throw new Error(
        "Ghostty could not find that terminal. Use the session once and try again.",
      );
    }
  }
}

export function createGhosttyNavigator(options) {
  return new GhosttyTerminalNavigator(options);
}
