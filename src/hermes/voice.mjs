import { AccessibilityDictationVoice } from "../macos/accessibility-dictation.mjs";

export class HermesAccessibilityVoice extends AccessibilityDictationVoice {
  constructor(options = {}) {
    super({
      command: "--hermes-dictation-hold",
      surface: "Hermes",
      adapterId: "hermes-accessibility-dictation",
      ...options,
    });
  }
}

export function createHermesVoice(options) {
  return new HermesAccessibilityVoice(options);
}
