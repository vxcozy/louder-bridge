import { spawnSync } from "node:child_process";
import { applicationBundlePaths } from "./application-bundle.mjs";

function escapeExtendedRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function commandError(command, result) {
  const detail = result.stderr?.trim() || `exit ${result.status}`;
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
    { encoding: "utf8" },
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
    { encoding: "utf8" },
  );
  if (stopped.status === 1) return false;
  if (stopped.status !== 0) throw commandError("pkill", stopped);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const active = run(
      "/usr/bin/pgrep",
      ["-f", pattern],
      { encoding: "utf8" },
    );
    if (active.status === 1) return true;
    if (active.status !== 0) throw commandError("pgrep", active);
    const waited = run("/bin/sleep", ["0.1"], { encoding: "utf8" });
    if (waited.status !== 0) throw commandError("sleep", waited);
  }
  throw new Error("The previous Louder Bridge app did not close in time.");
}
