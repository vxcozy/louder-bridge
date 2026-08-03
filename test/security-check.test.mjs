import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { securityFindings } from "../scripts/security-check.mjs";

test("rejects binary credentials by filename before content scanning", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-security-check-"),
  );
  fs.writeFileSync(path.join(directory, "developer-id.p12"), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(directory, ".env.example"), "TOKEN=placeholder\n");
  assert.deepEqual(securityFindings(directory), [
    "developer-id.p12: file should not be committed",
  ]);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("reports secret material in otherwise ordinary files", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-secret-content-"),
  );
  fs.writeFileSync(
    path.join(directory, "notes.txt"),
    `-----BEGIN ${"PRIVATE"} KEY-----\n`,
  );
  assert.deepEqual(securityFindings(directory), [
    "notes.txt: possible private key",
  ]);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("rejects symbolic links without following them", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-security-link-"),
  );
  const target = path.join(directory, "target.txt");
  fs.writeFileSync(target, "not secret\n");
  fs.symlinkSync(target, path.join(directory, "linked.txt"));
  assert.deepEqual(securityFindings(directory), [
    "linked.txt: symbolic link should not be committed",
  ]);
  fs.rmSync(directory, { recursive: true, force: true });
});
