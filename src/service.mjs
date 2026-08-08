import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { inputMonitoringStatus } from "./macos/input-monitoring.mjs";
import { accessibilityStatus } from "./macos/accessibility.mjs";
import { showCodexContentionNotice } from "./macos/contention-notice.mjs";
import { startBridge } from "./server.mjs";

const execFileAsync = promisify(execFile);
const PROCESS_CHECK_TIMEOUT_MS = 2000;

function surfaceName(surface) {
  if (surface === "hermes") return "Hermes Desktop";
  if (surface === "ghostty") return "Ghostty";
  return "Claude Desktop";
}

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

export function isHermesDesktopRunning(run = execFileAsync) {
  return isNamedProcessRunning(["Hermes"], run);
}

export function isGhosttyRunning(run = execFileAsync) {
  return isNamedProcessRunning(["ghostty", "Ghostty"], run);
}

export function terminalAgentsFromProcessList(output) {
  const processes = new Map();
  const ghosttyProcesses = new Set();
  const supportedAgents = new Map();

  for (const line of String(output).split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
    if (!match) continue;
    const [, pid, parentPid, tty, command] = match;
    const executable = path.basename(command).toLowerCase();
    processes.set(pid, parentPid);
    if (executable === "ghostty") ghosttyProcesses.add(pid);
    if (tty !== "??" && ["claude", "codex", "hermes"].includes(executable)) {
      supportedAgents.set(pid, executable);
    }
  }

  const agents = new Set();
  for (const [pid, executable] of supportedAgents) {
    const visited = new Set([pid]);
    let ancestor = processes.get(pid);
    while (ancestor && !visited.has(ancestor)) {
      if (ghosttyProcesses.has(ancestor)) {
        agents.add(executable);
        break;
      }
      visited.add(ancestor);
      ancestor = processes.get(ancestor);
    }
  }
  return [...agents];
}

export async function terminalAgentsRunning(run = execFileAsync) {
  const { stdout } = await run(
    "/bin/ps",
    ["-axo", "pid=,ppid=,tty=,comm="],
    {
      timeout: PROCESS_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  return terminalAgentsFromProcessList(stdout);
}

export async function startDesktopService({
  checkClaude = isClaudeDesktopRunning,
  checkCodex = isCodexDesktopRunning,
  checkHermes = isHermesDesktopRunning,
  checkGhostty = isGhosttyRunning,
  checkTerminalAgents = terminalAgentsRunning,
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
    hermesDesktop: "closed",
    ghostty: "closed",
    terminalAgent: "closed",
    codexDesktop: "unknown",
  });
  let previousSurface = null;
  let contentionWasActive = false;
  let surfaceContentionWasActive = false;
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
    const [
      claudeResult,
      codexResult,
      hermesResult,
      ghosttyResult,
      terminalAgentsResult,
    ] = await Promise.allSettled([
      checkClaude(),
      checkCodex(),
      checkHermes(),
      checkGhostty(),
      checkTerminalAgents(),
    ]);
    const claudeIsRunning =
      claudeResult.status === "fulfilled" ? claudeResult.value : null;
    const codexIsRunning =
      codexResult.status === "fulfilled" ? codexResult.value : null;
    const hermesIsRunning =
      hermesResult.status === "fulfilled" ? hermesResult.value : null;
    const ghosttyIsRunning =
      ghosttyResult.status === "fulfilled" ? ghosttyResult.value : null;
    const terminalAgents =
      terminalAgentsResult.status === "fulfilled"
        ? terminalAgentsResult.value
        : null;
    const ghosttyOwnsMicro = Boolean(
      ghosttyIsRunning && Array.isArray(terminalAgents) && terminalAgents.length,
    );
    const supportedSurfaces = [
      claudeIsRunning ? "claude" : null,
      hermesIsRunning ? "hermes" : null,
      ghosttyOwnsMicro ? "ghostty" : null,
    ].filter(Boolean);
    const surface = supportedSurfaces.length === 1 ? supportedSurfaces[0] : null;
    bridge.setRuntimeStatus?.({
      claudeDesktop:
        claudeIsRunning === null
          ? "unknown"
          : (claudeIsRunning ? "open" : "closed"),
      codexDesktop:
        codexIsRunning === null
          ? "unknown"
          : (codexIsRunning ? "open" : "closed"),
      hermesDesktop:
        hermesIsRunning === null
          ? "unknown"
          : (hermesIsRunning ? "open" : "closed"),
      ghostty:
        ghosttyIsRunning === null
          ? "unknown"
          : (ghosttyIsRunning ? "open" : "closed"),
      terminalAgent:
        terminalAgents === null
          ? "unknown"
          : (terminalAgents.length ? "open" : "closed"),
    });
    const processFailures = [
      claudeResult,
      codexResult,
      hermesResult,
      ghosttyResult,
      terminalAgentsResult,
    ]
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
        "Louder Bridge could not check whether a supported app or Codex is open.",
      );
    }
    const contentionIsActive = Boolean(surface && codexIsRunning);
    if (contentionIsActive && !contentionWasActive) {
      logger.info(
        `Codex is also open. Waiting to give the Micro to ${surfaceName(surface)}.`,
      );
    }
    if (!contentionIsActive) contentionNoticeShown = false;
    contentionWasActive = contentionIsActive;
    const surfaceContentionIsActive = supportedSurfaces.length > 1;
    if (surfaceContentionIsActive && !surfaceContentionWasActive) {
      logger.info(
        "More than one supported app is open. Waiting until only one can use the Micro.",
      );
    }
    surfaceContentionWasActive = surfaceContentionIsActive;
    if (
      !surface ||
      permission !== "granted" ||
      accessibility !== "granted"
    ) {
      if (deviceRequested || deviceReleasePending) {
        logger.info(
          surface
            ? "A required macOS permission is unavailable. Releasing Codex Micro."
            : "No supported app owns the Micro. Releasing Codex Micro.",
        );
        await releaseDevice();
      }
      await bridge.setSurface?.(null);
      previousSurface = surface;
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
          if (notifyContention({
            surface: surfaceName(surface),
            onError: reportNoticeFailure,
          }) === false) {
            reportNoticeFailure();
          }
        } catch {
          reportNoticeFailure();
        }
      }
      await bridge.setSurface?.(null);
      previousSurface = surface;
      return;
    }
    await bridge.setSurface?.(surface);
    if (!deviceRequested) {
      if (previousSurface !== surface) {
        logger.info(
          `${surfaceName(surface)} opened. Connecting Codex Micro...`,
        );
      }
      await bridge.connectDevice();
      deviceRequested = true;
      deviceReleasePending = false;
    }
    previousSurface = surface;
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
