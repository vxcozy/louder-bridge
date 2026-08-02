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
  const result = run("/bin/launchctl", args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`launchctl ${args[0]} failed: ${detail}`);
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
    const detail = result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`launchctl bootout failed: ${detail}`);
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
    if (attempt < 2) run("/bin/sleep", ["0.5"], { encoding: "utf8" });
  }
  const detail = result.stderr?.trim() || `exit ${result.status}`;
  throw new Error(`launchctl bootstrap failed: ${detail}`);
}

export function installLaunchAgent({
  homeDirectory = os.homedir(),
  userId = process.getuid(),
  run = spawnSync,
  runtime = applicationBundlePaths(homeDirectory),
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The background service currently requires macOS.");
  }
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.logs, 0o700);
  const serviceTarget = `gui/${userId}/${LAUNCH_AGENT_LABEL}`;
  const previousPlist = fs.existsSync(paths.plist)
    ? fs.readFileSync(paths.plist, "utf8")
    : null;
  const wasLoaded =
    runLaunchctl(["print", serviceTarget], {
      allowFailure: true,
      run,
    }).status === 0;

  bootoutLaunchAgent(serviceTarget, run);

  try {
    writeFileAtomic(paths.plist, launchAgentPlist({ paths, runtime }), {
      mode: 0o644,
    });
    bootstrapLaunchAgent(userId, paths.plist, run);
    runLaunchctl(["kickstart", "-k", serviceTarget], { run });
  } catch (error) {
    try {
      bootoutLaunchAgent(serviceTarget, run);
    } catch (rollbackError) {
      error.message += ` Rollback could not stop the replacement agent: ${rollbackError.message}.`;
    }
    if (previousPlist === null) {
      if (fs.existsSync(paths.plist)) fs.unlinkSync(paths.plist);
    } else {
      writeFileAtomic(paths.plist, previousPlist, { mode: 0o644 });
      if (wasLoaded) {
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
  const previousPlist = fs.existsSync(paths.plist)
    ? fs.readFileSync(paths.plist, "utf8")
    : null;
  const wasLoaded =
    runLaunchctl(["print", serviceTarget], {
      allowFailure: true,
      run,
    }).status === 0;
  bootoutLaunchAgent(serviceTarget, run);
  try {
    if (fs.existsSync(paths.plist)) fs.unlinkSync(paths.plist);
  } catch (error) {
    if (wasLoaded) {
      try {
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
  bootoutLaunchAgent(serviceTarget, run);
  if (removal.previousPlist === null) {
    if (fs.existsSync(removal.plist)) fs.unlinkSync(removal.plist);
    return removal;
  }
  writeFileAtomic(removal.plist, removal.previousPlist, { mode: 0o644 });
  if (removal.wasLoaded) {
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
      const waited = run("/bin/sleep", ["0.1"], { encoding: "utf8" });
      if (waited.status !== 0) throw commandError("sleep", waited);
    }
  }
  return false;
}
