import fs from "node:fs";
import path from "node:path";

export function signingKeychainArguments({ identity, keychainPath }) {
  if (!keychainPath) return [];
  if (!identity) {
    throw new Error(
      "APPLE_SIGNING_KEYCHAIN requires APPLE_SIGNING_IDENTITY.",
    );
  }
  if (!path.isAbsolute(keychainPath)) {
    throw new Error("APPLE_SIGNING_KEYCHAIN must be an absolute path.");
  }
  const entry = fs.lstatSync(keychainPath);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    (typeof process.getuid === "function" && entry.uid !== process.getuid()) ||
    (entry.mode & 0o077) !== 0
  ) {
    throw new Error(
      "APPLE_SIGNING_KEYCHAIN must be a private, user-owned regular file.",
    );
  }
  return ["--keychain", keychainPath];
}
