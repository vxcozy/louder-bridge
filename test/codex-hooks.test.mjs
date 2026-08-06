import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginCodexHooksUpdate,
  codexBridgeHookCommand,
  codexHooksPath,
  rollbackCodexHooksUpdate,
} from "../src/setup/codex-hooks.mjs";

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "louder-codex-hooks-"));
  return { home, hooksFile: codexHooksPath(home) };
}

test("installs only supported Codex CLI lifecycle hooks", (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.home, { recursive: true }));
  const transaction = beginCodexHooksUpdate({
    hooksFile: files.hooksFile,
    command: codexBridgeHookCommand({
      nodePath: "/runtime/node",
      hookPath: "/app/hook.mjs",
    }),
    expectedUserId: null,
  });
  const installed = JSON.parse(fs.readFileSync(files.hooksFile, "utf8"));

  assert.deepEqual(Object.keys(installed.hooks), [
    "SessionStart",
    "UserPromptSubmit",
    "PermissionRequest",
    "Stop",
    "SessionEnd",
  ]);
  const command = installed.hooks.SessionStart[0].hooks[0].command;
  assert.match(command, /LOUDER_AGENT_SURFACE=codex/);
  assert.match(command, /\/app\/hook\.mjs/);

  rollbackCodexHooksUpdate(transaction);
  assert.equal(fs.existsSync(files.hooksFile), false);
});

test("preserves unrelated Codex hooks during install and removal", (context) => {
  const files = fixture();
  context.after(() => fs.rmSync(files.home, { recursive: true }));
  fs.mkdirSync(path.dirname(files.hooksFile), { recursive: true });
  const unrelated = {
    matcher: "tool",
    hooks: [{ type: "command", command: "existing-hook", timeout: 3 }],
  };
  fs.writeFileSync(files.hooksFile, `${JSON.stringify({
    hooks: { Stop: [unrelated] },
    custom: { keep: true },
  }, null, 2)}\n`);

  beginCodexHooksUpdate({
    hooksFile: files.hooksFile,
    command: codexBridgeHookCommand({
      nodePath: "/runtime/node",
      hookPath: "/app/hook.mjs",
    }),
    expectedUserId: null,
  });
  const removal = beginCodexHooksUpdate({
    hooksFile: files.hooksFile,
    remove: true,
    expectedUserId: null,
  });
  const restored = JSON.parse(fs.readFileSync(files.hooksFile, "utf8"));

  assert.deepEqual(restored, {
    hooks: { Stop: [unrelated] },
    custom: { keep: true },
  });
  assert.equal(removal.changed, true);
});
