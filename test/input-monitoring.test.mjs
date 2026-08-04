import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inputMonitoringStatus } from "../src/macos/input-monitoring.mjs";

test("uses the permission state inherited from the app launcher", () => {
  assert.equal(
    inputMonitoringStatus({
      environment: { LOUDER_INPUT_MONITORING_STATUS: "granted" },
      platform: "darwin",
    }),
    "granted",
  );
});

test("queries a native launcher without executing shell launchers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-permission-"));
  const native = path.join(directory, "native");
  const script = path.join(directory, "script");
  fs.writeFileSync(native, Buffer.from("cffaedfe", "hex"));
  fs.writeFileSync(script, "#!/bin/sh\n");
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: "denied\n", stderr: "" };
  };

  assert.equal(
    inputMonitoringStatus({
      launcher: native,
      environment: {},
      platform: "darwin",
      run,
    }),
    "denied",
  );
  assert.equal(
    inputMonitoringStatus({
      launcher: script,
      environment: {},
      platform: "darwin",
      run,
    }),
    "unknown",
  );
  assert.deepEqual(calls, [
    {
      command: native,
      args: ["--input-monitoring-status"],
      options: {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 1024,
        windowsHide: true,
      },
    },
  ]);
  fs.rmSync(directory, { recursive: true });
});
