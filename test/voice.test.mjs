import test from "node:test";
import assert from "node:assert/strict";
import { ClaudeAccessibilityVoice } from "../src/claude/voice.mjs";

test("routes start and stop through the installed native launcher", async () => {
  const calls = [];
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  await voice.start();
  assert.equal(voice.status().state, "recording");
  await voice.stop();
  assert.equal(voice.status().state, "idle");
  assert.deepEqual(
    calls.map((call) => call.args),
    [["--claude-dictation-start"], ["--claude-dictation-stop"]],
  );
  assert.equal(calls[0].options.timeout, 5000);
});

test("reports native dictation failures in diagnostics", async () => {
  let failStart = true;
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/launcher",
    async run(command, args) {
      if (args[0].endsWith("-start") && failStart) {
        const error = new Error("command failed");
        error.stderr = "Claude did not start dictation.";
        throw error;
      }
    },
  });

  await assert.rejects(() => voice.start(), /Claude did not start dictation/);
  assert.equal(voice.status().state, "error");
  assert.equal(
    voice.status().error,
    "Claude did not start dictation.",
  );
  await voice.stop();
  assert.equal(voice.status().state, "idle");
  assert.equal(
    voice.status().error,
    "Claude did not start dictation.",
  );

  failStart = false;
  await voice.start();
  assert.equal(voice.status().state, "recording");
  assert.equal(voice.status().error, null);
});
