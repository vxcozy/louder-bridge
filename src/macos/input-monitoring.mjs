import { spawnSync } from "node:child_process";
import { isNativeExecutable } from "./native-executable.mjs";

const VALID_STATES = new Set(["granted", "denied", "unknown"]);

export function inputMonitoringStatus({
  launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
  environment = process.env,
  platform = process.platform,
  run = spawnSync,
} = {}) {
  if (VALID_STATES.has(environment.LOUDER_INPUT_MONITORING_STATUS)) {
    return environment.LOUDER_INPUT_MONITORING_STATUS;
  }
  if (platform !== "darwin" || !launcher || !isNativeExecutable(launcher)) {
    return "unknown";
  }
  const result = run(launcher, ["--input-monitoring-status"], {
    encoding: "utf8",
  });
  const state = result.stdout?.trim();
  return result.status === 0 && VALID_STATES.has(state) ? state : "unknown";
}
