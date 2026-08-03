import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { signingKeychainArguments } from "../scripts/signing-keychain.mjs";

test("restricts Developer ID signing to a private keychain", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-signing-keychain-"),
  );
  const filename = path.join(directory, "signing.keychain-db");
  fs.writeFileSync(filename, "fixture", { mode: 0o600 });
  assert.deepEqual(
    signingKeychainArguments({
      identity: "Developer ID Application",
      keychainPath: filename,
    }),
    ["--keychain", filename],
  );
  fs.chmodSync(filename, 0o644);
  assert.throws(
    () => signingKeychainArguments({
      identity: "Developer ID Application",
      keychainPath: filename,
    }),
    /private, user-owned regular file/,
  );
  assert.throws(
    () => signingKeychainArguments({ identity: null, keychainPath: filename }),
    /requires APPLE_SIGNING_IDENTITY/,
  );
  fs.rmSync(directory, { recursive: true, force: true });
});

test("rejects linked signing keychains", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-linked-keychain-"),
  );
  const filename = path.join(directory, "signing.keychain-db");
  const hardLink = path.join(directory, "hard-link.keychain-db");
  const symbolicLink = path.join(directory, "symbolic-link.keychain-db");
  fs.writeFileSync(filename, "fixture", { mode: 0o600 });
  fs.linkSync(filename, hardLink);
  fs.symlinkSync(filename, symbolicLink);
  for (const keychainPath of [filename, hardLink, symbolicLink]) {
    assert.throws(
      () => signingKeychainArguments({
        identity: "Developer ID Application",
        keychainPath,
      }),
      /private, user-owned regular file/,
    );
  }
  fs.rmSync(directory, { recursive: true, force: true });
});
