import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ghosttyAutomationStatus } from "../src/macos/automation.mjs";

test("uses the Ghostty Automation state inherited from onboarding", () => {
  assert.equal(
    ghosttyAutomationStatus({
      environment: { LOUDER_GHOSTTY_AUTOMATION_STATUS: "granted" },
      platform: "linux",
    }),
    "granted",
  );
});

test("queries Ghostty Automation through the native launcher", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-automation-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const launcher = path.join(directory, "LouderBridge");
  fs.writeFileSync(launcher, Buffer.from("cffaedfe", "hex"));
  const calls = [];

  const state = ghosttyAutomationStatus({
    launcher,
    environment: {},
    platform: "darwin",
    run(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: "not-requested\n" };
    },
  });

  assert.equal(state, "not-requested");
  assert.deepEqual(calls, [{
    command: launcher,
    args: ["--ghostty-automation-status"],
    options: {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 1024,
      windowsHide: true,
    },
  }]);
});

test("contains invalid Ghostty Automation status output", () => {
  assert.equal(
    ghosttyAutomationStatus({
      launcher: "/missing/LouderBridge",
      environment: {},
      platform: "darwin",
    }),
    "unknown",
  );
});
