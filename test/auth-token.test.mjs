import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  authTokenPath,
  commitAuthTokenRemoval,
  ensureAuthToken,
  readAuthToken,
  removeAuthToken,
  rollbackAuthTokenRemoval,
  stageAuthTokenRemoval,
} from "../src/setup/auth-token.mjs";

function createTokenInChild(homeDirectory) {
  const moduleUrl = new URL("../src/setup/auth-token.mjs", import.meta.url).href;
  const source = [
    `import { ensureAuthToken } from ${JSON.stringify(moduleUrl)};`,
    "console.log(ensureAuthToken({ homeDirectory: process.argv[1] }).token);",
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", source, homeDirectory],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `child exited ${code}`));
    });
  });
}

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

  fs.chmodSync(created.file, 0o644);
  const reused = ensureAuthToken({
    homeDirectory,
    generate: () => {
      throw new Error("should not regenerate");
    },
  });
  assert.equal(reused.created, false);
  assert.equal(reused.token, expected);
  assert.equal(fs.statSync(created.file).mode & 0o777, 0o600);

  removeAuthToken({ homeDirectory });
  assert.equal(fs.existsSync(authTokenPath(homeDirectory)), false);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("concurrent setup processes agree on one authentication token", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-concurrent-"),
  );
  const tokens = await Promise.all(
    Array.from({ length: 4 }, () => createTokenInChild(homeDirectory)),
  );

  assert.equal(new Set(tokens).size, 1);
  assert.match(tokens[0], /^[a-f0-9]{64}$/);
  assert.equal(readAuthToken({ homeDirectory }), tokens[0]);
  assert.deepEqual(
    fs.readdirSync(path.dirname(authTokenPath(homeDirectory))),
    ["auth-token"],
  );
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
  assert.throws(
    () => stageAuthTokenRemoval({ homeDirectory }),
    /not a regular file/,
  );
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("rejects a symlinked authentication directory", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-directory-link-"),
  );
  const file = authTokenPath(homeDirectory);
  const target = path.join(homeDirectory, "other-directory");
  fs.mkdirSync(path.dirname(path.dirname(file)), { recursive: true });
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.dirname(file));

  assert.throws(
    () => ensureAuthToken({ homeDirectory }),
    /authentication storage is not a regular directory/,
  );
  assert.deepEqual(fs.readdirSync(target), []);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("stages token removal for commit or rollback", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-removal-"),
  );
  const created = ensureAuthToken({ homeDirectory });

  const rolledBack = stageAuthTokenRemoval({ homeDirectory });
  assert.equal(fs.existsSync(created.file), false);
  rollbackAuthTokenRemoval(rolledBack);
  assert.equal(readAuthToken({ homeDirectory }), created.token);
  assert.equal(fs.statSync(created.file).mode & 0o777, 0o600);

  const committed = stageAuthTokenRemoval({ homeDirectory });
  commitAuthTokenRemoval(committed);
  assert.equal(fs.existsSync(created.file), false);
  assert.equal(fs.existsSync(committed.backup), false);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("rejects a multiply linked authentication token", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-hardlink-"),
  );
  const created = ensureAuthToken({ homeDirectory });
  const hardlink = path.join(homeDirectory, "token-hardlink");
  fs.linkSync(created.file, hardlink);

  assert.throws(
    () => readAuthToken({ homeDirectory }),
    /not a regular file/,
  );
  assert.equal(fs.readFileSync(hardlink, "utf8").trim(), created.token);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("token cleanup leaves a replacement file untouched", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-replaced-"),
  );
  const created = ensureAuthToken({ homeDirectory });
  fs.renameSync(created.file, path.join(homeDirectory, "original-token"));
  const replacement = "c".repeat(64);
  fs.writeFileSync(created.file, `${replacement}\n`, { mode: 0o600 });

  assert.throws(
    () =>
      removeAuthToken({
        homeDirectory,
        identity: created.identity,
      }),
    /changed before it could be removed.*left untouched/,
  );
  assert.equal(readAuthToken({ homeDirectory }), replacement);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("token rollback does not delete a token that appeared later", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-rollback-occupied-"),
  );
  ensureAuthToken({ homeDirectory });
  const transaction = stageAuthTokenRemoval({ homeDirectory });
  const replacement = "d".repeat(64);
  fs.writeFileSync(transaction.file, `${replacement}\n`, { mode: 0o600 });

  assert.throws(
    () => rollbackAuthTokenRemoval(transaction),
    /new authentication token appeared.*left untouched/,
  );
  assert.equal(readAuthToken({ homeDirectory }), replacement);
  assert.equal(fs.existsSync(transaction.backup), true);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("token rollback keeps the current token when its backup is missing", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-rollback-missing-"),
  );
  ensureAuthToken({ homeDirectory });
  const transaction = stageAuthTokenRemoval({ homeDirectory });
  fs.renameSync(
    transaction.backup,
    path.join(homeDirectory, "missing-backup"),
  );
  const replacement = "f".repeat(64);
  fs.writeFileSync(transaction.file, `${replacement}\n`, { mode: 0o600 });

  assert.throws(
    () => rollbackAuthTokenRemoval(transaction),
    /backup is missing.*current token untouched/,
  );
  assert.equal(readAuthToken({ homeDirectory }), replacement);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("token cleanup leaves a changed backup untouched", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-auth-token-backup-replaced-"),
  );
  ensureAuthToken({ homeDirectory });
  const transaction = stageAuthTokenRemoval({ homeDirectory });
  fs.renameSync(
    transaction.backup,
    path.join(homeDirectory, "original-backup"),
  );
  const replacement = "e".repeat(64);
  fs.writeFileSync(transaction.backup, `${replacement}\n`, { mode: 0o600 });

  assert.throws(
    () => commitAuthTokenRemoval(transaction),
    /backup changed before cleanup.*left untouched/,
  );
  assert.equal(
    fs.readFileSync(transaction.backup, "utf8").trim(),
    replacement,
  );
  fs.rmSync(homeDirectory, { recursive: true });
});
