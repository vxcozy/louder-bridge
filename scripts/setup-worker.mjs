#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCli = path.resolve(scriptDirectory, "..", "src", "cli.mjs");

export function startSetupWorker({
  cli = defaultCli,
  environment = process.env,
  run = spawn,
} = {}) {
  return run(process.execPath, [cli, "setup"], {
    detached: true,
    env: environment,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
}

export async function runSetupWorker(options) {
  const child = startSetupWorker(options);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (Number.isInteger(code)) {
        resolve(code);
      } else {
        reject(new Error(`Setup worker stopped with ${signal ?? "no status"}.`));
      }
    });
  });
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    process.exitCode = await runSetupWorker();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Setup could not start: ${detail}`);
    process.exitCode = 1;
  }
}
