import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function needsPermissionOnboarding({
  inputMonitoring,
  accessibility,
}) {
  return inputMonitoring !== "granted" || accessibility !== "granted";
}

export async function openOnboardingApplication(
  app,
  { run = execFileAsync, waitForExit = false } = {},
) {
  const args = waitForExit ? ["-W", "-n", app] : ["-n", app];
  const options = waitForExit ? {} : { timeout: 5000 };
  try {
    await run("/usr/bin/open", args, options);
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || String(error);
    throw new Error(`Louder Bridge could not open for setup: ${detail}`);
  }
}
