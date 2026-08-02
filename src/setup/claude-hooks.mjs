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

function bridgeHookGroups(settings) {
  const groupsByEvent = {};
  if (!settings?.hooks || typeof settings.hooks !== "object") {
    return groupsByEvent;
  }
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    const bridgeGroups = groups
      .filter((group) => group && typeof group === "object")
      .map((group) => ({
        ...group,
        hooks: Array.isArray(group.hooks)
          ? group.hooks.filter(isBridgeHook)
          : [],
      }))
      .filter((group) => group.hooks.length);
    if (bridgeGroups.length) groupsByEvent[event] = bridgeGroups;
  }
  return groupsByEvent;
}

function restoreBridgeHookGroups(settings, groupsByEvent) {
  const output = structuredClone(settings ?? {});
  for (const [event, groups] of Object.entries(groupsByEvent)) {
    output.hooks ??= {};
    const current = Array.isArray(output.hooks[event])
      ? output.hooks[event]
      : [];
    output.hooks[event] = [...current, ...structuredClone(groups)];
  }
  return output;
}

function readSettings(target) {
  return target.existed
    ? JSON.parse(fs.readFileSync(target.file, "utf8"))
    : {};
}

function writeSettings(target, settings) {
  writeFileAtomic(
    target.file,
    `${JSON.stringify(settings, null, 2)}\n`,
    { mode: target.mode },
  );
}

export function beginClaudeSettingsUpdate({
  remove = false,
  command,
  settingsFile = claudeSettingsPath(),
} = {}) {
  const target = resolveSettingsTarget(settingsFile);
  const settings = readSettings(target);
  const updated = remove
    ? removeBridgeHooks(settings)
    : addBridgeHooks(settings, command);
  writeSettings(target, updated);
  return {
    settingsFile,
    targetFile: target.file,
    existed: target.existed,
    previousBridgeHooks: bridgeHookGroups(settings),
  };
}

export function rollbackClaudeSettingsUpdate(transaction) {
  if (!transaction) return;
  const target = resolveSettingsTarget(transaction.settingsFile);
  if (!target.existed || target.file !== transaction.targetFile) {
    throw new Error(
      "Claude settings changed location during the operation. Louder Bridge left the newer file untouched.",
    );
  }
  const current = readSettings(target);
  const restored = restoreBridgeHookGroups(
    removeBridgeHooks(current),
    transaction.previousBridgeHooks,
  );
  if (!transaction.existed && Object.keys(restored).length === 0) {
    fs.unlinkSync(target.file);
    return;
  }
  writeSettings(target, restored);
}

export function updateClaudeSettings({
  remove = false,
  command,
  settingsFile = claudeSettingsPath(),
} = {}) {
  return beginClaudeSettingsUpdate({ remove, command, settingsFile })
    .settingsFile;
}
