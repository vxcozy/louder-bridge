import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { GhosttyTerminalNavigator } from "../src/ghostty/navigator.mjs";
import { GhosttySubmit } from "../src/ghostty/submit.mjs";
import { GhosttyAccessibilityVoice } from "../src/ghostty/voice.mjs";

test("associates sessions with stable Ghostty terminal IDs", async () => {
  const calls = [];
  const navigator = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    async run(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "--ghostty-front-terminal-id") {
        return { stdout: "terminal-42\n" };
      }
      return { stdout: "" };
    },
  });

  assert.equal(await navigator.observe("session-key"), true);
  await navigator.open("session-key");
  assert.deepEqual(calls, [
    ["/launcher", "--ghostty-front-terminal-id"],
    ["/launcher", "--ghostty-focus-terminal", "terminal-42"],
  ]);
  navigator.forget("session-key");
  await assert.rejects(
    () => navigator.open("session-key"),
    /Use this session in Ghostty once/,
  );
});

test("does not retain invalid terminal IDs or expose observation failures", async () => {
  const invalid = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    run: async () => ({ stdout: "terminal id with spaces\n" }),
  });
  assert.equal(await invalid.observe("session-key"), false);
  await assert.rejects(() => invalid.open("session-key"), /associate/);

  const unavailable = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    run: async () => {
      throw new Error("private automation failure");
    },
  });
  assert.equal(await unavailable.observe("session-key"), false);
});

test("routes send and push-to-talk through the native Ghostty controls", async () => {
  const submitCalls = [];
  const submit = new GhosttySubmit({
    launcher: "/launcher",
    async run(command, args) {
      submitCalls.push([command, ...args]);
    },
  });
  await submit.submit();
  assert.deepEqual(submitCalls, [["/launcher", "--ghostty-submit"]]);

  let child;
  const voice = new GhosttyAccessibilityVoice({
    launcher: "/launcher",
    spawnProcess(command, args) {
      child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = {
        destroyed: false,
        writableEnded: false,
        end() {
          this.writableEnded = true;
          queueMicrotask(() => child.emit("exit", 0, null));
        },
      };
      child.kill = () => {};
      queueMicrotask(() => child.stdout.emit("data", "ready macos-dictation\n"));
      assert.equal(command, "/launcher");
      assert.deepEqual(args, ["--ghostty-dictation-hold"]);
      return child;
    },
  });
  await voice.start();
  assert.equal(voice.status().state, "recording");
  assert.equal(voice.status().method, "macos-dictation");
  await voice.stop();
  assert.equal(voice.status().state, "idle");
});
