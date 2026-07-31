import fs from "node:fs";
import { spawnSync } from "node:child_process";

const VALID_STATES = new Set(["granted", "denied", "unknown"]);
const MACHO_MAGICS = new Set([
  "cafebabe",
  "cafebabf",
  "cefaedfe",
  "cffaedfe",
  "feedface",
  "feedfacf",
]);

function isNativeExecutable(filename) {
  try {
    const descriptor = fs.openSync(filename, "r");
    try {
      const prefix = Buffer.alloc(4);
      if (fs.readSync(descriptor, prefix, 0, prefix.length, 0) !== 4) {
        return false;
      }
      return MACHO_MAGICS.has(prefix.toString("hex"));
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return false;
  }
}

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
