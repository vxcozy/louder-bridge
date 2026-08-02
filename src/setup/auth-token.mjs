import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileAtomicIfAbsent } from "./atomic-file.mjs";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function validateTokenFile(file, { normalizeMode = false } = {}) {
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
    if (!stat.isFile()) {
      throw new Error(
        `Louder Bridge authentication token is not a regular file: ${file}`,
      );
    }
    const token = fs.readFileSync(descriptor, "utf8").trim();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error(`Louder Bridge authentication token is invalid: ${file}`);
    }
    if (normalizeMode) fs.fchmodSync(descriptor, 0o600);
    return token;
  } finally {
    fs.closeSync(descriptor);
  }
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
    if (!fs.fstatSync(descriptor).isDirectory()) {
      throw new Error("not a directory");
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
    return {
      file,
      token: validateTokenFile(file, { normalizeMode: true }),
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
  if (created) return { file, token, created: true };
  return {
    file,
    token: validateTokenFile(file, { normalizeMode: true }),
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
} = {}) {
  const file = authTokenPath(homeDirectory);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return file;
}

export function stageAuthTokenRemoval({
  homeDirectory = os.homedir(),
} = {}) {
  const file = authTokenPath(homeDirectory);
  try {
    validateTokenFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return { file, backup: null };
    throw error;
  }
  const backup = `${file}.${randomUUID()}.removing`;
  fs.renameSync(file, backup);
  return { file, backup };
}

export function rollbackAuthTokenRemoval(transaction) {
  if (!transaction?.backup) return;
  try {
    validateTokenFile(transaction.backup);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (fs.existsSync(transaction.file)) fs.unlinkSync(transaction.file);
  fs.renameSync(transaction.backup, transaction.file);
  validateTokenFile(transaction.file, { normalizeMode: true });
}

export function commitAuthTokenRemoval(transaction) {
  if (transaction?.backup && fs.existsSync(transaction.backup)) {
    fs.unlinkSync(transaction.backup);
  }
}
