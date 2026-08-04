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

test("removes the replacement agent before restoring the app and previous agent", async () => {
  const calls = [];
  const previousAgent = { removed: true, plist: "/previous-agent.plist" };

  await rollbackSetupApplication(application, {
    previousAgent,
    stopApplication(options) {
      calls.push(["stop-app", options]);
    },
    removeCurrentAgent() {
      calls.push(["remove-current-agent"]);
    },
    rollbackBundle(transaction) {
      calls.push(["rollback-app", transaction]);
    },
    restorePreviousAgent(transaction) {
      calls.push(["restore-previous-agent", transaction]);
    },
  });

  assert.deepEqual(calls, [
    ["stop-app", { launcher: application.launcher }],
    ["remove-current-agent"],
    ["rollback-app", application],
    ["restore-previous-agent", previousAgent],
  ]);
});

test("does not restore the app while a replacement agent cannot be removed", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      rollbackSetupApplication(application, {
        previousAgent: { removed: true },
        stopApplication() {
          calls.push("stop-app");
        },
        removeCurrentAgent() {
          calls.push("remove-current-agent");
          throw new Error("replacement agent changed");
        },
        rollbackBundle() {
          calls.push("rollback-app");
        },
        restorePreviousAgent() {
          calls.push("restore-previous-agent");
        },
      }),
    /replacement agent changed/,
  );

  assert.deepEqual(calls, ["stop-app", "remove-current-agent"]);
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

test("reopens the old app when replacement fails before a transaction returns", async () => {
  const calls = [];

  await rollbackSetupApplication(undefined, {
    installedApp: application.app,
    reopenPrevious: true,
    stopApplication() {
      calls.push("stop");
    },
    rollbackBundle() {
      calls.push("rollback");
    },
    async openApplication(app) {
      calls.push(["open", app]);
    },
  });

  assert.deepEqual(calls, [["open", application.app]]);
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
