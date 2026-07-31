import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  claudeSettingsPath,
} from "../config.mjs";
import { writeFileAtomic } from "./atomic-file.mjs";

const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PermissionRequest",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd",
];
const HOOK_TAG = "# louder-bridge";

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function bridgeHookCommand({
  nodePath = process.execPath,
  hookPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../hook.mjs",
  ),
} = {}) {
  return [
    shellQuote("/usr/bin/env"),
    shellQuote(`LOUDER_BRIDGE_HOST=${BRIDGE_HOST}`),
    shellQuote(`LOUDER_BRIDGE_PORT=${BRIDGE_PORT}`),
    shellQuote(nodePath),
    shellQuote(hookPath),
    HOOK_TAG,
  ].join(" ");
}

function isBridgeHook(hook) {
  if (hook?.type !== "command" || typeof hook.command !== "string") {
    return false;
  }
  const invokesHookScript = /(?:^|\s)'[^']*\/hook\.mjs'(?:\s|$)/.test(
    hook.command,
  );
  const hasBridgeTag = /(?:^|\s)(?:'# louder-bridge'|# louder-bridge)\s*$/.test(
    hook.command,
  );
  return invokesHookScript && hasBridgeTag;
}

export function addBridgeHooks(settings, command = bridgeHookCommand()) {
  const output = structuredClone(settings ?? {});
  output.hooks ??= {};
  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(output.hooks[event]) ? output.hooks[event] : [];
    const cleaned = groups
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) => !isBridgeHook(hook)),
      }))
      .filter((group) => group.hooks.length);
    cleaned.push({
      hooks: [{ type: "command", command, timeout: 2 }],
    });
    output.hooks[event] = cleaned;
  }
  return output;
}

export function removeBridgeHooks(settings) {
  const output = structuredClone(settings ?? {});
  if (!output.hooks) return output;
  for (const event of Object.keys(output.hooks)) {
    output.hooks[event] = (output.hooks[event] ?? [])
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((hook) => !isBridgeHook(hook)),
      }))
      .filter((group) => group.hooks.length);
    if (!output.hooks[event].length) delete output.hooks[event];
  }
  if (!Object.keys(output.hooks).length) delete output.hooks;
  return output;
}

export function updateClaudeSettings({ remove = false, command } = {}) {
  const settingsFile = claudeSettingsPath();
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  }
  const updated = remove
    ? removeBridgeHooks(settings)
    : addBridgeHooks(settings, command);
  writeFileAtomic(settingsFile, `${JSON.stringify(updated, null, 2)}\n`);
  return settingsFile;
}

export function snapshotClaudeSettings(settingsFile = claudeSettingsPath()) {
  const existed = fs.existsSync(settingsFile);
  return {
    file: settingsFile,
    existed,
    contents: existed ? fs.readFileSync(settingsFile, "utf8") : null,
  };
}

export function restoreClaudeSettings(snapshot) {
  if (snapshot.existed) {
    writeFileAtomic(snapshot.file, snapshot.contents);
  } else if (fs.existsSync(snapshot.file)) {
    fs.unlinkSync(snapshot.file);
  }
}
