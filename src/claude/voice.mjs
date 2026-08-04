import { AccessibilityDictationVoice } from "../macos/accessibility-dictation.mjs";

export class ClaudeAccessibilityVoice extends AccessibilityDictationVoice {
  constructor(options = {}) {
    super({
      command: "--claude-dictation-hold",
      surface: "Claude",
      adapterId: "claude-accessibility-dictation",
      ...options,
    });
  }
}

export function createClaudeVoice(options) {
  return new ClaudeAccessibilityVoice(options);
}
