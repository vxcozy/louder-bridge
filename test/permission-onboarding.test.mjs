import test from "node:test";
import assert from "node:assert/strict";
import {
  needsPermissionOnboarding,
  openOnboardingApplication,
} from "../src/setup/permission-onboarding.mjs";

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
  await openOnboardingApplication("/Applications/Louder Bridge.app", {
    waitForExit: true,
    async run(command, args, options) {
      calls.push({ command, args, options });
    },
  });

  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["-W", "-n", "/Applications/Louder Bridge.app"],
      options: {},
    },
  ]);
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
