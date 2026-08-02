import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileAtomic } from "./atomic-file.mjs";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function validateTokenFile(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Louder Bridge authentication token is not a regular file: ${file}`);
  }
  const token = fs.readFileSync(file, "utf8").trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(`Louder Bridge authentication token is invalid: ${file}`);
  }
  return token;
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
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = fs.lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(
      `Louder Bridge authentication storage is not a regular directory: ${directory}`,
    );
  }
  fs.chmodSync(directory, 0o700);
  if (fs.existsSync(file)) {
    const token = validateTokenFile(file);
    fs.chmodSync(file, 0o600);
    return { file, token, created: false };
  }
  const token = generate();
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
    throw new Error("Authentication token generator returned an invalid token.");
  }
  writeFileAtomic(file, `${token}\n`, { mode: 0o600 });
  return { file, token, created: true };
}

export function readAuthToken({
  homeDirectory = os.homedir(),
} = {}) {
  const file = authTokenPath(homeDirectory);
  if (!fs.existsSync(file)) {
    throw new Error("Open Louder Bridge once to finish setup.");
  }
  return validateTokenFile(file);
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
  if (!fs.existsSync(file)) return { file, backup: null };
  const backup = `${file}.${randomUUID()}.removing`;
  fs.renameSync(file, backup);
  return { file, backup };
}

export function rollbackAuthTokenRemoval(transaction) {
  if (!transaction?.backup || !fs.existsSync(transaction.backup)) return;
  if (fs.existsSync(transaction.file)) fs.unlinkSync(transaction.file);
  fs.renameSync(transaction.backup, transaction.file);
  fs.chmodSync(transaction.file, 0o600);
}

export function commitAuthTokenRemoval(transaction) {
  if (transaction?.backup && fs.existsSync(transaction.backup)) {
    fs.unlinkSync(transaction.backup);
  }
}
