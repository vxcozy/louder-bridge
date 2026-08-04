import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addTemporaryKeychain,
  parseKeychainSearchList,
  restoreKeychainSearchList,
} from "../scripts/keychain-search-list.mjs";

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-keychain-list-"),
  );
  const keychainPath = path.join(directory, "signing.keychain-db");
  const statePath = path.join(directory, "original.json");
  fs.writeFileSync(keychainPath, "fixture", { mode: 0o600 });
  return { directory, keychainPath, statePath };
}

test("adds a temporary keychain and restores the original search list", () => {
  const { directory, keychainPath, statePath } = fixture();
  const original = [
    "/Users/runner/Library/Keychains/login.keychain-db",
    "/Library/Keychains/System.keychain",
  ];
  const calls = [];
  const security = (arguments_) => {
    calls.push(arguments_);
    if (arguments_.length === 3) {
      return original.map((filename) => `    ${JSON.stringify(filename)}`).join("\n");
    }
    return "";
  };

  addTemporaryKeychain({ keychainPath, statePath, security });
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.deepEqual(calls[1], [
    "list-keychains",
    "-d",
    "user",
    "-s",
    keychainPath,
    ...original,
  ]);

  restoreKeychainSearchList({ statePath, security });
  assert.deepEqual(calls[2], [
    "list-keychains",
    "-d",
    "user",
    "-s",
    ...original,
  ]);
  assert.equal(fs.existsSync(statePath), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("rejects malformed search lists and unsafe keychain files", () => {
  const { directory, keychainPath, statePath } = fixture();
  assert.throws(
    () => parseKeychainSearchList('"relative.keychain-db"\n'),
    /invalid entry/,
  );
  assert.throws(
    () => addTemporaryKeychain({
      keychainPath,
      statePath: "relative.json",
      security: () => "",
    }),
    /state path must be absolute/,
  );
  fs.chmodSync(keychainPath, 0o644);
  assert.throws(
    () => addTemporaryKeychain({
      keychainPath,
      statePath,
      security: () => "",
    }),
    /private, user-owned regular file/,
  );
  fs.rmSync(directory, { recursive: true, force: true });
});
