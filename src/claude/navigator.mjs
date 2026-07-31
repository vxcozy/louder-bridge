import { openClaudeSession } from "./open-session.mjs";

export class ClaudeUrlNavigator {
  constructor({ open = openClaudeSession } = {}) {
    this.openUrl = open;
  }

  metadata() {
    return {
      id: "claude-resume-url",
      support: "experimental",
    };
  }

  open(sessionId) {
    return this.openUrl(sessionId);
  }
}

export function createClaudeNavigator() {
  return new ClaudeUrlNavigator();
}
