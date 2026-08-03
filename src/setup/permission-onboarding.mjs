import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { onboardingApplicationIsRunning } from "./running-application.mjs";

const execFileAsync = promisify(execFile);
const OPEN_TIMEOUT_MS = 5000;
const ONBOARDING_TIMEOUT_MS = 11 * 60 * 1000;
const ONBOARDING_POLL_INTERVAL_MS = 1000;

function openCommandTimedOut(error, signal) {
  return !signal?.aborted && error?.killed === true;
}

async function waitForOnboardingExit({
  launcher,
  signal,
  isRunning = onboardingApplicationIsRunning,
  sleep = delay,
  timeoutMs = ONBOARDING_TIMEOUT_MS,
  pollIntervalMs = ONBOARDING_POLL_INTERVAL_MS,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  while (isRunning({ launcher })) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error("Louder Bridge did not finish permission setup in time.");
    }
    await sleep(Math.min(pollIntervalMs, remaining), undefined, { signal });
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
    timeoutMs,
    pollIntervalMs,
    now,
  } = {},
) {
  const args = waitForExit ? ["-W", "-n", app] : ["-n", app];
  const options = { timeout: openTimeoutMs };
  if (signal) options.signal = signal;
  try {
    await run("/usr/bin/open", args, options);
  } catch (error) {
    if (waitForExit && openCommandTimedOut(error, signal)) {
      await waitForOnboardingExit({
        launcher,
        signal,
        isRunning,
        sleep,
        timeoutMs,
        pollIntervalMs,
        now,
      });
      return;
    }
    const detail = error?.stderr?.trim() || error?.message || String(error);
    throw new Error(`Louder Bridge could not open for setup: ${detail}`);
  }
}
