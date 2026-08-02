import { spawnSync } from "node:child_process";
import { isNativeExecutable } from "../macos/native-executable.mjs";
import { applicationBundlePaths } from "./application-bundle.mjs";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PERMISSION_PATTERN = /^(granted|denied|unknown) (granted|denied|unknown)$/;
const PROBE_OPTIONS = {
  encoding: "utf8",
  maxBuffer: 1024,
  timeout: 10_000,
};

export function installedApplicationStatus({
  launcher = process.env.LOUDER_BRIDGE_LAUNCHER ??
    applicationBundlePaths().launcher,
  run = spawnSync,
} = {}) {
  if (!isNativeExecutable(launcher)) {
    return {
      available: false,
      version: null,
      inputMonitoring: "unknown",
      accessibility: "unknown",
    };
  }
  let version = null;
  let inputMonitoring = "unknown";
  let accessibility = "unknown";
  try {
    const result = run(launcher, ["--version"], PROBE_OPTIONS);
    const candidate =
      typeof result?.stdout === "string" ? result.stdout.trim() : "";
    if (result?.status === 0 && VERSION_PATTERN.test(candidate)) {
      version = candidate;
    }
  } catch {}
  try {
    const result = run(
      launcher,
      ["--permission-status-fresh"],
      PROBE_OPTIONS,
    );
    const candidate =
      typeof result?.stdout === "string" ? result.stdout.trim() : "";
    const match = result?.status === 0
      ? PERMISSION_PATTERN.exec(candidate)
      : null;
    if (match) {
      inputMonitoring = match[1];
      accessibility = match[2];
    }
  } catch {}
  return {
    available: true,
    version,
    inputMonitoring,
    accessibility,
  };
}
