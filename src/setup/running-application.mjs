import { spawnSync } from "node:child_process";
import { applicationBundlePaths } from "./application-bundle.mjs";

const PROCESS_OPTIONS = {
  encoding: "utf8",
  timeout: 5000,
  maxBuffer: 64 * 1024,
  windowsHide: true,
};
const SLEEP_OPTIONS = { ...PROCESS_OPTIONS, timeout: 2000 };

function escapeExtendedRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function commandError(command, result) {
  const detail =
    result?.error?.message ||
    result?.stderr?.trim() ||
    result?.stdout?.trim() ||
    `exit ${result?.status ?? "unknown"}`;
  return new Error(`${command} failed: ${detail}`);
}

export function onboardingApplicationIsRunning({
  launcher = applicationBundlePaths().launcher,
  run = spawnSync,
} = {}) {
  const pattern = `^${escapeExtendedRegex(launcher)}$`;
  const result = run(
    "/usr/bin/pgrep",
    ["-f", pattern],
    PROCESS_OPTIONS,
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw commandError("pgrep", result);
}

export function stopOnboardingApplication({
  launcher = applicationBundlePaths().launcher,
  run = spawnSync,
  attempts = 20,
} = {}) {
  const pattern = `^${escapeExtendedRegex(launcher)}$`;
  const stopped = run(
    "/usr/bin/pkill",
    ["-TERM", "-f", pattern],
    PROCESS_OPTIONS,
  );
  if (stopped.status === 1) return false;
  if (stopped.status !== 0) throw commandError("pkill", stopped);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const active = run(
      "/usr/bin/pgrep",
      ["-f", pattern],
      PROCESS_OPTIONS,
    );
    if (active.status === 1) return true;
    if (active.status !== 0) throw commandError("pgrep", active);
    const waited = run("/bin/sleep", ["0.1"], SLEEP_OPTIONS);
    if (waited.status !== 0) throw commandError("sleep", waited);
  }
  throw new Error("The previous Louder Bridge app did not close in time.");
}
