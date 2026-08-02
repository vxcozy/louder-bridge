import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inputMonitoringStatus } from "./macos/input-monitoring.mjs";
import { accessibilityStatus } from "./macos/accessibility.mjs";
import { startBridge } from "./server.mjs";

const execFileAsync = promisify(execFile);
const PROCESS_CHECK_TIMEOUT_MS = 2000;

async function isNamedProcessRunning(names, run) {
  for (const name of names) {
    try {
      await run("/usr/bin/pgrep", ["-x", name], {
        timeout: PROCESS_CHECK_TIMEOUT_MS,
        maxBuffer: 1024,
        windowsHide: true,
      });
      return true;
    } catch (error) {
      if (error?.code !== 1) throw error;
    }
  }
  return false;
}

export function isClaudeDesktopRunning(run = execFileAsync) {
  return isNamedProcessRunning(["Claude"], run);
}

export function isCodexDesktopRunning(run = execFileAsync) {
  return isNamedProcessRunning(["ChatGPT", "Codex"], run);
}

export async function startDesktopService({
  checkClaude = isClaudeDesktopRunning,
  checkCodex = isCodexDesktopRunning,
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
  bridge.setRuntimeStatus?.({
    claudeDesktop: "closed",
    codexDesktop: "unknown",
  });
  let claudeWasRunning = false;
  let contentionWasActive = false;
  let deviceRequested = false;
  let previousPermission = null;
  let previousAccessibility = null;
  let stopped = false;
  let stopPromise = null;
  let update = Promise.resolve();
  let syncRunning = false;
  let syncRequested = false;

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
    const [claudeIsRunning, codexIsRunning] = await Promise.all([
      checkClaude(),
      checkCodex(),
    ]);
    bridge.setRuntimeStatus?.({
      claudeDesktop: claudeIsRunning ? "open" : "closed",
      codexDesktop: codexIsRunning ? "open" : "closed",
    });
    const contentionIsActive = claudeIsRunning && codexIsRunning;
    if (contentionIsActive && !contentionWasActive) {
      logger.info(
        "Codex is also open. MIC and send controls may reach both apps.",
      );
    }
    contentionWasActive = contentionIsActive;
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
    if (stopped) return update;
    syncRequested = true;
    if (syncRunning) return update;
    syncRunning = true;
    update = (async () => {
      try {
        while (syncRequested && !stopped) {
          syncRequested = false;
          try {
            await sync();
          } catch (error) {
            logger.error(error);
          }
        }
      } finally {
        syncRunning = false;
      }
    })();
    return update;
  }

  await queueSync();
  const timer = setInterval(queueSync, pollInterval);

  return {
    bridge,
    sync: queueSync,
    stop() {
      stopPromise ??= (async () => {
        stopped = true;
        clearInterval(timer);
        await update;
        await bridge.stop();
      })();
      return stopPromise;
    },
  };
}
