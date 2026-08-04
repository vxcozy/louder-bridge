import test from "node:test";
import assert from "node:assert/strict";
import {
  CODEX_CONTENTION_MESSAGE,
  codexContentionMessage,
  showCodexContentionNotice,
} from "../src/macos/contention-notice.mjs";

test("shows the Codex conflict without blocking the service", () => {
  const calls = [];
  const errors = [];
  let errorHandler;
  let unrefCalls = 0;
  const shown = showCodexContentionNotice({
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
    onError(error) {
      errors.push(error.message);
    },
  });

  assert.equal(shown, true);
  assert.equal(unrefCalls, 1);
  assert.equal(typeof errorHandler, "function");
  errorHandler(new Error("dialog launch failed"));
  assert.deepEqual(errors, ["dialog launch failed"]);
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/osascript",
      args: [
        "-e",
        'display dialog (item 1 of argv) with title "Louder Bridge" buttons {"OK"} default button 1 with icon caution',
        "--",
        CODEX_CONTENTION_MESSAGE,
      ],
      options: { detached: true, stdio: "ignore" },
    },
  ]);
});

test("names Hermes Desktop in the Codex conflict notice", () => {
  assert.equal(
    codexContentionMessage("Hermes Desktop"),
    "Codex is open too. Quit Codex to use the Micro in Hermes Desktop. Louder Bridge will reconnect when Codex closes.",
  );
});

test("contains a synchronous dialog launch failure", () => {
  assert.equal(
    showCodexContentionNotice({
      run() {
        throw new Error("launch failed");
      },
    }),
    false,
  );
});
