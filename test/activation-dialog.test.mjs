import test from "node:test";
import assert from "node:assert/strict";
import { showActivationDialog } from "../src/macos/activation-dialog.mjs";

test("shows setup dialogs without waiting for them to close", () => {
  const calls = [];
  let errorHandler;
  let unrefCalls = 0;
  const shown = showActivationDialog("Permission is still off.", {
    error: true,
    settingsLabel: "Open Accessibility",
    run(command, args, options) {
      calls.push({ command, args, options });
      return {
        on(event, handler) {
          if (event === "error") errorHandler = handler;
        },
        unref() {
          unrefCalls += 1;
        },
      };
    },
  });

  assert.equal(shown, true);
  assert.equal(typeof errorHandler, "function");
  assert.equal(unrefCalls, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/osascript");
  assert.deepEqual(calls[0].args.slice(-3), [
    "--",
    "Permission is still off.",
    "Open Accessibility",
  ]);
  assert.match(calls[0].args[1], /with icon stop/);
  assert.deepEqual(calls[0].options, {
    detached: true,
    stdio: "ignore",
  });
});

test("contains a synchronous dialog-launch failure", () => {
  assert.equal(
    showActivationDialog("Ready.", {
      run() {
        throw new Error("spawn failed");
      },
    }),
    false,
  );
});
