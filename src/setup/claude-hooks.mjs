import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
  claudeSettingsPath,
} from "../config.mjs";
import {
  writeFileAtomic,
  writeFileAtomicIfAbsent,
} from "./atomic-file.mjs";

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
const SETTINGS_WRITE_ATTEMPTS = 5;
const SETTINGS_CONFLICT = "LOUDER_SETTINGS_CONFLICT";

function settingsConflict(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = SETTINGS_CONFLICT;
  return error;
}

function fileIdentity(entry) {
  return { device: entry.dev, inode: entry.ino };
}

function sameFile(expected, actual) {
  return Boolean(
    expected &&
      actual &&
      expected.device === actual.device &&
      expected.inode === actual.inode,
  );
}

function pathEntry(filename) {
  try {
    return fs.lstatSync(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

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
  const invokesHookScript =
    /(?:^|\s)'(?:[^']|'\\'')*\/hook\.mjs'(?:\s|$)/.test(hook.command);
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
  if (!target.existed) {
    return { settings: {}, contents: null, identity: null };
  }
  let descriptor;
  try {
    descriptor = fs.openSync(
      target.file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    const metadata = fs.fstatSync(descriptor);
    const current = pathEntry(target.file);
    if (
      !metadata.isFile() ||
      !current?.isFile() ||
      !sameFile(fileIdentity(metadata), fileIdentity(current))
    ) {
      throw new Error(
        "Claude settings changed while Louder Bridge was reading it.",
      );
    }
    const contents = fs.readFileSync(descriptor, "utf8");
    return {
      settings: JSON.parse(contents),
      contents,
      identity: fileIdentity(metadata),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function requireUnchangedSettings(settingsFile, target, expected) {
  let currentTarget;
  let current;
  try {
    currentTarget = resolveSettingsTarget(settingsFile);
    if (!currentTarget.existed || currentTarget.file !== target.file) {
      throw settingsConflict(
        "Claude settings changed location while Louder Bridge was updating it.",
      );
    }
    current = readSettings(currentTarget);
  } catch (error) {
    if (error?.code === SETTINGS_CONFLICT) throw error;
    throw settingsConflict(
      "Claude settings changed while Louder Bridge was updating it.",
      error,
    );
  }
  if (
    !sameFile(expected.identity, current.identity) ||
    expected.contents !== current.contents
  ) {
    throw settingsConflict(
      "Claude settings changed while Louder Bridge was updating it.",
    );
  }
}

function writeSettings(settingsFile, target, expected, settings) {
  const contents = `${JSON.stringify(settings, null, 2)}\n`;
  if (!target.existed) {
    const created = writeFileAtomicIfAbsent(target.file, contents, {
      mode: target.mode,
    });
    if (!created) {
      throw settingsConflict(
        "Claude settings appeared while Louder Bridge was creating it.",
      );
    }
  } else {
    writeFileAtomic(target.file, contents, {
      mode: target.mode,
      beforeRename() {
        requireUnchangedSettings(settingsFile, target, expected);
      },
    });
  }
  const installed = pathEntry(target.file);
  if (!installed?.isFile() || installed.isSymbolicLink()) {
    throw new Error("Claude settings changed before setup could finish.");
  }
  return fileIdentity(installed);
}

export function beginClaudeSettingsUpdate({
  remove = false,
  command,
  settingsFile = claudeSettingsPath(),
  beforeWrite = () => {},
} = {}) {
  for (let attempt = 1; attempt <= SETTINGS_WRITE_ATTEMPTS; attempt += 1) {
    const target = resolveSettingsTarget(settingsFile);
    const snapshot = readSettings(target);
    const updated = remove
      ? removeBridgeHooks(snapshot.settings)
      : addBridgeHooks(snapshot.settings, command);
    beforeWrite({ attempt, target, updated });
    try {
      const installedIdentity = writeSettings(
        settingsFile,
        target,
        snapshot,
        updated,
      );
      return {
        settingsFile,
        targetFile: target.file,
        existed: target.existed,
        previousBridgeHooks: bridgeHookGroups(snapshot.settings),
        installedBridgeHooks: bridgeHookGroups(updated),
        installedIdentity,
      };
    } catch (error) {
      if (
        error?.code !== SETTINGS_CONFLICT ||
        attempt === SETTINGS_WRITE_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
  throw new Error("Louder Bridge could not update Claude settings.");
}

export function rollbackClaudeSettingsUpdate(transaction) {
  if (!transaction) return;
  const target = resolveSettingsTarget(transaction.settingsFile);
  if (!target.existed || target.file !== transaction.targetFile) {
    throw new Error(
      "Claude settings changed location during the operation. Louder Bridge left the newer file untouched.",
    );
  }
  const currentState = readSettings(target);
  const current = currentState.settings;
  const restored = restoreBridgeHookGroups(
    removeBridgeHooks(current),
    transaction.previousBridgeHooks,
  );
  if (!transaction.existed && Object.keys(restored).length === 0) {
    if (
      !sameFile(transaction.installedIdentity, currentState.identity) ||
      JSON.stringify(bridgeHookGroups(current)) !==
        JSON.stringify(transaction.installedBridgeHooks)
    ) {
      throw new Error(
        "Claude settings changed during rollback. Louder Bridge left the newer file untouched.",
      );
    }
    const beforeDelete = pathEntry(target.file);
    if (
      !beforeDelete ||
      !sameFile(transaction.installedIdentity, fileIdentity(beforeDelete))
    ) {
      throw new Error(
        "Claude settings changed during rollback. Louder Bridge left the newer file untouched.",
      );
    }
    fs.unlinkSync(target.file);
    return;
  }
  writeSettings(
    transaction.settingsFile,
    target,
    currentState,
    restored,
  );
}

export function updateClaudeSettings({
  remove = false,
  command,
  settingsFile = claudeSettingsPath(),
} = {}) {
  return beginClaudeSettingsUpdate({ remove, command, settingsFile })
    .settingsFile;
}
