import { AccessibilityDictationVoice } from "../macos/accessibility-dictation.mjs";

export class GhosttyAccessibilityVoice extends AccessibilityDictationVoice {
  constructor(options = {}) {
    super({
      command: "--ghostty-push-to-talk-hold",
      surface: "Ghostty",
      adapterId: "ghostty-terminal-push-to-talk",
      ...options,
    });
    this.codexVoice = new AccessibilityDictationVoice({
      command: "--ghostty-system-dictation-hold",
      surface: "Codex CLI",
      adapterId: "ghostty-macos-dictation",
      ...options,
    });
    this.activeVoice = null;
    this.agentSurface = null;
  }

  metadata() {
    return {
      id: "ghostty-agent-aware-dictation",
      support: "experimental",
    };
  }

  status() {
    const status =
      !this.activeVoice || this.activeVoice === this
        ? super.status()
        : this.activeVoice.status();
    const { id: _id, support: _support, ...details } = status;
    return {
      ...this.metadata(),
      ...details,
      agentSurface: this.agentSurface,
    };
  }

  async start({ agentSurface = null } = {}) {
    if (this.activeVoice) return;
    const voice = agentSurface === "codex" ? this.codexVoice : this;
    this.activeVoice = voice;
    this.agentSurface = agentSurface;
    try {
      if (voice === this) await super.start();
      else await voice.start();
    } catch (error) {
      this.activeVoice = null;
      this.agentSurface = null;
      throw error;
    }
  }

  async stop() {
    const voice = this.activeVoice;
    if (!voice) {
      await super.stop();
      return;
    }
    try {
      if (voice === this) await super.stop();
      else await voice.stop();
    } finally {
      this.activeVoice = null;
      this.agentSurface = null;
    }
  }
}

export function createGhosttyVoice(options) {
  return new GhosttyAccessibilityVoice(options);
}
