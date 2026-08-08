import os from "node:os";
import path from "node:path";
import {
  beginClaudeSettingsUpdate,
  bridgeHookCommand,
  rollbackClaudeSettingsUpdate,
} from "./claude-hooks.mjs";

const CODEX_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PermissionRequest",
  "Stop",
  "SessionEnd",
];

function describeCodexHookError(error) {
  if (typeof error?.message === "string") {
    error.message = error.message.replaceAll(
      "Claude settings",
      "Codex hooks file",
    );
  }
  return error;
}

export function codexHooksPath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, ".codex", "hooks.json");
}

export function codexBridgeHookCommand(options = {}) {
  return bridgeHookCommand({ ...options, agentSurface: "codex" });
}

export function beginCodexHooksUpdate({
  hooksFile = codexHooksPath(),
  command = codexBridgeHookCommand(),
  remove = false,
  ...options
} = {}) {
  try {
    return beginClaudeSettingsUpdate({
      ...options,
      settingsFile: hooksFile,
      command,
      remove,
      events: CODEX_HOOK_EVENTS,
    });
  } catch (error) {
    throw describeCodexHookError(error);
  }
}

export function rollbackCodexHooksUpdate(transaction) {
  try {
    return rollbackClaudeSettingsUpdate(transaction);
  } catch (error) {
    throw describeCodexHookError(error);
  }
}
