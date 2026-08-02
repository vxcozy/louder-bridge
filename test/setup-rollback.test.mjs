import test from "node:test";
import assert from "node:assert/strict";
import { rollbackSetupApplication } from "../src/setup/setup-rollback.mjs";

const application = {
  app: "/Applications/Louder Bridge.app",
  launcher:
    "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
};

test("stops onboarding before restoring the previous app", async () => {
  const calls = [];

  await rollbackSetupApplication(application, {
    reopenPrevious: true,
    stopApplication(options) {
      calls.push(["stop", options]);
    },
    rollbackBundle(transaction) {
      calls.push(["rollback", transaction]);
    },
    async openApplication(app) {
      calls.push(["open", app]);
    },
  });

  assert.deepEqual(calls, [
    ["stop", { launcher: application.launcher }],
    ["rollback", application],
    ["open", application.app],
  ]);
});

test("does not reopen an app that was not running before setup", async () => {
  const calls = [];

  await rollbackSetupApplication(application, {
    stopApplication() {
      calls.push("stop");
    },
    rollbackBundle() {
      calls.push("rollback");
    },
    async openApplication() {
      calls.push("open");
    },
  });

  assert.deepEqual(calls, ["stop", "rollback"]);
});

test("keeps the installed bundle in place if onboarding will not stop", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      rollbackSetupApplication(application, {
        reopenPrevious: true,
        stopApplication() {
          calls.push("stop");
          throw new Error("still running");
        },
        rollbackBundle() {
          calls.push("rollback");
        },
        async openApplication() {
          calls.push("open");
        },
      }),
    /still running/,
  );

  assert.deepEqual(calls, ["stop"]);
});

test("reopens the previous app only after its bundle is restored", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      rollbackSetupApplication(application, {
        reopenPrevious: true,
        stopApplication() {
          calls.push("stop");
        },
        rollbackBundle() {
          calls.push("rollback");
          throw new Error("restore failed");
        },
        async openApplication() {
          calls.push("open");
        },
      }),
    /restore failed/,
  );

  assert.deepEqual(calls, ["stop", "rollback"]);
});
