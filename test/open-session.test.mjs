import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  claudeResumeUrl,
  openClaudeSession,
} from "../src/claude/open-session.mjs";

test("creates a Claude Desktop resume deep link", () => {
  assert.equal(
    claudeResumeUrl("abc-123"),
    "claude://resume?session=abc-123",
  );
});

test("reports a session-navigation launch failure without crashing", async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  const result = openClaudeSession("abc-123", "darwin", () => child);
  queueMicrotask(() => child.emit("error", new Error("open failed")));
  await assert.rejects(result, /open failed/);
});

test("uses the system open command on macOS", async () => {
  const child = new EventEmitter();
  child.unref = () => {};
  let call;
  const result = openClaudeSession("abc-123", "darwin", (command, args) => {
    call = { command, args };
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });

  await result;
  assert.deepEqual(call, {
    command: "/usr/bin/open",
    args: ["claude://resume?session=abc-123"],
  });
});
