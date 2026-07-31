import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inputMonitoringStatus } from "./macos/input-monitoring.mjs";
import { accessibilityStatus } from "./macos/accessibility.mjs";
import { startBridge } from "./server.mjs";

const execFileAsync = promisify(execFile);

export async function isClaudeDesktopRunning(run = execFileAsync) {
  try {
    await run("/usr/bin/pgrep", ["-x", "Claude"]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

export async function startDesktopService({
  checkClaude = isClaudeDesktopRunning,
  createBridge = startBridge,
  pollInterval = 1000,
  logger = console,
  authToken,
  checkInputMonitoring = inputMonitoringStatus,
  checkAccessibility = accessibilityStatus,
  onPermissionGranted = () => process.kill(process.pid, "SIGTERM"),
} = {}) {
  const bridge = await createBridge({
    autoConnectDevice: false,
    logger,
    runtimeMode: "service",
    authToken,
  });
  bridge.setRuntimeStatus?.({ claudeDesktop: "closed" });
  let claudeWasRunning = false;
  let deviceRequested = false;
  let previousPermission = null;
  let previousAccessibility = null;
  let stopped = false;
  let update = Promise.resolve();

  async function sync() {
    if (stopped) return;
    const permission = checkInputMonitoring();
    const accessibility = checkAccessibility();
    bridge.setRuntimeStatus?.({
      inputMonitoring: permission,
      accessibility,
    });
    if (
      (
        previousPermission &&
        previousPermission !== "granted" &&
        permission === "granted"
      ) ||
      (
        previousAccessibility &&
        previousAccessibility !== "granted" &&
        accessibility === "granted"
      )
    ) {
      previousPermission = permission;
      previousAccessibility = accessibility;
      logger.info(
        "A required macOS permission was granted. Restarting the background agent.",
      );
      onPermissionGranted();
      return;
    }
    previousPermission = permission;
    previousAccessibility = accessibility;
    const claudeIsRunning = await checkClaude();
    bridge.setRuntimeStatus?.({
      claudeDesktop: claudeIsRunning ? "open" : "closed",
    });
    if (
      !claudeIsRunning ||
      permission !== "granted" ||
      accessibility !== "granted"
    ) {
      if (deviceRequested) {
        logger.info(
          claudeIsRunning
            ? "A required macOS permission is unavailable. Releasing Codex Micro."
            : "Claude Desktop closed. Releasing Codex Micro.",
        );
        await bridge.disconnectDevice();
        deviceRequested = false;
      }
      claudeWasRunning = claudeIsRunning;
      return;
    }
    if (!deviceRequested) {
      if (!claudeWasRunning) {
        logger.info("Claude Desktop opened. Connecting Codex Micro...");
      }
      await bridge.connectDevice();
      deviceRequested = true;
      claudeWasRunning = true;
    }
  }

  function queueSync() {
    update = update.then(sync).catch((error) => logger.error(error));
    return update;
  }

  await queueSync();
  const timer = setInterval(queueSync, pollInterval);

  return {
    bridge,
    sync: queueSync,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await update;
      await bridge.stop();
    },
  };
}
