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

  async observe(sessionId, terminalId, agentSurface = null) {
    if (
      typeof terminalId !== "string" ||
      !TERMINAL_ID_PATTERN.test(terminalId)
    ) return false;
    for (const [knownSessionId, terminal] of this.terminals) {
      if (
        knownSessionId !== sessionId &&
        terminal.terminalId === terminalId
      ) {
        this.terminals.delete(knownSessionId);
      }
    }
    this.terminals.set(sessionId, { terminalId, agentSurface });
    return true;
  }

  forget(sessionId) {
    this.terminals.delete(sessionId);
  }

  async open(sessionId) {
    if (!this.launcher) {
      throw new Error("The installed Louder Bridge launcher is unavailable.");
    }
    const terminal = this.terminals.get(sessionId);
    if (!terminal) {
      throw new Error(
        "Use this session in Ghostty once so Louder Bridge can associate its terminal.",
      );
    }
    const { terminalId } = terminal;
    try {
      await this.run(
        this.launcher,
        ["--ghostty-focus-terminal", terminalId],
        { timeout: 5000, maxBuffer: 4096, windowsHide: true },
      );
    } catch (error) {
      const detail = typeof error?.stderr === "string"
        ? error.stderr.trim().split("\n", 1)[0].slice(0, 512)
        : "";
      throw new Error(
        detail
          ? `Ghostty could not focus that terminal: ${detail}`
          : "Ghostty could not focus that terminal. Use the session once and try again.",
      );
    }
  }

  async activeAgentSurface() {
    if (!this.launcher) return null;
    let terminalId;
    try {
      const { stdout } = await this.run(
        this.launcher,
        ["--ghostty-front-terminal-id"],
        { timeout: 500, maxBuffer: 4096, windowsHide: true },
      );
      terminalId = stdout.trim();
    } catch {
      return null;
    }
    if (!TERMINAL_ID_PATTERN.test(terminalId)) return null;
    for (const terminal of this.terminals.values()) {
      if (terminal.terminalId === terminalId) return terminal.agentSurface;
    }
    return null;
  }

  agentSurfaceForSession(sessionId) {
    return this.terminals.get(sessionId)?.agentSurface ?? null;
  }
}

export function createGhosttyNavigator(options) {
  return new GhosttyTerminalNavigator(options);
}
