import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
      "/source/native/launcher.m",
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
