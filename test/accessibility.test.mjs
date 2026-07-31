import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accessibilityStatus } from "../src/macos/accessibility.mjs";

test("uses the Accessibility state inherited from the app launcher", () => {
  assert.equal(
    accessibilityStatus({
      environment: { LOUDER_ACCESSIBILITY_STATUS: "granted" },
      platform: "darwin",
    }),
    "granted",
  );
});

test("queries Accessibility through a native launcher", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-accessibility-"),
  );
  const native = path.join(directory, "native");
  fs.writeFileSync(native, Buffer.from("cffaedfe", "hex"));
  const calls = [];
  const state = accessibilityStatus({
    launcher: native,
    environment: {},
    platform: "darwin",
    run(command, args) {
      calls.push([command, ...args]);
      return { status: 0, stdout: "denied\n", stderr: "" };
    },
  });

  assert.equal(state, "denied");
  assert.deepEqual(calls, [[native, "--accessibility-status"]]);
  fs.rmSync(directory, { recursive: true });
});
