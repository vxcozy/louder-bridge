import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileAtomicIfAbsent } from "./atomic-file.mjs";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const MAX_TOKEN_FILE_BYTES = 128;
const TOKEN_LINK_TRANSITION = "LOUDER_TOKEN_LINK_TRANSITION";
const TOKEN_INSPECTION_RETRIES = 20;
const TOKEN_INSPECTION_RETRY_MS = 10;
const retryWait = new Int32Array(new SharedArrayBuffer(4));

function pathEntry(filename) {
  try {
    return fs.lstatSync(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function fileIdentity(entry) {
  return { device: entry.dev, inode: entry.ino };
}

function sameFile(expected, actual) {
  return Boolean(
    expected &&
      actual &&
      expected.device === actual.device &&
      expected.inode === actual.inode,
  );
}

function inspectTokenFile(file, { normalizeMode = false } = {}) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    throw new Error(
      `Louder Bridge authentication token is not a regular file: ${file}`,
      { cause: error },
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size < 64 ||
      stat.size > MAX_TOKEN_FILE_BYTES ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error(
        `Louder Bridge authentication token is not a regular file: ${file}`,
      );
    }
    if (stat.nlink !== 1) {
      const error = new Error(
        `Louder Bridge authentication token is not a regular file: ${file}`,
      );
      error.code = TOKEN_LINK_TRANSITION;
      throw error;
    }
    const token = fs.readFileSync(descriptor, "utf8").trim();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error(`Louder Bridge authentication token is invalid: ${file}`);
    }
    const current = pathEntry(file);
    if (!current || !sameFile(fileIdentity(stat), fileIdentity(current))) {
      throw new Error(
        "The Louder Bridge authentication token changed while it was being read.",
      );
    }
    if (normalizeMode) fs.fchmodSync(descriptor, 0o600);
    return { token, identity: fileIdentity(stat) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateTokenFile(file, options) {
  return inspectTokenFile(file, options).token;
}

function inspectTokenFileAfterCreation(file, options) {
  for (let attempt = 0; attempt < TOKEN_INSPECTION_RETRIES; attempt += 1) {
    try {
      return inspectTokenFile(file, options);
    } catch (error) {
      if (
        error?.code !== TOKEN_LINK_TRANSITION ||
        attempt === TOKEN_INSPECTION_RETRIES - 1
      ) {
        throw error;
      }
      Atomics.wait(retryWait, 0, 0, TOKEN_INSPECTION_RETRY_MS);
    }
  }
  throw new Error("Louder Bridge could not read its authentication token.");
}

function requireTokenFile(file, identity, message, options) {
  let current;
  try {
    current = inspectTokenFile(file, options);
  } catch (error) {
    throw new Error(message, { cause: error });
  }
  if (!sameFile(identity, current.identity)) {
    throw new Error(message);
  }
  return current;
}

function prepareTokenDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    const stat = fs.fstatSync(descriptor);
    if (!stat.isDirectory()) {
      throw new Error("not a directory");
    }
    if (
      typeof process.getuid === "function" &&
      stat.uid !== process.getuid()
    ) {
      throw new Error("not owned by the current user");
    }
    fs.fchmodSync(descriptor, 0o700);
  } catch (error) {
    throw new Error(
      `Louder Bridge authentication storage is not a regular directory: ${directory}`,
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function authTokenPath(homeDirectory = os.homedir()) {
  return path.join(
    homeDirectory,
    "Library",
    "Application Support",
    "LouderBridge",
    "auth-token",
  );
}

export function ensureAuthToken({
  homeDirectory = os.homedir(),
  generate = () => randomBytes(32).toString("hex"),
} = {}) {
  const file = authTokenPath(homeDirectory);
  const directory = path.dirname(file);
  prepareTokenDirectory(directory);
  try {
    const existing = inspectTokenFileAfterCreation(file, {
      normalizeMode: true,
    });
    return {
      file,
      ...existing,
      created: false,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const token = generate();
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new Error("Authentication token generator returned an invalid token.");
  }
  const created = writeFileAtomicIfAbsent(file, `${token}\n`, { mode: 0o600 });
  const stored = inspectTokenFileAfterCreation(file, { normalizeMode: true });
  if (created && stored.token === token) {
    return { file, ...stored, created: true };
  }
  return {
    file,
    ...stored,
    created: false,
  };
}

export function readAuthToken({
  homeDirectory = os.homedir(),
} = {}) {
  const file = authTokenPath(homeDirectory);
  try {
    return validateTokenFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error("Open Louder Bridge once to finish setup.");
  }
}

export function removeAuthToken({
  homeDirectory = os.homedir(),
  identity,
} = {}) {
  const file = authTokenPath(homeDirectory);
  if (pathEntry(file)) {
    const current = inspectTokenFile(file);
    requireTokenFile(
      file,
      identity ?? current.identity,
      "The authentication token changed before it could be removed. It was left untouched.",
    );
    fs.unlinkSync(file);
  }
  return file;
}

export function stageAuthTokenRemoval({
  homeDirectory = os.homedir(),
} = {}) {
  const file = authTokenPath(homeDirectory);
  let current;
  try {
    current = inspectTokenFile(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { file, backup: null, identity: null };
    }
    throw error;
  }
  const backup = `${file}.${randomUUID()}.removing`;
  fs.linkSync(file, backup);
  let sourceRemoved = false;
  try {
    const source = pathEntry(file);
    const staged = pathEntry(backup);
    if (
      !sameFile(current.identity, source && fileIdentity(source)) ||
      !sameFile(current.identity, staged && fileIdentity(staged))
    ) {
      throw new Error(
        "The authentication token changed before removal could begin.",
      );
    }
    fs.unlinkSync(file);
    sourceRemoved = true;
    requireTokenFile(
      backup,
      current.identity,
      "The authentication token changed while it was moving into backup.",
    );
  } catch (error) {
    const staged = pathEntry(backup);
    if (
      !sourceRemoved &&
      staged &&
      sameFile(current.identity, fileIdentity(staged))
    ) {
      fs.unlinkSync(backup);
    }
    throw error;
  }
  return { file, backup, identity: current.identity };
}

export function rollbackAuthTokenRemoval(transaction) {
  if (!transaction?.backup) return;
  if (!pathEntry(transaction.backup)) {
    throw new Error(
      "The authentication token backup is missing, so rollback left the current token untouched.",
    );
  }
  requireTokenFile(
    transaction.backup,
    transaction.identity,
    "The authentication token backup changed during rollback. It was left untouched.",
  );
  if (pathEntry(transaction.file)) {
    throw new Error(
      "A new authentication token appeared during rollback. Both tokens were left untouched.",
    );
  }
  requireTokenFile(
    transaction.backup,
    transaction.identity,
    "The authentication token backup changed during rollback. It was left untouched.",
  );
  try {
    fs.linkSync(transaction.backup, transaction.file);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        "A new authentication token appeared during rollback. Both tokens were left untouched.",
        { cause: error },
      );
    }
    throw error;
  }
  const restored = pathEntry(transaction.file);
  if (!sameFile(transaction.identity, restored && fileIdentity(restored))) {
    throw new Error(
      "The restored authentication token changed during rollback. Its backup was left untouched.",
    );
  }
  const backupBeforeUnlink = pathEntry(transaction.backup);
  const restoredBeforeUnlink = pathEntry(transaction.file);
  if (
    !sameFile(
      transaction.identity,
      backupBeforeUnlink && fileIdentity(backupBeforeUnlink),
    ) ||
    !sameFile(
      transaction.identity,
      restoredBeforeUnlink && fileIdentity(restoredBeforeUnlink),
    )
  ) {
    throw new Error(
      "The authentication token changed during rollback. Its backup was left untouched.",
    );
  }
  fs.unlinkSync(transaction.backup);
  requireTokenFile(
    transaction.file,
    transaction.identity,
    "The restored authentication token changed during rollback.",
    { normalizeMode: true },
  );
}

export function commitAuthTokenRemoval(transaction) {
  if (transaction?.backup && pathEntry(transaction.backup)) {
    requireTokenFile(
      transaction.backup,
      transaction.identity,
      "The authentication token backup changed before cleanup. It was left untouched.",
    );
    fs.unlinkSync(transaction.backup);
  }
}
