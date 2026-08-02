import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addBridgeHooks,
  beginClaudeSettingsUpdate,
  bridgeHookCommand,
  removeBridgeHooks,
  rollbackClaudeSettingsUpdate,
  updateClaudeSettings,
} from "../src/setup/claude-hooks.mjs";
import { writeFileAtomic } from "../src/setup/atomic-file.mjs";

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

test("replaces and removes hooks whose install path contains an apostrophe", () => {
  const oldCommand = bridgeHookCommand({
    nodePath: "/Users/o'connor/Applications/Louder Bridge.app/Contents/MacOS/node",
    hookPath:
      "/Users/o'connor/Applications/Louder Bridge.app/Contents/Resources/app/src/hook.mjs",
  });
  const newCommand = bridgeHookCommand({
    nodePath: "/Applications/Louder Bridge.app/Contents/MacOS/node",
    hookPath:
      "/Applications/Louder Bridge.app/Contents/Resources/app/src/hook.mjs",
  });
  const installed = addBridgeHooks({}, oldCommand);

  const upgraded = addBridgeHooks(installed, newCommand);
  for (const groups of Object.values(upgraded.hooks)) {
    assert.equal(groups.length, 1);
    assert.equal(groups[0].hooks[0].command, newCommand);
  }
  assert.deepEqual(removeBridgeHooks(installed), {});
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

test("retries an update after another process replaces Claude settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  fs.writeFileSync(settingsFile, '{"theme":"light"}\n');

  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/node' '/hook.mjs' # louder-bridge",
    beforeWrite({ attempt }) {
      if (attempt === 1) {
        writeFileAtomic(settingsFile, '{"theme":"dark","fontSize":16}\n');
      }
    },
  });

  const updated = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(updated.theme, "dark");
  assert.equal(updated.fontSize, 16);
  assert.equal(updated.hooks.Stop[0].hooks[0].command.includes("hook.mjs"), true);
  assert.equal(transaction.existed, true);
  fs.rmSync(directory, { recursive: true });
});

test("retries when Claude settings change immediately after replacement", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  fs.writeFileSync(settingsFile, '{"theme":"light"}\n');

  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/node' '/hook.mjs' # louder-bridge",
    afterWrite({ attempt }) {
      if (attempt === 1) {
        writeFileAtomic(settingsFile, '{"theme":"dark"}\n');
      }
    },
  });

  const updated = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(updated.theme, "dark");
  assert.equal(
    updated.hooks.Stop[0].hooks[0].command.includes("hook.mjs"),
    true,
  );
  assert.equal(transaction.existed, true);
  fs.rmSync(directory, { recursive: true });
});

test("does not overwrite a settings file created during first setup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");

  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/node' '/hook.mjs' # louder-bridge",
    beforeWrite({ attempt }) {
      if (attempt === 1) {
        fs.writeFileSync(settingsFile, '{"theme":"dark"}\n', {
          mode: 0o640,
        });
      }
    },
  });

  const updated = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(updated.theme, "dark");
  assert.equal(updated.hooks.Stop[0].hooks[0].command.includes("hook.mjs"), true);
  assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o640);
  assert.equal(transaction.existed, true);
  fs.rmSync(directory, { recursive: true });
});

test("stops after repeated Claude settings conflicts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  fs.writeFileSync(settingsFile, '{}\n');

  assert.throws(
    () =>
      beginClaudeSettingsUpdate({
        settingsFile,
        command: "'/node' '/hook.mjs' # louder-bridge",
        beforeWrite({ attempt }) {
          writeFileAtomic(
            settingsFile,
            `${JSON.stringify({ revision: attempt })}\n`,
          );
        },
      }),
    /changed while Louder Bridge was updating it/,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), {
    revision: 5,
  });
  assert.deepEqual(fs.readdirSync(directory), ["settings.json"]);
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

test("rejects multiply linked Claude settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const linkedFile = path.join(directory, "linked-settings.json");
  fs.writeFileSync(settingsFile, '{"theme":"dark"}\n');
  fs.linkSync(settingsFile, linkedFile);

  assert.throws(
    () => updateClaudeSettings({ settingsFile, command: "bridge hook" }),
    /owned by the current user.*must not be hard linked/,
  );
  assert.equal(fs.readFileSync(settingsFile, "utf8"), '{"theme":"dark"}\n');
  assert.equal(fs.readFileSync(linkedFile, "utf8"), '{"theme":"dark"}\n');
  fs.rmSync(directory, { recursive: true });
});

test("rejects Claude settings not owned by the expected user", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  fs.writeFileSync(settingsFile, '{"theme":"dark"}\n');
  const owner = fs.statSync(settingsFile).uid;

  assert.throws(
    () =>
      beginClaudeSettingsUpdate({
        settingsFile,
        command: "bridge hook",
        expectedUserId: owner + 1,
      }),
    /owned by the current user.*must not be hard linked/,
  );
  assert.equal(fs.readFileSync(settingsFile, "utf8"), '{"theme":"dark"}\n');
  fs.rmSync(directory, { recursive: true });
});

test("rejects Claude settings whose JSON root is not an object", () => {
  for (const contents of ["[]\n", "null\n", '"value"\n']) {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "louder-settings-"),
    );
    const settingsFile = path.join(directory, "settings.json");
    fs.writeFileSync(settingsFile, contents);

    assert.throws(
      () => updateClaudeSettings({ settingsFile, command: "bridge hook" }),
      /must contain a JSON object/,
    );
    assert.equal(fs.readFileSync(settingsFile, "utf8"), contents);
    fs.rmSync(directory, { recursive: true });
  }
});

test("rollback preserves Claude settings added during setup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const previousCommand =
    "'/old/node' '/old/hook.mjs' # louder-bridge";
  fs.writeFileSync(
    settingsFile,
    `${JSON.stringify({
      permissions: { allow: ["Bash(git status)"] },
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "keep-before" }] },
          {
            hooks: [
              { type: "command", command: previousCommand, timeout: 2 },
            ],
          },
        ],
      },
    })}\n`,
    { mode: 0o640 },
  );

  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/new/node' '/new/hook.mjs' # louder-bridge",
  });
  const concurrent = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  concurrent.theme = "dark";
  concurrent.hooks.Stop.unshift({
    hooks: [{ type: "command", command: "added-during-setup" }],
  });
  fs.writeFileSync(settingsFile, `${JSON.stringify(concurrent, null, 2)}\n`, {
    mode: 0o640,
  });

  rollbackClaudeSettingsUpdate(transaction);

  const restored = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(restored.theme, "dark");
  assert.deepEqual(restored.permissions, {
    allow: ["Bash(git status)"],
  });
  const commands = restored.hooks.Stop.flatMap((group) =>
    group.hooks.map((hook) => hook.command),
  );
  assert.deepEqual(commands, [
    "added-during-setup",
    "keep-before",
    previousCommand,
  ]);
  assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o640);
  fs.rmSync(directory, { recursive: true });
});

test("rollback removes a settings file created only for bridge hooks", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/new/node' '/new/hook.mjs' # louder-bridge",
  });

  rollbackClaudeSettingsUpdate(transaction);

  assert.equal(fs.existsSync(settingsFile), false);
  fs.rmSync(directory, { recursive: true });
});

test("rollback keeps a new settings file when another setting was added", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/new/node' '/new/hook.mjs' # louder-bridge",
  });
  const concurrent = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  concurrent.theme = "dark";
  fs.writeFileSync(settingsFile, `${JSON.stringify(concurrent, null, 2)}\n`);

  rollbackClaudeSettingsUpdate(transaction);

  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), {
    theme: "dark",
  });
  fs.rmSync(directory, { recursive: true });
});

test("rollback preserves an empty settings file replaced after setup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const replacement = path.join(directory, "replacement.json");
  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/new/node' '/new/hook.mjs' # louder-bridge",
  });
  fs.writeFileSync(replacement, '{}\n', { mode: 0o640 });
  fs.renameSync(replacement, settingsFile);

  assert.throws(
    () => rollbackClaudeSettingsUpdate(transaction),
    /changed during rollback.*newer file untouched/,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), {});
  assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o640);
  fs.rmSync(directory, { recursive: true });
});

test("rollback preserves a settings file cleared in place", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/new/node' '/new/hook.mjs' # louder-bridge",
  });
  fs.writeFileSync(settingsFile, '{}\n');

  assert.throws(
    () => rollbackClaudeSettingsUpdate(transaction),
    /changed during rollback.*newer file untouched/,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, "utf8")), {});
  fs.rmSync(directory, { recursive: true });
});

test("uninstall rollback restores bridge hooks without removing newer settings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const settingsFile = path.join(directory, "settings.json");
  const command = "'/node' '/hook.mjs' # louder-bridge";
  fs.writeFileSync(
    settingsFile,
    `${JSON.stringify(addBridgeHooks({ theme: "light" }, command))}\n`,
  );

  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    remove: true,
  });
  const concurrent = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  concurrent.theme = "dark";
  fs.writeFileSync(settingsFile, `${JSON.stringify(concurrent, null, 2)}\n`);

  rollbackClaudeSettingsUpdate(transaction);

  const restored = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  assert.equal(restored.theme, "dark");
  assert.equal(restored.hooks.Stop[0].hooks[0].command, command);
  fs.rmSync(directory, { recursive: true });
});

test("rollback does not follow a settings symlink that changed targets", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-settings-"));
  const original = path.join(directory, "original.json");
  const replacement = path.join(directory, "replacement.json");
  const settingsFile = path.join(directory, "settings.json");
  fs.writeFileSync(original, '{}\n');
  fs.writeFileSync(replacement, '{"theme":"dark"}\n');
  fs.symlinkSync(original, settingsFile);
  const transaction = beginClaudeSettingsUpdate({
    settingsFile,
    command: "'/node' '/hook.mjs' # louder-bridge",
  });
  fs.unlinkSync(settingsFile);
  fs.symlinkSync(replacement, settingsFile);

  assert.throws(
    () => rollbackClaudeSettingsUpdate(transaction),
    /left the newer file untouched/,
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(replacement, "utf8")), {
    theme: "dark",
  });
  fs.rmSync(directory, { recursive: true });
});
