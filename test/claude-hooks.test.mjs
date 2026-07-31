import test from "node:test";
import assert from "node:assert/strict";
import {
  addBridgeHooks,
  bridgeHookCommand,
  removeBridgeHooks,
} from "../src/setup/claude-hooks.mjs";

test("adds hooks without replacing existing Claude settings", () => {
  const input = {
    permissions: { allow: ["Bash(git status)"] },
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "notify-me" }] }],
    },
  };
  const output = addBridgeHooks(
    input,
    "'/usr/bin/node' '/repo/louder-bridge/src/hook.mjs' # louder-bridge",
  );
  assert.deepEqual(output.permissions, input.permissions);
  assert.equal(output.hooks.Stop.length, 2);
  assert.equal(output.hooks.SessionStart.length, 1);
  assert.equal(input.hooks.Stop.length, 1);
});

test("removes only louder-bridge hook commands", () => {
  const installed = addBridgeHooks(
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "keep-me" }] }] } },
    "'/usr/bin/node' '/repo/louder-bridge/src/hook.mjs' # louder-bridge",
  );
  const output = removeBridgeHooks(installed);
  assert.equal(output.hooks.Stop.length, 1);
  assert.equal(output.hooks.Stop[0].hooks[0].command, "keep-me");
  assert.equal(output.hooks.SessionStart, undefined);
});

test("preserves unrelated commands that mention the bridge tag", () => {
  const settings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: "printf '%s\\n' '# louder-bridge'",
            },
          ],
        },
      ],
    },
  };
  assert.deepEqual(removeBridgeHooks(settings), settings);
});

test("hook command captures the configured bridge address", () => {
  const command = bridgeHookCommand();
  assert.match(command, /LOUDER_BRIDGE_HOST=127\.0\.0\.1/);
  assert.match(command, /LOUDER_BRIDGE_PORT=47831/);
  assert.match(command, /# louder-bridge$/);
});
