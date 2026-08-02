import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ClaudeAccessibilityVoice } from "../src/claude/voice.mjs";

function fakeChild({
  ready = true,
  method = "claude-composer",
  exitCode = 0,
  stderr = "",
} = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", null, "SIGTERM");
    return true;
  };
  child.stdin.on("finish", () => child.emit("exit", exitCode, null));
  process.nextTick(() => {
    if (stderr) child.stderr.write(stderr);
    if (ready) child.stdout.write(`ready ${method}\n`);
    else child.emit("exit", exitCode, null);
  });
  return child;
}

test("holds Claude's dictation control between start and stop", async () => {
  const calls = [];
  const child = fakeChild();
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  await voice.start();
  assert.equal(voice.status().state, "recording");
  assert.equal(voice.status().method, "claude-composer");
  assert.equal(child.stdin.writableEnded, false);
  await voice.stop();
  assert.equal(voice.status().state, "idle");
  assert.equal(child.stdin.writableEnded, true);
  assert.deepEqual(calls[0].args, ["--claude-dictation-hold"]);
  assert.deepEqual(calls[0].options.stdio, ["pipe", "pipe", "pipe"]);
});

test("reports native dictation failures in diagnostics", async () => {
  let failStart = true;
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/launcher",
    spawnProcess() {
      return failStart
        ? fakeChild({
            ready: false,
            exitCode: 5,
            stderr: "Bring Claude to the front before using the MIC key.\n",
          })
        : fakeChild();
    },
  });

  await assert.rejects(
    () => voice.start(),
    /Bring Claude to the front/,
  );
  assert.equal(voice.status().state, "error");
  assert.equal(
    voice.status().error,
    "Bring Claude to the front before using the MIC key.",
  );
  await voice.stop();
  assert.equal(voice.status().state, "idle");
  assert.equal(
    voice.status().error,
    "Bring Claude to the front before using the MIC key.",
  );

  failStart = false;
  await voice.start();
  assert.equal(voice.status().state, "recording");
  assert.equal(voice.status().error, null);
  await voice.stop();
});

test("reports a synchronous dictation helper launch failure", async () => {
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/launcher",
    spawnProcess() {
      throw new Error("private launcher detail");
    },
  });

  await assert.rejects(
    () => voice.start(),
    /could not start its dictation helper/,
  );
  assert.equal(voice.status().state, "error");
  assert.equal(
    voice.status().error,
    "Louder Bridge could not start its dictation helper.",
  );
});

test("records an unexpected native hold exit", async () => {
  const child = fakeChild();
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/launcher",
    spawnProcess: () => child,
  });

  await voice.start();
  child.stderr.write("Claude closed while recording.\n");
  child.emit("exit", 4, null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(voice.status().state, "error");
  assert.equal(voice.status().error, "Claude closed while recording.");
});

test("escalates cleanup when the native dictation helper is stuck", async () => {
  const signals = [];
  const child = fakeChild();
  child.stdin.removeAllListeners("finish");
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") child.emit("exit", null, signal);
    return true;
  };
  const voice = new ClaudeAccessibilityVoice({
    launcher: "/launcher",
    spawnProcess: () => child,
    stopTimeoutMs: 1,
    cleanupTimeoutMs: 1,
  });

  await voice.start();
  await assert.rejects(
    () => voice.stop(),
    /Claude did not stop recording in time/,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(voice.status().state, "error");
});
