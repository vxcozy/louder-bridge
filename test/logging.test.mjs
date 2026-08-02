import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRotatingLogger,
  prepareRotatingLogs,
} from "../src/logging.mjs";

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
  assert.equal(
    fs.readFileSync(stderr, "utf8"),
    "2026-07-31T00:00:00.000Z ERROR Error: device failed\n",
  );
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

test("removes stack frames and local paths from existing logs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  fs.writeFileSync(stdout, "Codex Micro connected.\n");
  fs.writeFileSync(
    stderr,
    [
      "Error: device failed",
      "/Applications/Example.app/Contents/Resources/runtime.js:183",
      "        const native = await binding.openDevice();",
      "                                     ^",
      "    at connect (file:///Users/example/private-project/src/device.mjs:4:2)",
      "/private/var/folders/example/TemporaryItems/report.txt",
      "Node.js v22.0.0",
      "A safe diagnostic remains.",
      "",
    ].join("\n"),
  );

  createRotatingLogger({ stdout, stderr });

  assert.equal(
    fs.readFileSync(stderr, "utf8"),
    "Error: device failed\nA safe diagnostic remains.\n",
  );
  fs.rmSync(directory, { recursive: true });
});

test("scrubs existing logs before the service creates a logger", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  fs.writeFileSync(stdout, "Slot 1: running (private-project)\n");
  fs.writeFileSync(
    stderr,
    "    at connect (file:///Users/example/private/source.mjs:1:1)\n",
  );

  prepareRotatingLogs({ stdout, stderr });

  assert.equal(fs.readFileSync(stdout, "utf8"), "Slot 1: running\n");
  assert.equal(fs.readFileSync(stderr, "utf8"), "");
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(stdout).mode & 0o777, 0o600);
  assert.equal(fs.statSync(stderr).mode & 0o777, 0o600);
  fs.rmSync(directory, { recursive: true });
});

test("does not follow a symlink in the log directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const target = path.join(directory, "unrelated.txt");
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  fs.writeFileSync(target, "leave this alone\n");
  fs.symlinkSync(target, stdout);

  assert.throws(
    () => prepareRotatingLogs({ stdout, stderr }),
    /log is not a regular file/,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "leave this alone\n");
  assert.equal(fs.lstatSync(stdout).isSymbolicLink(), true);
  fs.rmSync(directory, { recursive: true });
});

test("rejects a symlinked log storage directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const target = path.join(directory, "unrelated");
  const logs = path.join(directory, "logs");
  fs.mkdirSync(target);
  fs.symlinkSync(target, logs);

  assert.throws(
    () => prepareRotatingLogs({
      stdout: path.join(logs, "bridge.log"),
      stderr: path.join(logs, "bridge-error.log"),
    }),
    /log storage is not a regular directory/,
  );
  assert.deepEqual(fs.readdirSync(target), []);
  fs.rmSync(directory, { recursive: true });
});

test("rejects a multiply linked log file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const target = path.join(directory, "unrelated.txt");
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  fs.writeFileSync(target, "leave this alone\n");
  fs.linkSync(target, stdout);

  assert.throws(
    () => prepareRotatingLogs({ stdout, stderr }),
    /log is not a regular file/,
  );
  assert.equal(fs.readFileSync(target, "utf8"), "leave this alone\n");
  fs.rmSync(directory, { recursive: true });
});

test("does not follow a log file replaced after logger creation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const target = path.join(directory, "unrelated.txt");
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  const logger = createRotatingLogger({ stdout, stderr });
  logger.info("first entry");
  fs.writeFileSync(target, "leave this alone\n");
  fs.unlinkSync(stdout);
  fs.symlinkSync(target, stdout);

  logger.info("second entry");

  assert.equal(fs.readFileSync(target, "utf8"), "leave this alone\n");
  assert.equal(fs.lstatSync(stdout).isSymbolicLink(), true);
  fs.rmSync(directory, { recursive: true });
});

test("does not follow a log directory replaced after logger creation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const logs = path.join(directory, "logs");
  const movedLogs = path.join(directory, "previous-logs");
  const target = path.join(directory, "unrelated");
  const stdout = path.join(logs, "bridge.log");
  const stderr = path.join(logs, "bridge-error.log");
  fs.mkdirSync(logs);
  fs.mkdirSync(target);
  const logger = createRotatingLogger({ stdout, stderr });
  fs.renameSync(logs, movedLogs);
  fs.symlinkSync(target, logs);

  logger.info("do not write this");

  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(fs.lstatSync(logs).isSymbolicLink(), true);
  fs.rmSync(directory, { recursive: true });
});

test("keeps new log entries on one line and omits local paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  const logger = createRotatingLogger({
    stdout,
    stderr,
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });

  logger.error(
    new Error(
      "device failed\n    at connect (file:///Users/example/private-project/src/device.mjs:4:2)",
    ),
  );

  assert.equal(
    fs.readFileSync(stderr, "utf8"),
    "2026-07-31T00:00:00.000Z ERROR Error: device failed at connect <local path omitted>\n",
  );
  fs.rmSync(directory, { recursive: true });
});

test("omits session identifiers and authentication tokens", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-logs-"));
  const stdout = path.join(directory, "bridge.log");
  const stderr = path.join(directory, "bridge-error.log");
  const logger = createRotatingLogger({
    stdout,
    stderr,
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });
  const session = "00000000-0000-4000-8000-000000000001";
  const token = "a".repeat(64);

  logger.error(`Session ${session} used token ${token}`);

  assert.equal(
    fs.readFileSync(stderr, "utf8"),
    "2026-07-31T00:00:00.000Z ERROR Session <session identifier omitted> used token <authentication token omitted>\n",
  );
  fs.writeFileSync(stdout, `Legacy session ${session} token ${token}\n`);
  prepareRotatingLogs({ stdout, stderr });
  assert.equal(
    fs.readFileSync(stdout, "utf8"),
    "Legacy session <session identifier omitted> token <authentication token omitted>\n",
  );
  fs.rmSync(directory, { recursive: true });
});
