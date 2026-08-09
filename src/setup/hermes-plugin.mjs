import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { findHermesExecutable } from "../hermes/navigator.mjs";

const execFileAsync = promisify(execFile);
const PLUGIN_NAME = "louder-bridge";
const OWNERSHIP_MARKER = ".louder-bridge-owned";

function defaultPluginSource() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../hermes/plugin",
  );
}

export function hermesPluginPath(
  homeDirectory = os.homedir(),
  configFile = path.join(homeDirectory, ".hermes", "config.yaml"),
) {
  const hermesDirectory = path.resolve(homeDirectory, ".hermes");
  const resolvedConfig = path.resolve(configFile);
  const configDirectory = path.dirname(resolvedConfig);
  const defaultConfig = path.join(hermesDirectory, "config.yaml");
  const profilesDirectory = path.join(hermesDirectory, "profiles");
  const profile = path.relative(profilesDirectory, configDirectory);
  const namedProfile =
    path.basename(resolvedConfig) === "config.yaml" &&
    profile.length > 0 &&
    !path.isAbsolute(profile) &&
    !profile.startsWith(`..${path.sep}`) &&
    profile !== ".." &&
    !profile.includes(path.sep);
  if (resolvedConfig !== defaultConfig && !namedProfile) {
    throw new Error(
      "Hermes reported a config path outside the expected Hermes directory.",
    );
  }
  return path.join(configDirectory, "plugins", PLUGIN_NAME);
}

function entry(filename) {
  try {
    return fs.lstatSync(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requireOwnedPlugin(directory) {
  const target = entry(directory);
  if (!target) return false;
  if (!target.isDirectory() || target.isSymbolicLink()) {
    throw new Error("The Hermes louder-bridge plugin path is not a regular directory.");
  }
  const marker = entry(path.join(directory, OWNERSHIP_MARKER));
  if (!marker?.isFile() || marker.isSymbolicLink()) {
    throw new Error(
      "Hermes already has a louder-bridge plugin that this app does not own.",
    );
  }
  return true;
}

async function runHermes(hermes, args, run = execFileAsync) {
  return run(hermes, args, {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

async function activeHermesPluginPath(homeDirectory, hermes, run) {
  const { stdout } = await runHermes(hermes, ["config", "path"], run);
  const configFile = typeof stdout === "string" ? stdout.trim() : "";
  if (!configFile) {
    throw new Error("Hermes did not report an active config path.");
  }
  return hermesPluginPath(homeDirectory, configFile);
}

async function readConfigValue(hermes, key, run) {
  try {
    const { stdout } = await runHermes(
      hermes,
      ["config", "get", key, "--json"],
      run,
    );
    return { exists: true, value: JSON.parse(stdout) };
  } catch (error) {
    if (String(error?.stderr ?? "").includes("Config key not set:")) {
      return { exists: false, value: null };
    }
    throw error;
  }
}

async function writeConfigValue(hermes, key, state, run) {
  if (!state.exists) {
    try {
      await runHermes(hermes, ["config", "unset", key], run);
    } catch (error) {
      if (!String(error?.stderr ?? "").includes("Config key not set:")) {
        throw error;
      }
    }
    return;
  }
  await runHermes(
    hermes,
    ["config", "set", "--force", key, JSON.stringify(state.value)],
    run,
  );
}

async function pluginConfigSnapshot(hermes, run) {
  const [enabled, disabled, override] = await Promise.all([
    readConfigValue(hermes, "plugins.enabled", run),
    readConfigValue(hermes, "plugins.disabled", run),
    readConfigValue(
      hermes,
      "plugins.entries.louder-bridge.allow_tool_override",
      run,
    ),
  ]);
  return { enabled, disabled, override };
}

async function restorePluginConfig(hermes, snapshot, run) {
  await writeConfigValue(hermes, "plugins.enabled", snapshot.enabled, run);
  await writeConfigValue(hermes, "plugins.disabled", snapshot.disabled, run);
  await writeConfigValue(
    hermes,
    "plugins.entries.louder-bridge.allow_tool_override",
    snapshot.override,
    run,
  );
}

function removeDirectory(directory) {
  if (entry(directory)) fs.rmSync(directory, { recursive: true });
}

export async function installHermesPlugin({
  homeDirectory = os.homedir(),
  source = defaultPluginSource(),
  hermes = findHermesExecutable(),
  run = execFileAsync,
} = {}) {
  if (!hermes) return { installed: false, reason: "not-installed" };
  const target = await activeHermesPluginPath(homeDirectory, hermes, run);
  const parent = path.dirname(target);
  const staging = path.join(parent, `.${PLUGIN_NAME}.${randomUUID()}.tmp`);
  const backup = path.join(parent, `.${PLUGIN_NAME}.${randomUUID()}.previous`);
  const previous = requireOwnedPlugin(target);
  const config = await pluginConfigSnapshot(hermes, run);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });

  try {
    fs.cpSync(source, staging, { recursive: true, errorOnExist: true });
    fs.writeFileSync(
      path.join(staging, OWNERSHIP_MARKER),
      "Managed by Louder Bridge.\n",
      { mode: 0o600 },
    );
    if (previous) fs.renameSync(target, backup);
    fs.renameSync(staging, target);
    await runHermes(
      hermes,
      ["plugins", "enable", PLUGIN_NAME, "--no-allow-tool-override"],
      run,
    );
    return {
      installed: true,
      hermes,
      target,
      backup: previous ? backup : null,
      config,
      run,
    };
  } catch (error) {
    removeDirectory(staging);
    removeDirectory(target);
    if (entry(backup)) fs.renameSync(backup, target);
    try {
      await restorePluginConfig(hermes, config, run);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Hermes plugin setup failed and its configuration could not be restored.",
      );
    }
    throw error;
  }
}

export async function rollbackHermesPluginInstallation(transaction) {
  if (!transaction?.installed) return;
  requireOwnedPlugin(transaction.target);
  removeDirectory(transaction.target);
  if (transaction.backup) fs.renameSync(transaction.backup, transaction.target);
  await restorePluginConfig(
    transaction.hermes,
    transaction.config,
    transaction.run,
  );
}

export function commitHermesPluginInstallation(transaction) {
  if (transaction?.backup) removeDirectory(transaction.backup);
}

export async function removeHermesPlugin({
  homeDirectory = os.homedir(),
  hermes = findHermesExecutable(),
  run = execFileAsync,
} = {}) {
  const target = hermes
    ? await activeHermesPluginPath(homeDirectory, hermes, run)
    : hermesPluginPath(homeDirectory);
  if (!entry(target)) return { removed: false, target };
  requireOwnedPlugin(target);
  if (!hermes) {
    throw new Error("Hermes is not executable, so its plugin settings were left unchanged.");
  }
  const config = await pluginConfigSnapshot(hermes, run);
  const backup = path.join(
    path.dirname(target),
    `.${PLUGIN_NAME}.${randomUUID()}.removing`,
  );
  fs.renameSync(target, backup);
  try {
    const enabled = Array.isArray(config.enabled.value)
      ? config.enabled.value.filter((name) => name !== PLUGIN_NAME)
      : [];
    const disabled = Array.isArray(config.disabled.value)
      ? config.disabled.value.filter((name) => name !== PLUGIN_NAME)
      : [];
    await writeConfigValue(
      hermes,
      "plugins.enabled",
      config.enabled.exists ? { exists: true, value: enabled } : config.enabled,
      run,
    );
    await writeConfigValue(
      hermes,
      "plugins.disabled",
      config.disabled.exists ? { exists: true, value: disabled } : config.disabled,
      run,
    );
    await writeConfigValue(
      hermes,
      "plugins.entries.louder-bridge.allow_tool_override",
      { exists: false, value: null },
      run,
    );
    return { removed: true, target, backup, hermes, config, run };
  } catch (error) {
    fs.renameSync(backup, target);
    await restorePluginConfig(hermes, config, run);
    throw error;
  }
}

export async function rollbackHermesPluginRemoval(transaction) {
  if (!transaction?.removed) return;
  if (entry(transaction.target)) {
    throw new Error("A new Hermes louder-bridge plugin appeared during rollback.");
  }
  fs.renameSync(transaction.backup, transaction.target);
  await restorePluginConfig(
    transaction.hermes,
    transaction.config,
    transaction.run,
  );
}

export function commitHermesPluginRemoval(transaction) {
  if (transaction?.backup) removeDirectory(transaction.backup);
}
