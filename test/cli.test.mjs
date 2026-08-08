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

function run(args, { env = process.env } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

test("prints CLI help without starting the bridge", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: louder-bridge <command>/);
  assert.match(result.stdout, /status\s+Show permissions, apps, device, and voice state/);
  assert.equal(result.stderr, "");
});

test("prints the package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "0.3.2");
});

test("checks source build tools before the native driver is installed", (context) => {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    context.skip("Source setup requires Apple Silicon macOS.");
    return;
  }
  const result = run(["doctor"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /Codex Micro driver check: ready to build during setup\./,
  );
  assert.match(result.stdout, /Native build tools: ready\./);
  assert.match(result.stdout, /Result: ready\./);
});

test("uses exit code 2 for an unknown command or simulated state", () => {
  const unknown = run(["not-a-command"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);

  const state = run(["simulate", "not-a-state"]);
  assert.equal(state.status, 2);
  assert.match(state.stderr, /Unknown simulated state/);
});

test("reports startup failures without a stack trace or checkout path", () => {
  const result = run(["simulate", "running"], {
    env: {
      ...process.env,
      HOME: path.join(root, "test", "missing-home"),
    },
  });

  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Louder Bridge failed: Open Louder Bridge once to finish setup.\n",
  );
  assert.doesNotMatch(result.stderr, /file:\/\//);
  assert.doesNotMatch(result.stderr, /src\/cli/);
});

test("reports an unavailable hook server with an unsuccessful status", () => {
  const result = run(["status"], {
    env: {
      ...process.env,
      HOME: path.join(root, "test", "missing-home"),
      LOUDER_BRIDGE_PORT: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Background agent: (?:running|not running)/);
  assert.match(result.stdout, /Hook server: unavailable/);
  assert.match(result.stdout, /Louder Bridge: not installed/);
  assert.equal(result.stderr, "");
});
