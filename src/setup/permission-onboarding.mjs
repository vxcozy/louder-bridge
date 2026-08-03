import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { onboardingApplicationIsRunning } from "./running-application.mjs";

const execFileAsync = promisify(execFile);
const OPEN_TIMEOUT_MS = 5000;
const ONBOARDING_START_TIMEOUT_MS = 5000;
const ONBOARDING_START_POLL_INTERVAL_MS = 100;
const ONBOARDING_TIMEOUT_MS = 11 * 60 * 1000;
const ONBOARDING_POLL_INTERVAL_MS = 1000;
const ONBOARDING_LAUNCH_ATTEMPTS = 5;

async function waitForOnboardingExit({
  launcher,
  signal,
  isRunning = onboardingApplicationIsRunning,
  sleep = delay,
  startTimeoutMs = ONBOARDING_START_TIMEOUT_MS,
  startPollIntervalMs = ONBOARDING_START_POLL_INTERVAL_MS,
  timeoutMs = ONBOARDING_TIMEOUT_MS,
  pollIntervalMs = ONBOARDING_POLL_INTERVAL_MS,
  now = Date.now,
}) {
  const startDeadline = now() + startTimeoutMs;
  let running = isRunning({ launcher });
  while (!running) {
    const remaining = startDeadline - now();
    if (remaining <= 0) return;
    await sleep(Math.min(startPollIntervalMs, remaining), undefined, { signal });
    running = isRunning({ launcher });
  }
  const deadline = now() + timeoutMs;
  while (running) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error("Louder Bridge did not finish permission setup in time.");
    }
    await sleep(Math.min(pollIntervalMs, remaining), undefined, { signal });
    running = isRunning({ launcher });
  }
}

export function needsPermissionOnboarding({
  inputMonitoring,
  accessibility,
}) {
  return inputMonitoring !== "granted" || accessibility !== "granted";
}

export async function openOnboardingApplication(
  app,
  {
    run = execFileAsync,
    signal,
    waitForExit = false,
    launcher = path.join(app, "Contents", "MacOS", "LouderBridge"),
    openTimeoutMs = OPEN_TIMEOUT_MS,
    isRunning,
    sleep,
    startTimeoutMs,
    startPollIntervalMs,
    timeoutMs,
    pollIntervalMs,
    now,
  } = {},
) {
  const options = { timeout: openTimeoutMs };
  if (signal) options.signal = signal;
  try {
    await run("/usr/bin/open", ["-n", app], options);
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || String(error);
    throw new Error(`Louder Bridge could not open for setup: ${detail}`);
  }
  if (waitForExit) {
    await waitForOnboardingExit({
      launcher,
      signal,
      isRunning,
      sleep,
      startTimeoutMs,
      startPollIntervalMs,
      timeoutMs,
      pollIntervalMs,
      now,
    });
  }
}

export async function completePermissionOnboarding(
  app,
  {
    signal,
    isReady,
    openApplication = openOnboardingApplication,
    attempts = ONBOARDING_LAUNCH_ATTEMPTS,
  } = {},
) {
  if (typeof isReady !== "function") {
    throw new TypeError("A readiness check is required for permission setup.");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError("Permission setup attempts must be a positive integer.");
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await openApplication(app, { signal, waitForExit: true });
    if (isReady()) return;
  }
  throw new Error("Louder Bridge closed before the background agent was ready.");
}
