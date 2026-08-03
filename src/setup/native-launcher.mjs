import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
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

export function stabilizeNativeLauncherUuid(filename) {
  const descriptor = fs.openSync(
    filename,
    fs.constants.O_RDWR | fs.constants.O_NOFOLLOW,
  );
  try {
    const entry = fs.fstatSync(descriptor);
    if (!entry.isFile() || entry.uid !== process.getuid() || entry.nlink !== 1) {
      throw new Error("The compiled native launcher is not a private regular file.");
    }
    const executable = fs.readFileSync(descriptor);
    if (executable.length < 32 || executable.readUInt32LE(0) !== 0xfeedfacf) {
      throw new Error("The compiled native launcher is not a thin 64-bit Mach-O file.");
    }
    const commandCount = executable.readUInt32LE(16);
    const commandBytes = executable.readUInt32LE(20);
    const commandsEnd = 32 + commandBytes;
    if (commandsEnd > executable.length) {
      throw new Error("The compiled native launcher has invalid load commands.");
    }

    let offset = 32;
    let uuidOffset = null;
    for (let index = 0; index < commandCount; index += 1) {
      if (offset + 8 > commandsEnd) {
        throw new Error("The compiled native launcher has invalid load commands.");
      }
      const command = executable.readUInt32LE(offset);
      const commandSize = executable.readUInt32LE(offset + 4);
      if (commandSize < 8 || offset + commandSize > commandsEnd) {
        throw new Error("The compiled native launcher has invalid load commands.");
      }
      if (command === 0x1b) {
        if (commandSize !== 24 || uuidOffset !== null) {
          throw new Error("The compiled native launcher has an invalid UUID command.");
        }
        uuidOffset = offset + 8;
      }
      offset += commandSize;
    }
    if (uuidOffset === null) {
      throw new Error("The compiled native launcher has no UUID command.");
    }

    executable.fill(0, uuidOffset, uuidOffset + 16);
    const uuid = createHash("sha256").update(executable).digest().subarray(0, 16);
    uuid[6] = (uuid[6] & 0x0f) | 0x50;
    uuid[8] = (uuid[8] & 0x3f) | 0x80;
    fs.writeSync(descriptor, uuid, 0, uuid.length, uuidOffset);
    fs.fsyncSync(descriptor);
    return uuid.toString("hex");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function compileNativeLauncherAtomically({
  output,
  stableUuid = false,
  ...options
} = {}) {
  if (!output) {
    throw new Error("The native launcher requires an output path.");
  }
  const identifier = randomUUID();
  const compileDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "app.louder-bridge.compile."),
  );
  const compiled = path.join(compileDirectory, path.basename(output));
  const staged = path.join(
    path.dirname(output),
    `.${path.basename(output)}.${identifier}.tmp`,
  );
  try {
    compileNativeLauncher({ ...options, output: compiled });
    if (stableUuid) stabilizeNativeLauncherUuid(compiled);
    fs.copyFileSync(compiled, staged);
    fs.chmodSync(staged, fs.statSync(compiled).mode & 0o777);
    fs.renameSync(staged, output);
  } finally {
    fs.rmSync(compileDirectory, { recursive: true, force: true });
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
