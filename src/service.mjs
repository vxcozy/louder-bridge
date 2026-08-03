import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inputMonitoringStatus } from "./macos/input-monitoring.mjs";
import { accessibilityStatus } from "./macos/accessibility.mjs";
import { showCodexContentionNotice } from "./macos/contention-notice.mjs";
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
  notifyContention = showCodexContentionNotice,
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
  let contentionNoticeShown = false;
  let deviceRequested = false;
  let deviceReleasePending = false;
  let previousPermission = null;
  let previousAccessibility = null;
  let stopped = false;
  let stopPromise = null;
  let update = Promise.resolve();
  let syncRunning = false;
  let syncRequested = false;

  async function releaseDevice() {
    deviceRequested = false;
    deviceReleasePending = true;
    await bridge.disconnectDevice();
    deviceReleasePending = false;
  }

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
    const [claudeResult, codexResult] = await Promise.allSettled([
      checkClaude(),
      checkCodex(),
    ]);
    const claudeIsRunning =
      claudeResult.status === "fulfilled" ? claudeResult.value : null;
    const codexIsRunning =
      codexResult.status === "fulfilled" ? codexResult.value : null;
    bridge.setRuntimeStatus?.({
      claudeDesktop:
        claudeIsRunning === null
          ? "unknown"
          : (claudeIsRunning ? "open" : "closed"),
      codexDesktop:
        codexIsRunning === null
          ? "unknown"
          : (codexIsRunning ? "open" : "closed"),
    });
    const processFailures = [claudeResult, codexResult]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (processFailures.length) {
      let cleanupError = null;
      if (deviceRequested || deviceReleasePending) {
        try {
          await releaseDevice();
        } catch (error) {
          cleanupError = error;
        }
      }
      if (cleanupError) {
        throw new AggregateError(
          [...processFailures, cleanupError],
          "Louder Bridge could not check the open desktop apps or release the Codex Micro cleanly.",
        );
      }
      if (processFailures.length === 1) throw processFailures[0];
      throw new AggregateError(
        processFailures,
        "Louder Bridge could not check whether Claude or Codex is open.",
      );
    }
    const contentionIsActive = claudeIsRunning && codexIsRunning;
    if (contentionIsActive && !contentionWasActive) {
      logger.info(
        "Codex is also open. Waiting to give the Micro to Claude.",
      );
    }
    if (!contentionIsActive) contentionNoticeShown = false;
    contentionWasActive = contentionIsActive;
    if (
      !claudeIsRunning ||
      permission !== "granted" ||
      accessibility !== "granted"
    ) {
      if (deviceRequested || deviceReleasePending) {
        logger.info(
          claudeIsRunning
            ? "A required macOS permission is unavailable. Releasing Codex Micro."
            : "Claude Desktop closed. Releasing Codex Micro.",
        );
        await releaseDevice();
      }
      claudeWasRunning = claudeIsRunning;
      return;
    }
    if (contentionIsActive) {
      if (deviceRequested || deviceReleasePending) {
        await releaseDevice();
      }
      if (!contentionNoticeShown) {
        contentionNoticeShown = true;
        const reportNoticeFailure = () => {
          logger.error("Could not show the Codex conflict notice.");
        };
        try {
          if (notifyContention({ onError: reportNoticeFailure }) === false) {
            reportNoticeFailure();
          }
        } catch {
          reportNoticeFailure();
        }
      }
      claudeWasRunning = true;
      return;
    }
    if (!deviceRequested) {
      if (!claudeWasRunning) {
        logger.info("Claude Desktop opened. Connecting Codex Micro...");
      }
      await bridge.connectDevice();
      deviceRequested = true;
      deviceReleasePending = false;
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
