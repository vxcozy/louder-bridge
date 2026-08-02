import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { installSignalShutdown } from "../src/runtime/signals.mjs";

test("signal shutdown stops once and exits successfully", async () => {
  const processObject = new EventEmitter();
  const calls = [];
  installSignalShutdown(
    {
      async stop() {
        calls.push("stop");
      },
    },
    {
      processObject,
      exit(code) {
        calls.push(`exit:${code}`);
      },
    },
  );

  processObject.emit("SIGTERM");
  processObject.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["stop", "exit:0"]);
});

test("signal shutdown reports cleanup failure before exiting", async () => {
  const processObject = new EventEmitter();
  const failure = new Error("cleanup failed");
  const errors = [];
  const exits = [];
  installSignalShutdown(
    {
      async stop() {
        throw failure;
      },
    },
    {
      processObject,
      onError(error) {
        errors.push(error);
      },
      exit(code) {
        exits.push(code);
      },
    },
  );

  processObject.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(errors, [failure]);
  assert.deepEqual(exits, [1]);
});
