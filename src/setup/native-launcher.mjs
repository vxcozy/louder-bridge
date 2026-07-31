import path from "node:path";
import { spawnSync } from "node:child_process";

function runChecked(command, args, run) {
  const result = run(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail =
      result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`${path.basename(command)} failed: ${detail}`);
  }
  return result;
}

export function compileNativeLauncher({
  sourceRoot,
  output,
  platform = process.platform,
  arch = process.arch,
  run = spawnSync,
} = {}) {
  if (platform !== "darwin" || arch !== "arm64") {
    throw new Error("The native launcher requires macOS on Apple Silicon.");
  }
  if (!sourceRoot || !output) {
    throw new Error("The native launcher requires source and output paths.");
  }
  runChecked(
    "/usr/bin/xcrun",
    [
      "clang",
      "-arch",
      "arm64",
      "-mmacosx-version-min=15.0",
      "-Os",
      path.join(sourceRoot, "native", "launcher.m"),
      "-framework",
      "AppKit",
      "-framework",
      "ApplicationServices",
      "-framework",
      "IOKit",
      "-o",
      output,
    ],
    run,
  );
  return output;
}

export function signLocalApplication({
  app,
  launcher,
  run = spawnSync,
} = {}) {
  if (!app || !launcher) {
    throw new Error("Local signing requires an app and launcher path.");
  }
  runChecked(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", launcher],
    run,
  );
  runChecked(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", app],
    run,
  );
  runChecked(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    run,
  );
  return app;
}
