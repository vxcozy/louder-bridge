import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeAccessibilitySubmit } from "../src/claude/submit.mjs";

test("routes the Micro send key through the installed launcher", async () => {
  const calls = [];
  const submit = new ClaudeAccessibilitySubmit({
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  await submit.submit();

  assert.deepEqual(calls, [
    {
      command: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
      args: ["--claude-submit"],
      options: { timeout: 5000, windowsHide: true },
    },
  ]);
});

test("reports native send failures without changing their wording", async () => {
  const submit = new ClaudeAccessibilitySubmit({
    launcher: "/launcher",
    async run() {
      const error = new Error("command failed");
      error.stderr = "Bring Claude to the front before using the send key.\n";
      throw error;
    },
  });

  await assert.rejects(
    () => submit.submit(),
    /Bring Claude to the front before using the send key/,
  );
});
