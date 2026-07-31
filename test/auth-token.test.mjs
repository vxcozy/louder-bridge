import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  authTokenPath,
  ensureAuthToken,
  readAuthToken,
  removeAuthToken,
} from "../src/setup/auth-token.mjs";

test("creates, reuses, and removes a private authentication token", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-"),
  );
  const expected = "a".repeat(64);
  const created = ensureAuthToken({
    homeDirectory,
    generate: () => expected,
  });
  assert.equal(created.created, true);
  assert.equal(readAuthToken({ homeDirectory }), expected);
  assert.equal(fs.statSync(created.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(created.file)).mode & 0o777, 0o700);

  const reused = ensureAuthToken({
    homeDirectory,
    generate: () => {
      throw new Error("should not regenerate");
    },
  });
  assert.equal(reused.created, false);
  assert.equal(reused.token, expected);

  removeAuthToken({ homeDirectory });
  assert.equal(fs.existsSync(authTokenPath(homeDirectory)), false);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("directs packaged users back to the app when setup is incomplete", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-missing-"),
  );
  assert.throws(
    () => readAuthToken({ homeDirectory }),
    /Open Louder Bridge once to finish setup/,
  );
  fs.rmSync(homeDirectory, { recursive: true });
});

test("rejects a token path that is not a regular file", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-link-"),
  );
  const file = authTokenPath(homeDirectory);
  const target = path.join(homeDirectory, "other-file");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(target, `${"b".repeat(64)}\n`, { mode: 0o644 });
  fs.symlinkSync(target, file);

  assert.throws(
    () => readAuthToken({ homeDirectory }),
    /not a regular file/,
  );
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  fs.rmSync(homeDirectory, { recursive: true });
});
