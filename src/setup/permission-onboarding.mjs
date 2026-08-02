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
  { run = execFileAsync } = {},
) {
  try {
    await run("/usr/bin/open", ["-n", app], { timeout: 5000 });
  } catch (error) {
    const detail = error?.stderr?.trim() || error?.message || String(error);
    throw new Error(`Louder Bridge could not open for setup: ${detail}`);
  }
}
