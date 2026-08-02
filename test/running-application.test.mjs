import test from "node:test";
import assert from "node:assert/strict";
import {
  onboardingApplicationIsRunning,
  stopOnboardingApplication,
} from "../src/setup/running-application.mjs";

test("reports whether permission onboarding is still running", () => {
  const calls = [];
  const running = onboardingApplicationIsRunning({
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    run(command, args) {
      calls.push([command, ...args]);
      return { status: 0, stdout: "123\n", stderr: "" };
    },
  });
  assert.equal(running, true);
  assert.deepEqual(calls, [
    [
      "/usr/bin/pgrep",
      "-f",
      "^/Applications/Louder Bridge\\.app/Contents/MacOS/LouderBridge$",
    ],
  ]);
});

test("reports a stopped or unreadable onboarding process", () => {
  assert.equal(
    onboardingApplicationIsRunning({
      run() {
        return { status: 1, stdout: "", stderr: "" };
      },
    }),
    false,
  );
  assert.throws(
    () =>
      onboardingApplicationIsRunning({
        run() {
          return { status: 2, stdout: "", stderr: "permission denied" };
        },
      }),
    /pgrep failed: permission denied/,
  );
});

test("stops an existing onboarding app and waits for it to exit", () => {
  const calls = [];
  let processChecks = 0;
  const stopped = stopOnboardingApplication({
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    run(command, args) {
      calls.push([command, ...args]);
      if (command === "/usr/bin/pkill") {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "/usr/bin/pgrep") {
        processChecks += 1;
        return {
          status: processChecks === 1 ? 0 : 1,
          stdout: "",
          stderr: "",
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(stopped, true);
  assert.deepEqual(calls, [
    [
      "/usr/bin/pkill",
      "-TERM",
      "-f",
      "^/Applications/Louder Bridge\\.app/Contents/MacOS/LouderBridge$",
    ],
    [
      "/usr/bin/pgrep",
      "-f",
      "^/Applications/Louder Bridge\\.app/Contents/MacOS/LouderBridge$",
    ],
    ["/bin/sleep", "0.1"],
    [
      "/usr/bin/pgrep",
      "-f",
      "^/Applications/Louder Bridge\\.app/Contents/MacOS/LouderBridge$",
    ],
  ]);
});

test("does nothing when no onboarding app is running", () => {
  const calls = [];
  const stopped = stopOnboardingApplication({
    launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
    run(command, args) {
      calls.push([command, ...args]);
      return { status: 1, stdout: "", stderr: "" };
    },
  });

  assert.equal(stopped, false);
  assert.equal(calls.length, 1);
});

test("reports an onboarding app that will not exit", () => {
  assert.throws(
    () =>
      stopOnboardingApplication({
        launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
        attempts: 2,
        run(command) {
          return {
            status: command === "/bin/sleep" ? 0 : 0,
            stdout: "",
            stderr: "",
          };
        },
      }),
    /did not close in time/,
  );
});
