import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRotatingLogger } from "../src/logging.mjs";

test("writes private timestamped logs and keeps bounded backups", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  const logger = createRotatingLogger({
    stdout,
    stderr,
    maxBytes: 80,
    backups: 2,
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });

  for (let index = 0; index < 10; index += 1) {
    logger.info(`message-${index}`);
  }
  logger.error(new Error("device failed"));

  assert.match(fs.readFileSync(stdout, "utf8"), /INFO message-9/);
  assert.equal(fs.existsSync(`${stdout}.1`), true);
  assert.equal(fs.existsSync(`${stdout}.2`), true);
  assert.equal(fs.existsSync(`${stdout}.3`), false);
  assert.match(fs.readFileSync(stderr, "utf8"), /Error: device failed/);
  assert.equal(fs.statSync(stdout).mode & 0o777, 0o600);
  assert.equal(fs.statSync(stderr).mode & 0o777, 0o600);
  fs.rmSync(directory, { recursive: true });
});

test("removes project context left by older log formats", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  fs.writeFileSync(
    stdout,
    [
      "Slot 2: running (private-project)",
      "Opened Claude session in slot 2 (private-project)",
      "Codex Micro connected.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(`${stdout}.1`, "Slot 1: idle (another-project)\n");

  createRotatingLogger({ stdout, stderr, backups: 2 });

  assert.equal(
    fs.readFileSync(stdout, "utf8"),
    [
      "Slot 2: running",
      "Opened Claude session in slot 2",
      "Codex Micro connected.",
      "",
    ].join("\n"),
  );
  assert.equal(fs.readFileSync(`${stdout}.1`, "utf8"), "Slot 1: idle\n");
  fs.rmSync(directory, { recursive: true });
});
