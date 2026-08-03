import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
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
  const controller = new AbortController();
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    signal: controller.signal,
    waitForExit: true,
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["-W", "-n", "/Applications/Louder Bridge.app"],
      options: { signal: controller.signal, timeout: 5000 },
    },
  ]);
});

test("finishes when the onboarding app exits after open stops waiting", async () => {
  const states = [true, true, false];
  const waits = [];
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    async run() {
      const error = new Error("open timed out");
      error.killed = true;
      throw error;
    },
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

test("accepts an exited onboarding app after open stops waiting", async () => {
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    async run() {
      const error = new Error("open timed out");
      error.killed = true;
      throw error;
    },
    isRunning: () => false,
  });
});

test("recognizes a real Node command timeout", async () => {
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    openTimeoutMs: 10,
    run(_command, _args, options) {
      return execFileAsync("/bin/sleep", ["1"], options);
    },
    isRunning: () => false,
  });
});

test("bounds the onboarding app exit wait", async () => {
  await assert.rejects(
    () =>
      openOnboardingApplication("/Applications/Louder Bridge.app", {
        waitForExit: true,
        async run() {
          const error = new Error("open timed out");
          error.killed = true;
          throw error;
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
