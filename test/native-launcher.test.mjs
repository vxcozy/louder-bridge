import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compileNativeLauncher,
  compileNativeLauncherAtomically,
  inspectNativeBuildTools,
  signLocalApplication,
  stabilizeNativeLauncherUuid,
} from "../src/setup/native-launcher.mjs";

test("checks the compiler and macOS SDK before source setup", () => {
  const calls = [];
  const tools = inspectNativeBuildTools({
    platform: "darwin",
    arch: "arm64",
    run(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout:
          args[0] === "--find"
            ? "/usr/bin/clang\n"
            : "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk\n",
      };
    },
  });

  assert.deepEqual(tools, {
    available: true,
    compiler: "/usr/bin/clang",
    sdk: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
    error: null,
  });
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/xcrun",
      args: ["--find", "clang"],
      options: { encoding: "utf8" },
    },
    {
      command: "/usr/bin/xcrun",
      args: ["--show-sdk-path"],
      options: { encoding: "utf8" },
    },
  ]);
});

test("reports missing source build tools before setup", () => {
  const missing = inspectNativeBuildTools({
    platform: "darwin",
    arch: "arm64",
    run: () => ({ status: 1, stdout: "" }),
  });
  assert.equal(missing.available, false);
  assert.match(missing.error, /Install Apple's Command Line Tools/);

  const incomplete = inspectNativeBuildTools({
    platform: "darwin",
    arch: "arm64",
    run: () => ({ status: 0, stdout: "" }),
  });
  assert.equal(incomplete.available, false);

  const unsupported = inspectNativeBuildTools({
    platform: "darwin",
    arch: "x64",
  });
  assert.equal(unsupported.available, false);
  assert.match(unsupported.error, /Apple Silicon/);
});

test("compiles the launcher for the supported deployment target", () => {
  const calls = [];
  const output = compileNativeLauncher({
    sourceRoot: "/source",
    output: "/build/LouderBridge",
    platform: "darwin",
    arch: "arm64",
    run(command, args) {
      calls.push([command, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(output, "/build/LouderBridge");
  assert.deepEqual(calls, [
    [
      "/usr/bin/xcrun",
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
      "/source/native/launcher.m",
      "/source/native/micro_device.m",
      "-framework",
      "AppKit",
      "-framework",
      "ApplicationServices",
      "-framework",
      "IOKit",
      "-Wl,-fatal_warnings",
      "-o",
      "/build/LouderBridge",
    ],
  ]);
});

test("unchanged local launcher builds are byte-for-byte stable", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("Stable local launchers require Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-stable-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const firstDirectory = path.join(directory, "first");
  const secondDirectory = path.join(directory, "second");
  fs.mkdirSync(firstDirectory);
  fs.mkdirSync(secondDirectory);
  const first = path.join(firstDirectory, "LouderBridge");
  const second = path.join(secondDirectory, "LouderBridge");

  compileNativeLauncher({ sourceRoot, output: first });
  compileNativeLauncher({ sourceRoot, output: second });
  const firstUuid = stabilizeNativeLauncherUuid(first);
  const secondUuid = stabilizeNativeLauncherUuid(second);

  assert.equal(firstUuid, secondUuid);
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  const signed = spawnSync(
    "/usr/bin/codesign",
    ["--force", "--sign", "-", first],
    { encoding: "utf8" },
  );
  assert.equal(signed.status, 0, signed.stderr);
  const launched = spawnSync(first, ["--version"]);
  assert.equal(launched.signal, null);
  assert.equal(launched.status, 1);
});

test("rejects UUID normalization for a non-Mach-O file", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-invalid-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const filename = path.join(directory, "LouderBridge");
  fs.writeFileSync(filename, "not a native launcher", { mode: 0o700 });

  assert.throws(
    () => stabilizeNativeLauncherUuid(filename),
    /not a thin 64-bit Mach-O file/,
  );
});

test("ad hoc signs and verifies a local application", () => {
  const calls = [];
  signLocalApplication({
    app: "/Applications/Louder Bridge.app",
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    node: "/Applications/Louder Bridge.app/Contents/MacOS/node",
    entitlements: "/source/release/node.entitlements.plist",
    run(command, args) {
      calls.push([command, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(
    calls,
    [
      [
        "/usr/bin/codesign",
        "--force",
        "--options",
        "runtime",
        "--entitlements",
        "/source/release/node.entitlements.plist",
        "--sign",
        "-",
        "/Applications/Louder Bridge.app/Contents/MacOS/node",
      ],
      [
        "/usr/bin/codesign",
        "--force",
        "--options",
        "runtime",
        "--sign",
        "-",
        "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
      ],
      [
        "/usr/bin/codesign",
        "--force",
        "--options",
        "runtime",
        "--sign",
        "-",
        "/Applications/Louder Bridge.app",
      ],
      [
        "/usr/bin/codesign",
        "--verify",
        "--deep",
        "--strict",
        "--verbose=2",
        "/Applications/Louder Bridge.app",
      ],
    ],
  );
});

test("reports compiler failures with their diagnostic", () => {
  assert.throws(
    () =>
      compileNativeLauncher({
        sourceRoot: "/source",
        output: "/build/LouderBridge",
        platform: "darwin",
        arch: "arm64",
        run: () => ({
          status: 1,
          stdout: "",
          stderr: "compiler unavailable",
        }),
      }),
    /xcrun failed: compiler unavailable/,
  );
});

test("atomically replaces an existing launcher after compilation", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-launcher-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  fs.writeFileSync(output, "old launcher");

  compileNativeLauncherAtomically({
    sourceRoot: "/source",
    output,
    platform: "darwin",
    arch: "arm64",
    run(command, args) {
      fs.writeFileSync(args.at(-1), "new launcher");
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(fs.readFileSync(output, "utf8"), "new launcher");
  assert.deepEqual(fs.readdirSync(directory), ["LouderBridge"]);
});

test("keeps the existing launcher when compilation fails", (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-launcher-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  fs.writeFileSync(output, "old launcher");

  assert.throws(
    () =>
      compileNativeLauncherAtomically({
        sourceRoot: "/source",
        output,
        platform: "darwin",
        arch: "arm64",
        run: () => ({
          status: 1,
          stdout: "",
          stderr: "compiler unavailable",
        }),
      }),
    /xcrun failed: compiler unavailable/,
  );
  assert.equal(fs.readFileSync(output, "utf8"), "old launcher");
  assert.deepEqual(fs.readdirSync(directory), ["LouderBridge"]);
});

test("excludes native test interfaces from production launchers", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("The native launcher requires Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-production-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  compileNativeLauncher({ sourceRoot, output });

  for (const args of [
    ["--test-micro-frame", "usb", '{}'],
    ["--test-micro-command", '{}'],
    ["--test-composer-gesture", "hold"],
    ["--test-permission-wait", "grant"],
    ["--test-input-monitoring-request", "grant"],
  ]) {
    const result = spawnSync(output, args, { encoding: "utf8" });
    assert.equal(result.status, 2, args[0]);
    assert.match(result.stderr, /Unknown Louder Bridge option/, args[0]);
  }
});

test("frames Codex Micro reports for USB and Bluetooth", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("The native Codex Micro driver requires Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-protocol-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  compileNativeLauncher({ sourceRoot, output, testBuild: true });

  const payload = '{"m":"x"}';
  const usb = spawnSync(
    output,
    ["--test-micro-frame", "usb", payload],
    { encoding: "utf8" },
  );
  const bluetooth = spawnSync(
    output,
    ["--test-micro-frame", "bluetooth", payload],
    { encoding: "utf8" },
  );
  assert.equal(usb.status, 0);
  assert.equal(bluetooth.status, 0);
  assert.equal(usb.stdout.trim().length, 63 * 2);
  assert.equal(bluetooth.stdout.trim().length, 64 * 2);
  assert.match(usb.stdout, /^020b7b226d223a2278227d0d0a/);
  assert.match(bluetooth.stdout, /^06020b7b226d223a2278227d0d0a/);
});

test("allows only the Codex Micro methods used by the bridge", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("The native Codex Micro driver requires Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-allowlist-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  compileNativeLauncher({ sourceRoot, output, testBuild: true });

  for (const method of [
    "device.status",
    "v.oai.rgbcfg",
    "v.oai.thstatus",
  ]) {
    const result = spawnSync(
      output,
      ["--test-micro-command", JSON.stringify({ m: method })],
    );
    assert.equal(result.status, 0, method);
  }
  for (const payload of [
    '{"m":"fs.write"}',
    '{"m":"device.bootloader"}',
    '{"m":"firmware.update"}',
    "not-json",
  ]) {
    const result = spawnSync(
      output,
      ["--test-micro-command", payload],
    );
    assert.equal(result.status, 2, payload);
  }
});

test("uses complete clicks for toggle dictation controls", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("The native Claude adapter requires Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-dictation-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  compileNativeLauncher({ sourceRoot, output, testBuild: true });

  const hold = spawnSync(
    output,
    ["--test-composer-gesture", "hold"],
    { encoding: "utf8" },
  );
  const toggle = spawnSync(
    output,
    ["--test-composer-gesture", "toggle"],
    { encoding: "utf8" },
  );

  assert.equal(hold.status, 0);
  assert.equal(hold.stdout.trim(), "mouse-down mouse-up");
  assert.equal(toggle.status, 0);
  assert.equal(toggle.stdout.trim(), "click click");
});

test("writes permission probes only to private single-link files", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("The native permission helper requires Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-permission-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  compileNativeLauncher({ sourceRoot, output, testBuild: true });

  const identifier = `${process.pid}.${randomUUID()}`;
  const probe = `/tmp/app.louder-bridge.permission.${identifier}`;
  fs.writeFileSync(probe, "", { flag: "wx", mode: 0o600 });
  context.after(() => fs.rmSync(probe, { force: true }));
  const result = spawnSync(output, ["--permission-probe", probe], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(probe, "utf8"), /^\d+ [01]\n$/);

  const target = `/tmp/louder-permission-target.${identifier}`;
  const hardlink = `/tmp/app.louder-bridge.permission.link.${identifier}`;
  fs.writeFileSync(target, "keep this", { flag: "wx", mode: 0o600 });
  fs.linkSync(target, hardlink);
  context.after(() => fs.rmSync(target, { force: true }));
  context.after(() => fs.rmSync(hardlink, { force: true }));
  const rejected = spawnSync(output, ["--permission-probe", hardlink]);
  assert.equal(rejected.status, 1);
  assert.equal(fs.readFileSync(target, "utf8"), "keep this");
});

test("bounds permission onboarding while allowing a later grant", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("The native permission helper requires Apple Silicon.");
    return;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-native-permission-wait-"),
  );
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const output = path.join(directory, "LouderBridge");
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  compileNativeLauncher({ sourceRoot, output, testBuild: true });

  const granted = spawnSync(output, ["--test-permission-wait", "grant"], {
    encoding: "utf8",
  });
  const timedOut = spawnSync(
    output,
    ["--test-permission-wait", "timeout"],
    { encoding: "utf8" },
  );
  const deadline = spawnSync(
    output,
    ["--test-permission-wait", "deadline"],
    { encoding: "utf8" },
  );
  const invalid = spawnSync(output, ["--test-permission-wait", "invalid"]);

  assert.equal(granted.status, 0);
  assert.equal(granted.stdout.trim(), "granted 2");
  assert.equal(timedOut.status, 0);
  assert.equal(timedOut.stdout.trim(), "timed-out 3");
  assert.equal(deadline.status, 0);
  assert.equal(deadline.stdout.trim(), "timed-out 1");
  assert.equal(invalid.status, 2);

  const requestGranted = spawnSync(
    output,
    ["--test-input-monitoring-request", "grant"],
    { encoding: "utf8" },
  );
  const requestDenied = spawnSync(
    output,
    ["--test-input-monitoring-request", "deny"],
    { encoding: "utf8" },
  );
  assert.equal(requestGranted.status, 0);
  assert.equal(requestGranted.stdout.trim(), "granted");
  assert.equal(requestDenied.status, 3);
  assert.equal(requestDenied.stdout.trim(), "denied");
});
