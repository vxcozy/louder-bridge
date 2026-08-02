import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeFileAtomic,
  writeFileAtomicIfAbsent,
} from "../src/setup/atomic-file.mjs";

test("atomically replaces a file without leaving temporary files", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-atomic-"),
  );
  const filename = path.join(directory, "settings.json");
  writeFileAtomic(filename, "first\n");
  writeFileAtomic(filename, "second\n");

  assert.equal(fs.readFileSync(filename, "utf8"), "second\n");
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ["settings.json"]);
  fs.rmSync(directory, { recursive: true });
});

test("atomically creates a file without replacing a concurrent value", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-atomic-"),
  );
  const filename = path.join(directory, "auth-token");

  assert.equal(writeFileAtomicIfAbsent(filename, "first\n"), true);
  assert.equal(writeFileAtomicIfAbsent(filename, "second\n"), false);

  assert.equal(fs.readFileSync(filename, "utf8"), "first\n");
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ["auth-token"]);
  fs.rmSync(directory, { recursive: true });
});
