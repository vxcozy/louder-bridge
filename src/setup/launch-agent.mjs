import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  BRIDGE_HOST,
  BRIDGE_PORT,
} from "../config.mjs";
import { applicationBundlePaths } from "./application-bundle.mjs";
import { writeFileAtomic } from "./atomic-file.mjs";

export const LAUNCH_AGENT_LABEL = "app.louder-bridge.agent";
const MAX_PLIST_BYTES = 1024 * 1024;
const COMMAND_OPTIONS = {
  encoding: "utf8",
  timeout: 10_000,
  maxBuffer: 64 * 1024,
  windowsHide: true,
};
const SLEEP_OPTIONS = { ...COMMAND_OPTIONS, timeout: 2000 };

function commandError(command, result) {
  const detail =
    result?.error?.message ||
    result?.stderr?.trim() ||
    result?.stdout?.trim() ||
    `exit ${result?.status ?? "unknown"}`;
  return new Error(`${command} failed: ${detail}`);
}

function prepareLogDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    const entry = fs.fstatSync(descriptor);
    if (!entry.isDirectory() || entry.uid !== process.getuid()) {
      throw new Error("not a user-owned directory");
    }
    fs.fchmodSync(descriptor, 0o700);
  } catch (error) {
    throw new Error(
      "Louder Bridge log storage is not a user-owned directory.",
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readLaunchAgentPlist(filename) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(
      "The existing Louder Bridge launch agent is not a regular file.",
      { cause: error },
    );
  }
  try {
    const entry = fs.fstatSync(descriptor);
    if (
      !entry.isFile() ||
      entry.uid !== process.getuid() ||
      entry.nlink !== 1 ||
      entry.size > MAX_PLIST_BYTES
    ) {
      throw new Error(
        "The existing Louder Bridge launch agent is not a regular user-owned file.",
      );
    }
    return {
      contents: fs.readFileSync(descriptor, "utf8"),
      mode: entry.mode & 0o777,
      identity: { device: entry.dev, inode: entry.ino },
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function sameLaunchAgentState(expected, current) {
  if (expected === null || current === null) return expected === current;
  return (
    expected.identity.device === current.identity.device &&
    expected.identity.inode === current.identity.inode &&
    expected.contents === current.contents &&
    expected.mode === current.mode
  );
}

function requireLaunchAgentState(filename, expected, message) {
  const current = readLaunchAgentPlist(filename);
  if (!sameLaunchAgentState(expected, current)) throw new Error(message);
  return current;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgentPaths(homeDirectory = os.homedir()) {
  const logs = path.join(homeDirectory, "Library", "Logs", "LouderBridge");
  return {
    plist: path.join(
      homeDirectory,
      "Library",
      "LaunchAgents",
      `${LAUNCH_AGENT_LABEL}.plist`,
    ),
    logs,
    stdout: path.join(logs, "bridge.log"),
    stderr: path.join(logs, "bridge-error.log"),
  };
}

export function launchAgentPlist({
  runtime = applicationBundlePaths(),
  workingDirectory = runtime.workingDirectory,
  paths = launchAgentPaths(),
  environment = {
    LOUDER_BRIDGE_HOST: BRIDGE_HOST,
    LOUDER_BRIDGE_PORT: String(BRIDGE_PORT),
    LOUDER_BRIDGE_LAUNCHER: runtime.launcher,
  },
} = {}) {
  const environmentXml = Object.entries(environment)
    .filter(([, value]) => value !== "")
    .map(
      ([key, value]) =>
        `      <key>${xmlEscape(key)}</key>\n      <string>${xmlEscape(value)}</string>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LAUNCH_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xmlEscape(runtime.launcher)}</string>
      <string>--service</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(workingDirectory)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${environmentXml}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
  </dict>
</plist>
`;
}

function runLaunchctl(args, { allowFailure = false, run = spawnSync } = {}) {
  const result = run("/bin/launchctl", args, COMMAND_OPTIONS);
  if (!allowFailure && result.status !== 0) {
    throw commandError(`launchctl ${args[0]}`, result);
  }
  return result;
}

function bootoutLaunchAgent(serviceTarget, run) {
  const result = runLaunchctl(["bootout", serviceTarget], {
    allowFailure: true,
    run,
  });
  if (
    result.status !== 0 &&
    !/could not find service|no such process|not found/i.test(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )
  ) {
    throw commandError("launchctl bootout", result);
  }
}

function bootstrapLaunchAgent(userId, plist, run) {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = runLaunchctl(["bootstrap", `gui/${userId}`, plist], {
      allowFailure: true,
      run,
    });
    if (result.status === 0) return;
    if (attempt < 2) {
      const waited = run("/bin/sleep", ["0.5"], SLEEP_OPTIONS);
      if (waited.status !== 0) throw commandError("sleep", waited);
    }
  }
  throw commandError("launchctl bootstrap", result);
}

export async function installLaunchAgent({
  homeDirectory = os.homedir(),
  userId = process.getuid(),
  run = spawnSync,
  runtime = applicationBundlePaths(homeDirectory),
  verify = async () => {},
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The background service currently requires macOS.");
  }
  const paths = launchAgentPaths(homeDirectory);
  prepareLogDirectory(paths.logs);
  const serviceTarget = `gui/${userId}/${LAUNCH_AGENT_LABEL}`;
  const previous = readLaunchAgentPlist(paths.plist);
  const previousPlist = previous?.contents ?? null;
  const wasLoaded =
    runLaunchctl(["print", serviceTarget], {
      allowFailure: true,
      run,
    }).status === 0;

  const replacementPlist = launchAgentPlist({ paths, runtime });
  let replacement = null;
  let replacementPublished = false;
  try {
    bootoutLaunchAgent(serviceTarget, run);
    writeFileAtomic(paths.plist, replacementPlist, {
      mode: 0o644,
      beforeRename() {
        requireLaunchAgentState(
          paths.plist,
          previous,
          "The launch-agent file changed before setup could replace it.",
        );
      },
    });
    replacementPublished = true;
    replacement = readLaunchAgentPlist(paths.plist);
    if (
      replacement === null ||
      replacement.contents !== replacementPlist ||
      replacement.mode !== 0o644
    ) {
      throw new Error(
        "The replacement launch-agent file changed before setup could load it.",
      );
    }
    bootstrapLaunchAgent(userId, paths.plist, run);
    runLaunchctl(["kickstart", "-k", serviceTarget], { run });
    await verify(paths);
  } catch (error) {
    try {
      bootoutLaunchAgent(serviceTarget, run);
    } catch (rollbackError) {
      error.message += ` Rollback could not stop the replacement agent: ${rollbackError.message}.`;
    }
    let fileRestored = false;
    try {
      if (replacementPublished) {
        if (replacement === null) {
          throw new Error(
            "The replacement launch-agent file could not be identified. It was left untouched.",
          );
        }
        requireLaunchAgentState(
          paths.plist,
          replacement,
          "The launch-agent file changed during rollback. It was left untouched.",
        );
        if (previousPlist === null) {
          fs.unlinkSync(paths.plist);
        } else {
          writeFileAtomic(paths.plist, previousPlist, {
            mode: previous.mode,
            beforeRename() {
              requireLaunchAgentState(
                paths.plist,
                replacement,
                "The launch-agent file changed during rollback. It was left untouched.",
              );
            },
          });
        }
      } else {
        requireLaunchAgentState(
          paths.plist,
          previous,
          "The launch-agent file changed during rollback. It was left untouched.",
        );
      }
      fileRestored = true;
    } catch (rollbackError) {
      error.message += ` Rollback could not restore the previous launch-agent file: ${rollbackError.message}`;
    }
    if (fileRestored && previousPlist !== null && wasLoaded) {
      try {
        bootstrapLaunchAgent(userId, paths.plist, run);
        runLaunchctl(
          ["kickstart", "-k", serviceTarget],
          { allowFailure: true, run },
        );
      } catch (rollbackError) {
        error.message += ` Rollback also failed: ${rollbackError.message}.`;
      }
    }
    throw error;
  }
  return paths;
}

export function removeLaunchAgent({
  homeDirectory = os.homedir(),
  userId = process.getuid(),
  run = spawnSync,
} = {}) {
  if (process.platform !== "darwin") return launchAgentPaths(homeDirectory);
  const paths = launchAgentPaths(homeDirectory);
  const serviceTarget = `gui/${userId}/${LAUNCH_AGENT_LABEL}`;
  const previous = readLaunchAgentPlist(paths.plist);
  const previousPlist = previous?.contents ?? null;
  const wasLoaded =
    runLaunchctl(["print", serviceTarget], {
      allowFailure: true,
      run,
    }).status === 0;
  try {
    bootoutLaunchAgent(serviceTarget, run);
    requireLaunchAgentState(
      paths.plist,
      previous,
      "The launch-agent file changed before removal. It was left untouched.",
    );
    if (previous !== null) fs.unlinkSync(paths.plist);
  } catch (error) {
    if (wasLoaded && previous !== null) {
      try {
        requireLaunchAgentState(
          paths.plist,
          previous,
          "The previous launch-agent file changed before it could be reloaded.",
        );
        bootoutLaunchAgent(serviceTarget, run);
        bootstrapLaunchAgent(userId, paths.plist, run);
        runLaunchctl(["kickstart", "-k", serviceTarget], {
          allowFailure: true,
          run,
        });
      } catch (rollbackError) {
        error.message += ` Rollback also failed: ${rollbackError.message}.`;
      }
    }
    throw error;
  }
  return {
    ...paths,
    previousPlist,
    previousMode: previous?.mode ?? null,
    wasLoaded,
    userId,
    removed: true,
  };
}

export function restoreRemovedLaunchAgent(
  removal,
  { run = spawnSync } = {},
) {
  if (!removal?.removed) return removal;
  if (process.platform !== "darwin") return removal;
  const serviceTarget = `gui/${removal.userId}/${LAUNCH_AGENT_LABEL}`;
  if (removal.previousPlist === null) {
    requireLaunchAgentState(
      removal.plist,
      null,
      "A launch-agent file appeared during rollback. It was left untouched.",
    );
    return removal;
  }
  requireLaunchAgentState(
    removal.plist,
    null,
    "A launch-agent file appeared during rollback. It was left untouched.",
  );
  bootoutLaunchAgent(serviceTarget, run);
  writeFileAtomic(removal.plist, removal.previousPlist, {
    mode: removal.previousMode,
    beforeRename() {
      requireLaunchAgentState(
        removal.plist,
        null,
        "A launch-agent file appeared during rollback. It was left untouched.",
      );
    },
  });
  const restored = readLaunchAgentPlist(removal.plist);
  if (
    restored === null ||
    restored.contents !== removal.previousPlist ||
    restored.mode !== removal.previousMode
  ) {
    throw new Error(
      "The restored launch-agent file changed before rollback could finish.",
    );
  }
  if (removal.wasLoaded) {
    requireLaunchAgentState(
      removal.plist,
      restored,
      "The restored launch-agent file changed before it could be loaded.",
    );
    bootstrapLaunchAgent(removal.userId, removal.plist, run);
    runLaunchctl(["kickstart", "-k", serviceTarget], { run });
  }
  return removal;
}

export function launchAgentIsRunning({
  userId = process.getuid(),
  run = spawnSync,
} = {}) {
  if (process.platform !== "darwin") return false;
  const result = runLaunchctl(
    ["print", `gui/${userId}/${LAUNCH_AGENT_LABEL}`],
    { allowFailure: true, run },
  );
  return result.status === 0 && /\bstate = running\b/.test(result.stdout ?? "");
}

export function waitForLaunchAgent({
  userId = process.getuid(),
  run = spawnSync,
  attempts = 20,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Launch agent wait attempts must be a positive integer.");
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (launchAgentIsRunning({ userId, run })) return true;
    if (attempt + 1 < attempts) {
      const waited = run("/bin/sleep", ["0.1"], SLEEP_OPTIONS);
      if (waited.status !== 0) throw commandError("sleep", waited);
    }
  }
  return false;
}
