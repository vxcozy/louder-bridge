import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cli = path.join(root, "src", "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("prints CLI help without starting the bridge", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: louder-bridge <command>/);
  assert.match(result.stdout, /status\s+Show permission, Claude, device, and voice state/);
  assert.equal(result.stderr, "");
});

test("prints the package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "0.1.0");
});

test("uses exit code 2 for an unknown command or simulated state", () => {
  const unknown = run(["not-a-command"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);

  const state = run(["simulate", "not-a-state"]);
  assert.equal(state.status, 2);
  assert.match(state.stderr, /Unknown simulated state/);
});
