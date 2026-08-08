import { AccessibilityDictationVoice } from "../macos/accessibility-dictation.mjs";

export class GhosttyAccessibilityVoice extends AccessibilityDictationVoice {
  constructor(options = {}) {
    super({
      command: "--ghostty-dictation-hold",
      surface: "Ghostty",
      adapterId: "ghostty-accessibility-dictation",
      ...options,
    });
  }
}

export function createGhosttyVoice(options) {
  return new GhosttyAccessibilityVoice(options);
}
