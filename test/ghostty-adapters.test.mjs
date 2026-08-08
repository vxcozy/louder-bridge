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
      return { stdout: "" };
    },
  });

  assert.equal(await navigator.observe("session-key", "terminal-42"), true);
  await navigator.open("session-key");
  assert.deepEqual(calls, [
    ["/launcher", "--ghostty-focus-terminal", "terminal-42"],
  ]);
  navigator.forget("session-key");
  await assert.rejects(
    () => navigator.open("session-key"),
    /Use this session in Ghostty once/,
  );
});

test("discovers the focused terminal when a hook omits its ID", async () => {
  const calls = [];
  const navigator = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    async run(command, args) {
      calls.push([command, ...args]);
      if (args[0] === "--ghostty-front-terminal-id") {
        return { stdout: "terminal-hermes\n" };
      }
      return { stdout: "" };
    },
  });

  assert.equal(
    await navigator.observe("hermes-session", undefined, "hermes"),
    true,
  );
  assert.equal(
    navigator.agentSurfaceForSession("hermes-session"),
    "hermes",
  );
  await navigator.open("hermes-session");
  assert.deepEqual(calls, [
    ["/launcher", "--ghostty-front-terminal-id"],
    ["/launcher", "--ghostty-focus-terminal", "terminal-hermes"],
  ]);
});

test("does not retain invalid terminal IDs or expose observation failures", async () => {
  const invalid = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    run: async () => ({ stdout: "terminal id with spaces\n" }),
  });
  assert.equal(
    await invalid.observe("session-key", "terminal id with spaces"),
    false,
  );
  await assert.rejects(() => invalid.open("session-key"), /associate/);

  assert.equal(await invalid.observe("session-key", undefined), false);
});

test("keeps Ghostty's focus error for diagnostics", async () => {
  const navigator = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    run: async () => {
      const error = new Error("native failure");
      error.stderr = "Ghostty rejected the terminal reference.\nprivate detail";
      throw error;
    },
  });
  await navigator.observe("session-key", "terminal-42");
  await assert.rejects(
    () => navigator.open("session-key"),
    /Ghostty could not focus that terminal: Ghostty rejected the terminal reference\./,
  );
});

test("identifies the agent in Ghostty's focused terminal", async () => {
  const navigator = new GhosttyTerminalNavigator({
    launcher: "/launcher",
    async run(command, args) {
      assert.equal(command, "/launcher");
      assert.deepEqual(args, ["--ghostty-front-terminal-id"]);
      return { stdout: "terminal-codex\n" };
    },
  });
  await navigator.observe("codex-session", "terminal-codex", "codex");
  await navigator.observe("claude-session", "terminal-claude", "claude");
  assert.equal(await navigator.activeAgentSurface(), "codex");
  assert.equal(navigator.agentSurfaceForSession("codex-session"), "codex");
});

test("keeps only the newest session associated with a Ghostty terminal", async () => {
  const navigator = new GhosttyTerminalNavigator({ launcher: "/launcher" });
  await navigator.observe("old-session", "terminal-42", "claude");
  await navigator.observe("new-session", "terminal-42", "codex");
  assert.equal(navigator.agentSurfaceForSession("old-session"), null);
  assert.equal(navigator.agentSurfaceForSession("new-session"), "codex");
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
      queueMicrotask(() => child.stdout.emit("data", "ready terminal-push-to-talk\n"));
      assert.equal(command, "/launcher");
      assert.deepEqual(args, ["--ghostty-push-to-talk-hold"]);
      return child;
    },
  });
  await voice.start();
  assert.equal(voice.status().state, "recording");
  assert.equal(voice.status().method, "terminal-push-to-talk");
  await voice.stop();
  assert.equal(voice.status().state, "idle");
});

test("uses macOS Dictation for Codex CLI in Ghostty", async () => {
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
      assert.deepEqual(args, ["--ghostty-system-dictation-hold"]);
      return child;
    },
  });
  await voice.start({ agentSurface: "codex" });
  assert.equal(voice.status().state, "recording");
  assert.equal(voice.status().method, "macos-dictation");
  assert.equal(voice.status().agentSurface, "codex");
  await voice.stop();
  assert.equal(voice.status().state, "idle");
  assert.equal(voice.status().agentSurface, null);
});
