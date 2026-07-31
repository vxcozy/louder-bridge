import os from "node:os";
import { spawnSync } from "node:child_process";

export const MINIMUM_MACOS_MAJOR = 15;

export function macOSVersion({
  platform = process.platform,
  run = spawnSync,
} = {}) {
  if (platform !== "darwin") return null;
  const result = run("/usr/bin/sw_vers", ["-productVersion"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const version = result.stdout?.trim();
  return /^\d+(?:\.\d+){0,2}$/.test(version ?? "") ? version : null;
}

export function platformSupport({
  platform = process.platform,
  arch = process.arch,
  version = macOSVersion({ platform }),
  release = os.release(),
} = {}) {
  if (platform !== "darwin" || arch !== "arm64") {
    return {
      supported: false,
      version,
      error: "macOS on Apple Silicon is required.",
    };
  }

  const versionMajor = Number(version?.split(".")[0]);
  const darwinMajor = Number(release.split(".")[0]);
  const meetsMinimum =
    Number.isInteger(versionMajor) && versionMajor >= MINIMUM_MACOS_MAJOR;
  const fallbackMeetsMinimum =
    version === null &&
    Number.isInteger(darwinMajor) &&
    darwinMajor >= 24;

  if (!meetsMinimum && !fallbackMeetsMinimum) {
    return {
      supported: false,
      version,
      error: `macOS ${MINIMUM_MACOS_MAJOR} or newer is required.`,
    };
  }

  return { supported: true, version, error: null };
}
