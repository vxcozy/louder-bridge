#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_URL } from "./config.mjs";
import { inspectNativeMicroRuntime } from "./device/native-transport.mjs";
import { inputMonitoringStatus } from "./macos/input-monitoring.mjs";
import { applicationMetadata } from "./runtime/metadata.mjs";
import { startBridge } from "./server.mjs";
import { startDesktopService } from "./service.mjs";
import { createRotatingLogger } from "./logging.mjs";
import { accessibilityStatus } from "./macos/accessibility.mjs";
import { platformSupport } from "./macos/platform.mjs";
import {
  bridgeHookCommand,
  restoreClaudeSettings,
  snapshotClaudeSettings,
  updateClaudeSettings,
} from "./setup/claude-hooks.mjs";
import {
  commitApplicationBundle,
  applicationBundlePathsForCli,
  installApplicationBundle,
  rollbackApplicationBundle,
  stageApplicationBundleRemoval,
} from "./setup/application-bundle.mjs";
import {
  ensureAuthToken,
  readAuthToken,
  removeAuthToken,
} from "./setup/auth-token.mjs";
import {
  compileNativeLauncherAtomically,
  signLocalApplication,
} from "./setup/native-launcher.mjs";
import {
  needsPermissionOnboarding,
  openOnboardingApplication,
} from "./setup/permission-onboarding.mjs";
import { stopOnboardingApplication } from "./setup/running-application.mjs";
import {
  installLaunchAgent,
  launchAgentIsRunning,
  launchAgentPaths,
  removeLaunchAgent,
} from "./setup/launch-agent.mjs";

const command = process.argv[2] ?? "start";
const INPUT_MONITORING_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";
const ACCESSIBILITY_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

function printHelp() {
  console.log(`Usage: louder-bridge <command>

Commands:
  start [--mock-device]  Run in the current terminal
  doctor                Check this Mac and the device runtime
  setup                 Install the app, Claude hooks, and login agent
  status                Show permission, Claude, device, and voice state
  uninstall             Remove the app, hooks, agent, and local token
  simulate <state>      Send a lifecycle state to the installed bridge
  help                  Show this help
  version               Print the Louder Bridge version`);
}

async function doctor() {
  let ready = true;
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const metadata = applicationMetadata();
  const driver = inspectNativeMicroRuntime();
  const permission = inputMonitoringStatus();
  const accessibility = accessibilityStatus();
  const platform = platformSupport();
  console.log(`Louder Bridge: ${metadata.version}`);
  console.log(`Node: ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  if (nodeMajor < 22) {
    console.log("Node check: version 22 or newer is required.");
    ready = false;
  } else {
    console.log("Node check: ready.");
  }
  if (!platform.supported) {
    console.log(`Platform check: ${platform.error}`);
    ready = false;
  } else {
    console.log(
      `Platform check: ready${platform.version ? ` (macOS ${platform.version})` : ""}.`,
    );
  }
  console.log(`Codex Micro driver: ${driver.id} (${driver.support}).`);
  if (!driver.available) {
    console.log(`Codex Micro driver check: ${driver.error}`);
    ready = false;
  } else {
    console.log("Codex Micro driver check: ready.");
  }
  console.log(`Input Monitoring: ${permission}.`);
  if (permission === "denied") ready = false;
  console.log(`Accessibility: ${accessibility}.`);
  if (accessibility === "denied") ready = false;
  console.log(`Result: ${ready ? "ready." : "needs attention."}`);
  if (!ready) process.exitCode = 1;
}

function stopOnSignals(target) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await target.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function openPrivacySettings(url) {
  const child = spawn("/usr/bin/open", [url], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}

function activationDialog(
  message,
  { error = false, settingsLabel } = {},
) {
  const buttons = settingsLabel ? `{"${settingsLabel}"}` : '{"OK"}';
  const icon = error ? "stop" : "note";
  const script = `display dialog (item 1 of argv) with title "Louder Bridge" buttons ${buttons} default button 1 with icon ${icon}`;
  spawnSync("/usr/bin/osascript", ["-e", script, "--", message], {
    stdio: "ignore",
  });
}

if (command === "help" || command === "--help" || command === "-h") {
  printHelp();
} else if (
  command === "version" ||
  command === "--version" ||
  command === "-V"
) {
  console.log(applicationMetadata().version);
} else if (command === "start") {
  const bridge = await startBridge({
    mockDevice: process.argv.includes("--mock-device"),
    authToken: ensureAuthToken().token,
  });
  stopOnSignals(bridge);
} else if (command === "service") {
  const paths = launchAgentPaths();
  const logger = createRotatingLogger(paths);
  try {
    const service = await startDesktopService({
      authToken: readAuthToken(),
      logger,
    });
    stopOnSignals(service);
  } catch (error) {
    logger.error(error);
    process.exitCode = 1;
  }
} else if (command === "doctor") {
  await doctor();
} else if (command === "setup") {
  const platform = platformSupport();
  if (!platform.supported) throw new Error(platform.error);
  stopOnboardingApplication();
  const settingsSnapshot = snapshotClaudeSettings();
  let application;
  let authentication;
  let file;
  let agent;
  let needsOnboarding = false;
  try {
    authentication = ensureAuthToken();
    application = installApplicationBundle({
      prepare(staged) {
        const sourceRoot = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "..",
        );
        compileNativeLauncherAtomically({
          sourceRoot,
          output: staged.launcher,
        });
        signLocalApplication({
          ...staged,
          entitlements: path.join(
            sourceRoot,
            "release",
            "node.entitlements.plist",
          ),
        });
      },
    });
    file = updateClaudeSettings({
      command: bridgeHookCommand({
        nodePath: application.node,
        hookPath: application.hook,
      }),
    });
    agent = removeLaunchAgent();
    needsOnboarding = true;
  } catch (error) {
    restoreClaudeSettings(settingsSnapshot);
    if (application) rollbackApplicationBundle(application);
    if (authentication?.created) removeAuthToken();
    throw error;
  }
  try {
    commitApplicationBundle(application);
  } catch (error) {
    console.warn(
      `Could not remove the previous application backup: ${error.message}`,
    );
  }
  console.log(`Application installed in ${application.app}.`);
  console.log(`Claude Code hooks installed in ${file}.`);
  if (needsOnboarding) {
    openOnboardingApplication(application.app);
    console.log(
      "Louder Bridge is waiting for Input Monitoring and Accessibility approval.",
    );
    console.log(
      "The background agent will start automatically after both permissions are granted.",
    );
  } else {
    console.log(`Background agent installed in ${agent.plist}.`);
    console.log("Louder Bridge will connect when Claude Desktop opens.");
  }
} else if (command === "activate") {
  const runtime = applicationBundlePathsForCli(fileURLToPath(import.meta.url));
  const permission = inputMonitoringStatus({ launcher: runtime.launcher });
  const accessibility = accessibilityStatus({ launcher: runtime.launcher });
  const settingsSnapshot = snapshotClaudeSettings();
  let authentication;
  let file;
  let agent;
  try {
    authentication = ensureAuthToken();
    file = updateClaudeSettings({
      command: bridgeHookCommand({
        nodePath: runtime.node,
        hookPath: runtime.hook,
      }),
    });
    if (needsPermissionOnboarding({
      inputMonitoring: permission,
      accessibility,
    })) {
      removeLaunchAgent();
    } else {
      agent = installLaunchAgent({ runtime });
    }
  } catch (error) {
    restoreClaudeSettings(settingsSnapshot);
    if (authentication?.created) removeAuthToken();
    activationDialog(`Setup failed: ${error.message}`, { error: true });
    process.exitCode = 1;
  }
  if (!process.exitCode) {
    console.log(`Claude Code hooks installed in ${file}.`);
    if (agent) {
      console.log(`Background agent installed in ${agent.plist}.`);
      activationDialog(
        "Louder Bridge is ready. Open Claude Desktop and turn on the Codex Micro.",
      );
    } else {
      const needsInputMonitoring = permission !== "granted";
      const label = needsInputMonitoring
        ? "Open Input Monitoring"
        : "Open Accessibility";
      activationDialog(
        `${needsInputMonitoring ? "Input Monitoring" : "Accessibility"} is still off. Enable Louder Bridge, then open Louder Bridge again.`,
        { settingsLabel: label },
      );
      openPrivacySettings(
        needsInputMonitoring ? INPUT_MONITORING_URL : ACCESSIBILITY_URL,
      );
    }
  }
} else if (command === "uninstall") {
  const settingsSnapshot = snapshotClaudeSettings();
  let currentApp;
  try {
    currentApp = applicationBundlePathsForCli(
      fileURLToPath(import.meta.url),
    ).app;
  } catch {}
  const application = stageApplicationBundleRemoval({
    ...(currentApp ? { app: currentApp } : {}),
  });
  let file;
  let agent;
  try {
    file = updateClaudeSettings({ remove: true });
    agent = removeLaunchAgent();
  } catch (error) {
    restoreClaudeSettings(settingsSnapshot);
    rollbackApplicationBundle(application);
    throw error;
  }
  try {
    commitApplicationBundle(application);
  } catch (error) {
    console.warn(`Could not remove the application backup: ${error.message}`);
  }
  removeAuthToken();
  console.log(`Background agent removed from ${agent.plist}.`);
  console.log(`Claude Code hooks removed from ${file}.`);
} else if (command === "status") {
  const paths = launchAgentPaths();
  console.log(
    `Background agent: ${launchAgentIsRunning() ? "running" : "not running"}`,
  );
  try {
    const authToken = readAuthToken();
    const response = await fetch(`${BRIDGE_URL}/health`, {
      headers: { authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    console.log("Hook server: ready");
    console.log(`Louder Bridge: ${health.service?.version ?? "unknown"}`);
    console.log(`Node runtime: ${health.service?.nodeVersion ?? "unknown"}`);
    console.log(`Claude Desktop: ${health.service?.claudeDesktop ?? "unknown"}`);
    const codexDesktop = health.service?.codexDesktop ?? "unknown";
    console.log(
      `Codex: ${codexDesktop}${
        codexDesktop === "open"
          ? " (MIC and send controls may reach both apps)"
          : ""
      }`,
    );
    console.log(
      `Input Monitoring: ${health.service?.inputMonitoring ?? "unknown"}`,
    );
    console.log(
      `Accessibility: ${health.service?.accessibility ?? "unknown"}`,
    );
    console.log(
      `Codex Micro: ${health.service?.device?.state ?? "unknown"}`,
    );
    const runtime = health.service?.device?.runtime;
    if (runtime) {
      console.log(`Codex Micro driver: ${runtime.id} (${runtime.support})`);
      console.log(`Codex Micro firmware: ${runtime.version ?? "unavailable"}`);
      if (runtime.transport) {
        console.log(`Micro connection: ${runtime.transport}`);
      }
    }
    console.log(
      `Last Claude hook: ${health.service?.lastHookAt ?? "none received"}`,
    );
    console.log(
      `Last device event: ${health.service?.device?.lastEventAt ?? "none received"}`,
    );
    if (health.service?.device?.error) {
      console.log(`Device error: ${health.service.device.error}`);
    }
    const voice = health.service?.voice;
    if (voice) {
      console.log(`Voice input: ${voice.state} (${voice.support})`);
      if (voice.method) {
        console.log(
          `Voice control: ${
            voice.method === "claude-composer"
              ? "Claude composer"
              : "macOS Dictation"
          }`,
        );
      }
      if (voice.error) console.log(`Voice error: ${voice.error}`);
    }
  } catch (error) {
    console.log(`Hook server: unavailable (${error.message})`);
  }
  console.log(`Log: ${paths.stdout}`);
  console.log(`Error log: ${paths.stderr}`);
} else if (command === "simulate") {
  const state = process.argv[3] ?? "running";
  const eventByState = {
    idle: "SessionStart",
    running: "UserPromptSubmit",
    needs_input: "PermissionRequest",
    complete: "Stop",
    error: "StopFailure",
    off: "SessionEnd",
  };
  const hookEvent = eventByState[state];
  if (!hookEvent) {
    console.error(
      `Unknown simulated state "${state}". Choose idle, running, needs_input, complete, error, or off.`,
    );
    process.exitCode = 2;
  } else {
    const response = await fetch(`${BRIDGE_URL}/hook`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${readAuthToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        session_id:
          process.argv[4] ?? "00000000-0000-4000-8000-000000000001",
        cwd: process.cwd(),
        hook_event_name: hookEvent,
      }),
    });
    console.log(await response.text());
  }
} else {
  console.error(
    `Unknown command "${command}". Choose start, service, doctor, setup, activate, status, uninstall, or simulate.`,
  );
  process.exitCode = 2;
}
