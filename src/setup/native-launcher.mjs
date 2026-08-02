import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
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

export function inspectNativeBuildTools({
  platform = process.platform,
  arch = process.arch,
  run = spawnSync,
} = {}) {
  if (platform !== "darwin" || arch !== "arm64") {
    return {
      available: false,
      compiler: null,
      sdk: null,
      error: "Native build tools require macOS on Apple Silicon.",
    };
  }
  const compiler = run("/usr/bin/xcrun", ["--find", "clang"], {
    encoding: "utf8",
  });
  const sdk = run("/usr/bin/xcrun", ["--show-sdk-path"], {
    encoding: "utf8",
  });
  const compilerPath = compiler.stdout?.trim();
  const sdkPath = sdk.stdout?.trim();
  if (
    compiler.status !== 0 ||
    sdk.status !== 0 ||
    !compilerPath ||
    !sdkPath
  ) {
    return {
      available: false,
      compiler: null,
      sdk: null,
      error: "Install Apple's Command Line Tools before running setup.",
    };
  }
  return {
    available: true,
    compiler: compilerPath,
    sdk: sdkPath,
    error: null,
  };
}

export function compileNativeLauncher({
  sourceRoot,
  output,
  platform = process.platform,
  arch = process.arch,
  testBuild = false,
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
      "-fobjc-arc",
      "-fstack-protector-strong",
      "-D_FORTIFY_SOURCE=2",
      "-fno-common",
      "-Wall",
      "-Wextra",
      "-Werror",
      ...(testBuild ? ["-DLOUDER_TEST_BUILD=1"] : []),
      path.join(sourceRoot, "native", "launcher.m"),
      path.join(sourceRoot, "native", "micro_device.m"),
      "-framework",
      "AppKit",
      "-framework",
      "ApplicationServices",
      "-framework",
      "IOKit",
      "-Wl,-fatal_warnings",
      "-o",
      output,
    ],
    run,
  );
  return output;
}

export function compileNativeLauncherAtomically({
  output,
  ...options
} = {}) {
  if (!output) {
    throw new Error("The native launcher requires an output path.");
  }
  const identifier = randomUUID();
  const compiled = path.join(
    os.tmpdir(),
    `${path.basename(output)}.${identifier}.tmp`,
  );
  const staged = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${identifier}.tmp`,
  );
  try {
    compileNativeLauncher({ ...options, output: compiled });
    fs.copyFileSync(compiled, staged);
    fs.chmodSync(staged, fs.statSync(compiled).mode & 0o777);
    fs.renameSync(staged, output);
  } finally {
    fs.rmSync(compiled, { force: true });
    fs.rmSync(staged, { force: true });
  }
  return output;
}

export function signLocalApplication({
  app,
  launcher,
  node,
  entitlements,
  run = spawnSync,
} = {}) {
  if (!app || !launcher || !node || !entitlements) {
    throw new Error(
      "Local signing requires app, launcher, Node.js, and entitlement paths.",
    );
  }
  runChecked(
    "/usr/bin/codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--entitlements",
      entitlements,
      "--sign",
      "-",
      node,
    ],
    run,
  );
  runChecked(
    "/usr/bin/codesign",
    ["--force", "--options", "runtime", "--sign", "-", launcher],
    run,
  );
  runChecked(
    "/usr/bin/codesign",
    ["--force", "--options", "runtime", "--sign", "-", app],
    run,
  );
  runChecked(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    run,
  );
  return app;
}
