import { spawn } from "node:child_process";

export function needsPermissionOnboarding({
  inputMonitoring,
  accessibility,
}) {
  return inputMonitoring !== "granted" || accessibility !== "granted";
}

export function openOnboardingApplication(
  app,
  { spawnProcess = spawn } = {},
) {
  const child = spawnProcess("/usr/bin/open", ["-n", app], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}
