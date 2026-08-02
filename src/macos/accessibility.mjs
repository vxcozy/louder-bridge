import { spawnSync } from "node:child_process";
import { isNativeExecutable } from "./native-executable.mjs";

const VALID_STATES = new Set(["granted", "denied", "unknown"]);
const STATUS_OPTIONS = {
  encoding: "utf8",
  timeout: 2000,
  maxBuffer: 1024,
  windowsHide: true,
};

export function accessibilityStatus({
  launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
  environment = process.env,
  platform = process.platform,
  run = spawnSync,
} = {}) {
  if (VALID_STATES.has(environment.LOUDER_ACCESSIBILITY_STATUS)) {
    return environment.LOUDER_ACCESSIBILITY_STATUS;
  }
  if (platform !== "darwin" || !launcher || !isNativeExecutable(launcher)) {
    return "unknown";
  }
  const result = run(launcher, ["--accessibility-status"], STATUS_OPTIONS);
  const state = result.stdout?.trim();
  return result.status === 0 && VALID_STATES.has(state) ? state : "unknown";
}
