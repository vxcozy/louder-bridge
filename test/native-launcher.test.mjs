import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compileNativeLauncher,
  compileNativeLauncherAtomically,
  signLocalApplication,
} from "../src/setup/native-launcher.mjs";

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
      "/source/native/launcher.m",
      "/source/native/micro_device.m",
      "-framework",
      "AppKit",
      "-framework",
      "ApplicationServices",
      "-framework",
      "IOKit",
      "-o",
      "/build/LouderBridge",
    ],
  ]);
});

test("ad hoc signs and verifies a local application", () => {
  const calls = [];
  signLocalApplication({
    app: "/Applications/Louder Bridge.app",
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    run(command, args) {
      calls.push([command, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(
    calls.map((call) => call.slice(0, 4)),
    [
      ["/usr/bin/codesign", "--force", "--sign", "-"],
      ["/usr/bin/codesign", "--force", "--sign", "-"],
      ["/usr/bin/codesign", "--verify", "--deep", "--strict"],
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
  compileNativeLauncher({ sourceRoot, output });

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
  compileNativeLauncher({ sourceRoot, output });

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
