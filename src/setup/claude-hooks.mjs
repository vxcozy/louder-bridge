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

function resolveSettingsTarget(settingsFile) {
  let entry;
  try {
    entry = fs.lstatSync(settingsFile);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { file: settingsFile, existed: false, mode: 0o600 };
    }
    throw error;
  }

  let file = settingsFile;
  if (entry.isSymbolicLink()) {
    try {
      file = fs.realpathSync(settingsFile);
    } catch (error) {
      throw new Error(
        `Claude settings points to a missing file: ${settingsFile}`,
        { cause: error },
      );
    }
    entry = fs.statSync(file);
  }
  if (!entry.isFile()) {
    throw new Error(`Claude settings is not a regular file: ${settingsFile}`);
  }
  return { file, existed: true, mode: entry.mode & 0o777 };
}

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

export function updateClaudeSettings({
  remove = false,
  command,
  settingsFile = claudeSettingsPath(),
} = {}) {
  const target = resolveSettingsTarget(settingsFile);
  let settings = {};
  if (target.existed) {
    settings = JSON.parse(fs.readFileSync(target.file, "utf8"));
  }
  const updated = remove
    ? removeBridgeHooks(settings)
    : addBridgeHooks(settings, command);
  writeFileAtomic(
    target.file,
    `${JSON.stringify(updated, null, 2)}\n`,
    { mode: target.mode },
  );
  return settingsFile;
}

export function snapshotClaudeSettings(settingsFile = claudeSettingsPath()) {
  const target = resolveSettingsTarget(settingsFile);
  return {
    file: target.file,
    existed: target.existed,
    contents: target.existed ? fs.readFileSync(target.file, "utf8") : null,
    mode: target.mode,
  };
}

export function restoreClaudeSettings(snapshot) {
  if (snapshot.existed) {
    writeFileAtomic(snapshot.file, snapshot.contents, { mode: snapshot.mode });
  } else if (fs.existsSync(snapshot.file)) {
    fs.unlinkSync(snapshot.file);
  }
}
