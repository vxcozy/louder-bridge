import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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

test("opens the installed app for permission onboarding", () => {
  const calls = [];
  class FakeChild extends EventEmitter {
    unref() {
      this.unreferenced = true;
    }
  }
  const child = new FakeChild();
  openOnboardingApplication("/Applications/Louder Bridge.app", {
    spawnProcess(command, args, options) {
      calls.push({ command, args, options });
      return child;
    },
  });

  assert.deepEqual(calls, [
    {
      command: "/usr/bin/open",
      args: ["-n", "/Applications/Louder Bridge.app"],
      options: { detached: true, stdio: "ignore" },
    },
  ]);
  assert.equal(child.unreferenced, true);
});
