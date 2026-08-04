import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  findHermesExecutable,
  HermesRecentSessionNavigator,
  sessionRankFromListing,
} from "../src/hermes/navigator.mjs";
import { HermesAccessibilitySubmit } from "../src/hermes/submit.mjs";
import { HermesAccessibilityVoice } from "../src/hermes/voice.mjs";

function fakeVoiceChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit("exit", null, "SIGTERM");
    return true;
  };
  child.stdin.on("finish", () => child.emit("exit", 0, null));
  process.nextTick(() => child.stdout.write("ready hermes-composer\n"));
  return child;
}

test("finds the first executable Hermes installation", () => {
  const checked = [];
  assert.equal(
    findHermesExecutable({
      candidates: ["/missing", "/hermes"],
      access(filename) {
        checked.push(filename);
        if (filename === "/missing") throw new Error("missing");
      },
    }),
    "/hermes",
  );
  assert.deepEqual(checked, ["/missing", "/hermes"]);
});

test("reads recent Hermes session ranks without retaining titles", () => {
  const output = [
    "Updated  Source   Title              Session ID",
    "now      desktop Private project    20260804_090000_abc123",
    "earlier  desktop Another title      20260803_210000_def456",
  ].join("\n");
  assert.equal(
    sessionRankFromListing(output, "20260803_210000_def456"),
    2,
  );
  assert.equal(sessionRankFromListing(output, "missing"), null);
});

test("opens a Hermes session through its matching recent-session shortcut", async () => {
  const calls = [];
  const navigator = new HermesRecentSessionNavigator({
    hermes: "/hermes",
    launcher: "/launcher",
    async run(command, args, options) {
      calls.push({ command, args, options });
      if (command === "/hermes") {
        return {
          stdout: [
            "now desktop First 20260804_090000_abc123",
            "old desktop Second 20260803_210000_def456",
          ].join("\n"),
        };
      }
      return { stdout: "" };
    },
  });

  await navigator.open("20260803_210000_def456");

  assert.deepEqual(calls, [
    {
      command: "/hermes",
      args: ["sessions", "list", "--limit", "50"],
      options: {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    },
    {
      command: "/launcher",
      args: ["--hermes-session-slot", "2"],
      options: { timeout: 5000, windowsHide: true },
    },
  ]);
});

test("rejects Hermes sessions beyond the nine desktop shortcuts", async () => {
  const sessions = Array.from(
    { length: 10 },
    (_, index) => `row 20260804_0900${String(index).padStart(2, "0")}_abc12${index}`,
  ).join("\n");
  const navigator = new HermesRecentSessionNavigator({
    hermes: "/hermes",
    launcher: "/launcher",
    async run() {
      return { stdout: sessions };
    },
  });

  await assert.rejects(
    navigator.open("20260804_090009_abc129"),
    /nine most recent sessions/,
  );
});

test("holds Hermes dictation between Micro press and release", async () => {
  const calls = [];
  const child = fakeVoiceChild();
  const voice = new HermesAccessibilityVoice({
    launcher: "/launcher",
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  await voice.start();
  assert.deepEqual(voice.metadata(), {
    id: "hermes-accessibility-dictation",
    support: "experimental",
  });
  assert.equal(voice.status().method, "hermes-composer");
  await voice.stop();
  assert.deepEqual(calls[0], {
    command: "/launcher",
    args: ["--hermes-dictation-hold"],
    options: { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  });
});

test("routes the Micro send key through the Hermes launcher action", async () => {
  const calls = [];
  const submit = new HermesAccessibilitySubmit({
    launcher: "/launcher",
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  await submit.submit();
  assert.deepEqual(calls, [
    {
      command: "/launcher",
      args: ["--hermes-submit"],
      options: { timeout: 5000, windowsHide: true },
    },
  ]);
});
