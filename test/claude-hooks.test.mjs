import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addBridgeHooks,
  bridgeHookCommand,
  removeBridgeHooks,
  restoreClaudeSettings,
  snapshotClaudeSettings,
  updateClaudeSettings,
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

test("updates a symlinked settings file without replacing the symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const target = path.join(directory, "managed-settings.json");
  const settingsFile = path.join(directory, "settings.json");
  fs.writeFileSync(
    target,
    `${JSON.stringify({ permissions: { allow: ["Bash(git status)"] } })}\n`,
    { mode: 0o640 },
  );
  fs.symlinkSync(target, settingsFile);

  updateClaudeSettings({ settingsFile, command: "bridge hook" });

  assert.equal(fs.lstatSync(settingsFile).isSymbolicLink(), true);
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  const updated = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.deepEqual(updated.permissions, {
    allow: ["Bash(git status)"],
  });
  assert.equal(updated.hooks.SessionStart[0].hooks[0].command, "bridge hook");
  fs.rmSync(directory, { recursive: true });
});

test("restores Claude settings contents and permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const original = '{"theme":"dark"}\n';
  fs.writeFileSync(settingsFile, original, { mode: 0o640 });
  const snapshot = snapshotClaudeSettings(settingsFile);

  updateClaudeSettings({ settingsFile, command: "bridge hook" });
  fs.chmodSync(settingsFile, 0o600);
  restoreClaudeSettings(snapshot);

  assert.equal(fs.readFileSync(settingsFile, "utf8"), original);
  assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o640);
  fs.rmSync(directory, { recursive: true });
});

test("rejects a broken Claude settings symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  fs.symlinkSync(path.join(directory, "missing.json"), settingsFile);

  assert.throws(
    () => updateClaudeSettings({ settingsFile, command: "bridge hook" }),
    /points to a missing file/,
  );
  assert.equal(fs.lstatSync(settingsFile).isSymbolicLink(), true);
  fs.rmSync(directory, { recursive: true });
});
