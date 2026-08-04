import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  completePermissionOnboarding,
  needsPermissionOnboarding,
  openOnboardingApplication,
} from "../src/setup/permission-onboarding.mjs";

const execFileAsync = promisify(execFile);

test("starts the agent only after both permissions are granted", () => {
  assert.equal(
    needsPermissionOnboarding({
      inputMonitoring: "granted",
      accessibility: "granted",
    }),
    false,
  );
  for (const permissions of [
    { inputMonitoring: "denied", accessibility: "granted" },
    { inputMonitoring: "granted", accessibility: "denied" },
    { inputMonitoring: "unknown", accessibility: "granted" },
  ]) {
    assert.equal(needsPermissionOnboarding(permissions), true);
  }
});

test("opens the installed app for permission onboarding", async () => {
  const calls = [];
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["-n", "/Applications/Louder Bridge.app"],
      options: { timeout: 5000 },
    },
  ]);
});

test("can wait for onboarding to finish before committing setup", async () => {
  const calls = [];
  const states = [true, true, false];
  const controller = new AbortController();
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    signal: controller.signal,
    waitForExit: true,
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
    isRunning: () => states.shift(),
    async sleep() {},
  });

  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["-n", "/Applications/Louder Bridge.app"],
      options: { signal: controller.signal, timeout: 5000 },
    },
  ]);
});

test("follows the onboarding app until it exits", async () => {
  const states = [true, true, false];
  const waits = [];
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    async run() {},
    isRunning({ launcher }) {
      assert.equal(
        launcher,
        "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
      );
      return states.shift();
    },
    async sleep(milliseconds) {
      waits.push(milliseconds);
    },
    now: () => 0,
  });

  assert.deepEqual(waits, [1000, 1000]);
});

test("accepts an onboarding app that exits before the first check", async () => {
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    async run() {},
    isRunning: () => false,
    startTimeoutMs: 0,
  });
});

test("waits for the onboarding app to appear before following its exit", async () => {
  const states = [false, false, true, false];
  const waits = [];
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    async run() {},
    isRunning: () => states.shift(),
    async sleep(milliseconds) {
      waits.push(milliseconds);
    },
    now: () => 0,
  });

  assert.deepEqual(waits, [100, 100, 1000]);
});

test("reports a real Node command timeout", async () => {
  await assert.rejects(
    () =>
      openOnboardingApplication("/Applications/Louder Bridge.app", {
        waitForExit: true,
        openTimeoutMs: 10,
        run(_command, _args, options) {
          return execFileAsync("/bin/sleep", ["1"], options);
        },
        isRunning: () => false,
      }),
    /could not open for setup/,
  );
});

test("reopens after permission-driven app restarts", async () => {
  const launches = [];
  const readiness = [false, true];
  const permissionStates = [
    "denied:denied",
    "granted:denied",
  ];

  await completePermissionOnboarding("/Applications/Louder Bridge.app", {
    signal: AbortSignal.timeout(1000),
    isReady: () => readiness.shift(),
    permissionState: () => permissionStates.shift(),
    async openApplication(app, options) {
      launches.push({ app, options });
    },
  });

  assert.equal(launches.length, 2);
  assert.equal(launches[0].app, "/Applications/Louder Bridge.app");
  assert.equal(launches[0].options.waitForExit, true);
});

test("does not reopen after a permission timeout", async () => {
  let launches = 0;
  const permissionStates = ["denied:denied", "denied:denied"];

  await assert.rejects(
    () =>
      completePermissionOnboarding("/Applications/Louder Bridge.app", {
        isReady: () => false,
        permissionState: () => permissionStates.shift(),
        async openApplication() {
          launches += 1;
        },
      }),
    /closed without completing permission setup/,
  );
  assert.equal(launches, 1);
});

test("bounds permission-driven app restarts", async () => {
  let launches = 0;
  await assert.rejects(
    () =>
      completePermissionOnboarding("/Applications/Louder Bridge.app", {
        isReady: () => false,
        async openApplication() {
          launches += 1;
        },
      }),
    /closed before the background agent was ready/,
  );
  assert.equal(launches, 5);
});

test("bounds the onboarding app exit wait", async () => {
  await assert.rejects(
    () =>
      openOnboardingApplication("/Applications/Louder Bridge.app", {
        waitForExit: true,
        async run() {
          return undefined;
        },
        isRunning: () => true,
        timeoutMs: 0,
      }),
    /did not finish permission setup in time/,
  );
});

test("does not hide an aborted onboarding launch", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      openOnboardingApplication("/Applications/Louder Bridge.app", {
        signal: controller.signal,
        waitForExit: true,
        async run() {
          const error = new Error("setup was cancelled");
          error.killed = true;
          throw error;
        },
      }),
    /could not open for setup: setup was cancelled/,
  );
});

test("reports an onboarding launch failure", async () => {
  await assert.rejects(
    () =>
      openOnboardingApplication("/Applications/Louder Bridge.app", {
        async run() {
          const error = new Error("open failed");
          error.stderr = "The application could not be found.";
          throw error;
        },
      }),
    /could not open for setup: The application could not be found/,
  );
});
