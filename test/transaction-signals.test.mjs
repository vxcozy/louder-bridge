import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runInterruptibleSetup } from "../src/setup/transaction-signals.mjs";

test("rolls back setup after an interrupt", async () => {
  const processObject = new EventEmitter();
  let rollbackError;

  const result = await runInterruptibleSetup({
    processObject,
    operation(signal) {
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("setup interrupted")),
          { once: true },
        );
        queueMicrotask(() => processObject.emit("SIGINT"));
      });
    },
    async rollback(error) {
      rollbackError = error;
    },
  });

  assert.equal(result.signal, "SIGINT");
  assert.equal(result.error, rollbackError);
  assert.match(result.error.message, /setup interrupted/);
  assert.equal(processObject.listenerCount("SIGINT"), 0);
  assert.equal(processObject.listenerCount("SIGTERM"), 0);
});

test("leaves successful setup committed and removes signal listeners", async () => {
  const processObject = new EventEmitter();
  let rolledBack = false;

  const result = await runInterruptibleSetup({
    processObject,
    async operation() {},
    async rollback() {
      rolledBack = true;
    },
  });

  assert.deepEqual(result, { error: null, signal: null });
  assert.equal(rolledBack, false);
  assert.equal(processObject.listenerCount("SIGINT"), 0);
  assert.equal(processObject.listenerCount("SIGTERM"), 0);
});

test("rolls back when a detached setup worker loses its parent", async () => {
  const processObject = new EventEmitter();
  processObject.connected = true;
  let rolledBack = false;

  const result = await runInterruptibleSetup({
    processObject,
    operation(signal) {
      return new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("setup parent exited")),
          { once: true },
        );
        queueMicrotask(() => processObject.emit("disconnect"));
      });
    },
    async rollback() {
      rolledBack = true;
    },
  });

  assert.equal(result.signal, "SIGTERM");
  assert.equal(rolledBack, true);
  assert.equal(processObject.listenerCount("disconnect"), 0);
});
