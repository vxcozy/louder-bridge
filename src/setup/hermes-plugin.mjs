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
  return hermesPluginLocation(homeDirectory, configFile).target;
}

function hermesPluginLocation(homeDirectory, configFile) {
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
  return {
    configFile: resolvedConfig,
    hermesHome: configDirectory,
    target: path.join(configDirectory, "plugins", PLUGIN_NAME),
  };
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

function configFileSnapshot(filename) {
  const target = entry(filename);
  if (!target) return { exists: false, contents: null, mode: null };
  if (!target.isFile() || target.isSymbolicLink()) {
    throw new Error("The Hermes config path is not a regular file.");
  }
  return {
    exists: true,
    contents: fs.readFileSync(filename),
    mode: target.mode & 0o777,
  };
}

function configSnapshotsMatch(left, right) {
  if (left.exists !== right.exists) return false;
  if (!left.exists) return true;
  return left.contents.equals(right.contents);
}

function requireConfigSnapshot(filename, expected) {
  if (!configSnapshotsMatch(configFileSnapshot(filename), expected)) {
    throw new Error(
      "Hermes configuration changed during setup, so Louder Bridge left it untouched.",
    );
  }
}

async function runHermes(
  hermes,
  args,
  run = execFileAsync,
  hermesHome = null,
) {
  const options = {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  };
  if (hermesHome) {
    options.env = { ...process.env, HERMES_HOME: hermesHome };
  }
  return run(hermes, args, options);
}

async function activeHermesPluginLocation(homeDirectory, hermes, run) {
  const { stdout } = await runHermes(hermes, ["config", "path"], run);
  const configFile = typeof stdout === "string" ? stdout.trim() : "";
  if (!configFile) {
    throw new Error("Hermes did not report an active config path.");
  }
  const location = hermesPluginLocation(homeDirectory, configFile);
  const profilesDirectory = path.join(
    path.resolve(homeDirectory, ".hermes"),
    "profiles",
  );
  if (path.dirname(location.hermesHome) === profilesDirectory) {
    for (const directory of [profilesDirectory, location.hermesHome]) {
      const target = entry(directory);
      if (!target?.isDirectory() || target.isSymbolicLink()) {
        throw new Error(
          "The active Hermes profile uses a symbolic link. Louder Bridge cannot install its plugin there safely.",
        );
      }
    }
  }
  return location;
}

async function readConfigValue(hermes, key, run, hermesHome) {
  try {
    const { stdout } = await runHermes(
      hermes,
      ["config", "get", key, "--json"],
      run,
      hermesHome,
    );
    return { exists: true, value: JSON.parse(stdout) };
  } catch (error) {
    if (String(error?.stderr ?? "").includes("Config key not set:")) {
      return { exists: false, value: null };
    }
    throw error;
  }
}

async function pluginConfigSnapshot(hermes, run, hermesHome) {
  const [enabled, disabled, override] = await Promise.all([
    readConfigValue(hermes, "plugins.enabled", run, hermesHome),
    readConfigValue(hermes, "plugins.disabled", run, hermesHome),
    readConfigValue(
      hermes,
      "plugins.entries.louder-bridge.allow_tool_override",
      run,
      hermesHome,
    ),
  ]);
  return { enabled, disabled, override };
}

async function unsetConfigValue(hermes, key, run, hermesHome) {
  try {
    await runHermes(hermes, ["config", "unset", key], run, hermesHome);
  } catch (error) {
    if (!String(error?.stderr ?? "").includes("Config key not set:")) {
      throw error;
    }
  }
}

async function removePluginConfigEntries(
  hermes,
  config,
  run,
  hermesHome,
  configFile = null,
  expectedFile = null,
) {
  if (configFile && expectedFile) {
    requireConfigSnapshot(configFile, expectedFile);
  }
  for (const [key, state] of [
    ["plugins.enabled", config.enabled],
    ["plugins.disabled", config.disabled],
  ]) {
    if (!Array.isArray(state.value)) continue;
    const indexes = state.value
      .map((name, index) => (name === PLUGIN_NAME ? index : -1))
      .filter((index) => index >= 0)
      .reverse();
    for (const index of indexes) {
      await unsetConfigValue(hermes, `${key}.${index}`, run, hermesHome);
    }
  }
  if (config.override.exists) {
    await unsetConfigValue(
      hermes,
      "plugins.entries.louder-bridge.allow_tool_override",
      run,
      hermesHome,
    );
  }
}

function managedPluginConfigState(state) {
  return {
    enabled:
      Array.isArray(state.enabled.value) &&
      state.enabled.value.includes(PLUGIN_NAME),
    disabled:
      Array.isArray(state.disabled.value) &&
      state.disabled.value.includes(PLUGIN_NAME),
    override: state.override.exists
      ? { exists: true, value: state.override.value }
      : { exists: false },
  };
}

function pluginConfigStatesMatch(left, right) {
  return (
    JSON.stringify(managedPluginConfigState(left)) ===
    JSON.stringify(managedPluginConfigState(right))
  );
}

function requirePluginConfigRemoved(state) {
  const managed = managedPluginConfigState(state);
  if (managed.enabled || managed.disabled || managed.override.exists) {
    throw new Error(
      "Hermes plugin settings changed during removal, so Louder Bridge restored the previous installation.",
    );
  }
}

async function setBooleanConfigValue(hermes, key, value, run, hermesHome) {
  await runHermes(
    hermes,
    ["config", "set", "--force", key, String(Boolean(value))],
    run,
    hermesHome,
  );
}

async function applyPluginConfigState(
  hermes,
  current,
  desired,
  run,
  hermesHome,
  configFile,
  expectedFile,
) {
  await removePluginConfigEntries(
    hermes,
    current,
    run,
    hermesHome,
    configFile,
    expectedFile,
  );
  const enabled = Array.isArray(desired.enabled.value) &&
    desired.enabled.value.includes(PLUGIN_NAME);
  const disabled = Array.isArray(desired.disabled.value) &&
    desired.disabled.value.includes(PLUGIN_NAME);
  if (enabled) {
    const override = desired.override.exists && desired.override.value === true;
    await runHermes(
      hermes,
      [
        "plugins",
        "enable",
        PLUGIN_NAME,
        override ? "--allow-tool-override" : "--no-allow-tool-override",
      ],
      run,
      hermesHome,
    );
  }
  if (disabled) {
    await runHermes(
      hermes,
      ["plugins", "disable", PLUGIN_NAME],
      run,
      hermesHome,
    );
  }
  if (desired.override.exists) {
    await setBooleanConfigValue(
      hermes,
      "plugins.entries.louder-bridge.allow_tool_override",
      desired.override.value,
      run,
      hermesHome,
    );
  } else {
    await unsetConfigValue(
      hermes,
      "plugins.entries.louder-bridge.allow_tool_override",
      run,
      hermesHome,
    );
  }
}

async function rollbackPluginConfig({
  hermes,
  run,
  hermesHome,
  configFile,
  stateBefore,
  stateAfter,
}) {
  const currentFile = configFileSnapshot(configFile);
  const currentState = await pluginConfigSnapshot(hermes, run, hermesHome);
  requireConfigSnapshot(configFile, currentFile);
  if (!pluginConfigStatesMatch(currentState, stateAfter)) {
    throw new Error(
      "Hermes plugin settings changed during setup, so Louder Bridge left them untouched.",
    );
  }
  await applyPluginConfigState(
    hermes,
    currentState,
    stateBefore,
    run,
    hermesHome,
    configFile,
    currentFile,
  );
}

function installedHermesPluginLocations(homeDirectory) {
  const hermesDirectory = path.resolve(homeDirectory, ".hermes");
  const locations = [
    hermesPluginLocation(
      homeDirectory,
      path.join(hermesDirectory, "config.yaml"),
    ),
  ];
  const profilesDirectory = path.join(hermesDirectory, "profiles");
  const profiles = entry(profilesDirectory);
  if (profiles?.isDirectory() && !profiles.isSymbolicLink()) {
    for (const profile of fs.readdirSync(profilesDirectory, {
      withFileTypes: true,
    })) {
      if (!profile.isDirectory() || profile.isSymbolicLink()) continue;
      locations.push(
        hermesPluginLocation(
          homeDirectory,
          path.join(profilesDirectory, profile.name, "config.yaml"),
        ),
      );
    }
  }
  return locations.filter(({ target }) => entry(target));
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
  const { configFile, hermesHome, target } = await activeHermesPluginLocation(
    homeDirectory,
    hermes,
    run,
  );
  const parent = path.dirname(target);
  const staging = path.join(parent, `.${PLUGIN_NAME}.${randomUUID()}.tmp`);
  const backup = path.join(parent, `.${PLUGIN_NAME}.${randomUUID()}.previous`);
  const previous = requireOwnedPlugin(target);
  const fileBefore = configFileSnapshot(configFile);
  const stateBefore = await pluginConfigSnapshot(hermes, run, hermesHome);
  requireConfigSnapshot(configFile, fileBefore);
  let enableStarted = false;
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
    enableStarted = true;
    await runHermes(
      hermes,
      ["plugins", "enable", PLUGIN_NAME, "--no-allow-tool-override"],
      run,
      hermesHome,
    );
    const fileAfter = configFileSnapshot(configFile);
    const stateAfter = await pluginConfigSnapshot(hermes, run, hermesHome);
    requireConfigSnapshot(configFile, fileAfter);
    return {
      installed: true,
      hermes,
      target,
      backup: previous ? backup : null,
      configFile,
      stateBefore,
      stateAfter,
      hermesHome,
      run,
    };
  } catch (error) {
    let rollbackError = null;
    if (enableStarted && entry(target)) {
      try {
        const currentFile = configFileSnapshot(configFile);
        const currentState = await pluginConfigSnapshot(
          hermes,
          run,
          hermesHome,
        );
        requireConfigSnapshot(configFile, currentFile);
        await applyPluginConfigState(
          hermes,
          currentState,
          stateBefore,
          run,
          hermesHome,
          configFile,
          currentFile,
        );
      } catch (caught) {
        rollbackError = caught;
      }
    }
    removeDirectory(staging);
    removeDirectory(target);
    if (entry(backup)) fs.renameSync(backup, target);
    if (rollbackError) {
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
  await rollbackPluginConfig(transaction);
  removeDirectory(transaction.target);
  if (transaction.backup) fs.renameSync(transaction.backup, transaction.target);
}

export function commitHermesPluginInstallation(transaction) {
  if (transaction?.backup) removeDirectory(transaction.backup);
}

export async function removeHermesPlugin({
  homeDirectory = os.homedir(),
  hermes = findHermesExecutable(),
  run = execFileAsync,
} = {}) {
  const locations = installedHermesPluginLocations(homeDirectory);
  if (locations.length === 0) {
    return { removed: false, targets: [] };
  }
  for (const { target } of locations) requireOwnedPlugin(target);
  if (!hermes) {
    throw new Error(
      "Hermes is not executable, so its plugin settings were left unchanged.",
    );
  }
  const removals = [];
  try {
    for (const location of locations) {
      removals.push(await removeHermesPluginLocation(location, hermes, run));
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const removal of removals.reverse()) {
      try {
        await rollbackHermesPluginRemovalEntry(removal);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Hermes plugin removal failed and could not be fully rolled back.",
      );
    }
    throw error;
  }
  return {
    removed: true,
    target: removals[0].target,
    targets: removals.map(({ target }) => target),
    removals,
  };
}

async function removeHermesPluginLocation(location, hermes, run) {
  const { configFile, hermesHome, target } = location;
  const fileBefore = configFileSnapshot(configFile);
  const stateBefore = await pluginConfigSnapshot(hermes, run, hermesHome);
  requireConfigSnapshot(configFile, fileBefore);
  const backup = path.join(
    path.dirname(target),
    `.${PLUGIN_NAME}.${randomUUID()}.removing`,
  );
  fs.renameSync(target, backup);
  try {
    await removePluginConfigEntries(
      hermes,
      stateBefore,
      run,
      hermesHome,
      configFile,
      fileBefore,
    );
    const fileAfter = configFileSnapshot(configFile);
    const stateAfter = await pluginConfigSnapshot(hermes, run, hermesHome);
    requireConfigSnapshot(configFile, fileAfter);
    requirePluginConfigRemoved(stateAfter);
    return {
      target,
      backup,
      hermes,
      run,
      hermesHome,
      configFile,
      stateBefore,
      stateAfter,
    };
  } catch (error) {
    fs.renameSync(backup, target);
    try {
      const currentFile = configFileSnapshot(configFile);
      const currentState = await pluginConfigSnapshot(hermes, run, hermesHome);
      requireConfigSnapshot(configFile, currentFile);
      await applyPluginConfigState(
        hermes,
        currentState,
        stateBefore,
        run,
        hermesHome,
        configFile,
        currentFile,
      );
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Hermes plugin removal failed and its configuration could not be restored.",
      );
    }
    throw error;
  }
}

async function rollbackHermesPluginRemovalEntry(removal) {
  if (entry(removal.target)) {
    throw new Error(
      "A new Hermes louder-bridge plugin appeared during rollback.",
    );
  }
  fs.renameSync(removal.backup, removal.target);
  await rollbackPluginConfig(removal);
}

export async function rollbackHermesPluginRemoval(transaction) {
  if (!transaction?.removed) return;
  for (const removal of [...transaction.removals].reverse()) {
    await rollbackHermesPluginRemovalEntry(removal);
  }
}

export function commitHermesPluginRemoval(transaction) {
  for (const removal of transaction?.removals ?? []) {
    removeDirectory(removal.backup);
  }
}
