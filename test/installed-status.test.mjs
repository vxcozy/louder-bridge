import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installedApplicationStatus } from "../src/setup/installed-status.mjs";

test("reports the installed version and fresh permission states", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-status-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const launcher = path.join(directory, "LouderBridge");
  fs.writeFileSync(launcher, Buffer.from("cffaedfe", "hex"));
  const calls = [];

  assert.deepEqual(
    installedApplicationStatus({
      launcher,
      run(command, args, options) {
        calls.push({ command, args, options });
        return {
          status: 0,
          stdout:
            args[0] === "--version"
              ? "0.1.0\n"
              : "denied granted\n",
          stderr: "",
        };
      },
    }),
    {
      available: true,
      version: "0.1.0",
      inputMonitoring: "denied",
      accessibility: "granted",
    },
  );
  assert.deepEqual(calls, [
    {
      command: launcher,
      args: ["--version"],
      options: { encoding: "utf8", maxBuffer: 1024, timeout: 10_000 },
    },
    {
      command: launcher,
      args: ["--permission-status-fresh"],
      options: { encoding: "utf8", maxBuffer: 1024, timeout: 10_000 },
    },
  ]);
});

test("does not execute a missing or non-native launcher", () => {
  let calls = 0;
  const status = installedApplicationStatus({
    launcher: "/missing/LouderBridge",
    run() {
      calls += 1;
    },
  });

  assert.deepEqual(status, {
    available: false,
    version: null,
    inputMonitoring: "unknown",
    accessibility: "unknown",
  });
  assert.equal(calls, 0);
});

test("contains invalid version output", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-status-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const launcher = path.join(directory, "LouderBridge");
  fs.writeFileSync(launcher, Buffer.from("cffaedfe", "hex"));

  const status = installedApplicationStatus({
    launcher,
    run(command, args) {
      if (args[0] === "--version") {
        return { status: 0, stdout: "private output\n", stderr: "" };
      }
      throw new Error("private probe detail");
    },
  });

  assert.equal(status.available, true);
  assert.equal(status.version, null);
  assert.equal(status.inputMonitoring, "unknown");
  assert.equal(status.accessibility, "unknown");
});
