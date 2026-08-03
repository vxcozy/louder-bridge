#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function runSecurity(arguments_) {
  const result = spawnSync("/usr/bin/security", arguments_, {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `security ${arguments_[0]} failed: ${result.stderr?.trim() || `exit ${result.status}`}`,
    );
  }
  return result.stdout ?? "";
}

function assertPrivateRegularFile(filename, label) {
  if (!path.isAbsolute(filename)) {
    throw new Error(`${label} path must be absolute.`);
  }
  const entry = fs.lstatSync(filename);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    (typeof process.getuid === "function" && entry.uid !== process.getuid()) ||
    (entry.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} must be a private, user-owned regular file.`);
  }
  return entry;
}

export function parseKeychainSearchList(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let filename;
      try {
        filename = JSON.parse(line);
      } catch {
        throw new Error("The user keychain search list has an invalid entry.");
      }
      if (typeof filename !== "string" || !path.isAbsolute(filename)) {
        throw new Error("The user keychain search list has an invalid entry.");
      }
      return filename;
    });
}

export function addTemporaryKeychain({
  keychainPath,
  statePath,
  security = runSecurity,
}) {
  assertPrivateRegularFile(keychainPath, "Temporary signing keychain");
  if (!path.isAbsolute(statePath)) {
    throw new Error("Keychain search-list state path must be absolute.");
  }
  const original = parseKeychainSearchList(
    security(["list-keychains", "-d", "user"]),
  );
  fs.writeFileSync(statePath, `${JSON.stringify(original)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  assertPrivateRegularFile(statePath, "Keychain search-list state");
  const updated = [
    keychainPath,
    ...original.filter((filename) => filename !== keychainPath),
  ];
  security(["list-keychains", "-d", "user", "-s", ...updated]);
}

export function restoreKeychainSearchList({
  statePath,
  security = runSecurity,
}) {
  const entry = assertPrivateRegularFile(
    statePath,
    "Keychain search-list state",
  );
  if (entry.size > 64 * 1024) {
    throw new Error("The keychain search-list state file is too large.");
  }
  const contents = fs.readFileSync(statePath, "utf8");
  let original;
  try {
    original = JSON.parse(contents);
  } catch {
    throw new Error("The keychain search-list state file is invalid.");
  }
  if (
    !Array.isArray(original) ||
    original.some(
      (filename) => typeof filename !== "string" || !path.isAbsolute(filename),
    )
  ) {
    throw new Error("The keychain search-list state file is invalid.");
  }
  security(["list-keychains", "-d", "user", "-s", ...original]);
  fs.unlinkSync(statePath);
}

function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === "add" && first && second) {
    addTemporaryKeychain({ keychainPath: first, statePath: second });
    return;
  }
  if (command === "restore" && first && !second) {
    restoreKeychainSearchList({ statePath: first });
    return;
  }
  throw new Error(
    "Usage: keychain-search-list.mjs add <keychain> <state> | restore <state>",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
