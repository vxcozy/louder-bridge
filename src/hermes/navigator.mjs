import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SESSION_ID_PATTERN = /^\d{8}_\d{6}_[0-9a-f]{6,}$/i;

export function hermesExecutableCandidates(homeDirectory = os.homedir()) {
  return [
    process.env.HERMES_BIN,
    path.join(homeDirectory, ".local", "bin", "hermes"),
    "/opt/homebrew/bin/hermes",
    "/usr/local/bin/hermes",
  ].filter(Boolean);
}

export function findHermesExecutable({
  candidates = hermesExecutableCandidates(),
  access = fs.accessSync,
} = {}) {
  for (const candidate of candidates) {
    try {
      access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function sessionRankFromListing(output, sessionId) {
  const sessions = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).at(-1))
    .filter((id) => SESSION_ID_PATTERN.test(id));
  const index = sessions.indexOf(sessionId);
  return index < 0 ? null : index + 1;
}

export class HermesRecentSessionNavigator {
  constructor({
    launcher = process.env.LOUDER_BRIDGE_LAUNCHER,
    hermes = findHermesExecutable(),
    run = execFileAsync,
  } = {}) {
    this.launcher = launcher;
    this.hermes = hermes;
    this.run = run;
  }

  metadata() {
    return {
      id: "hermes-recent-session-shortcut",
      support: "experimental",
    };
  }

  async open(sessionId) {
    if (!this.launcher) {
      throw new Error("The installed Louder Bridge launcher is unavailable.");
    }
    if (!this.hermes) {
      throw new Error("Hermes is not installed or is not executable.");
    }
    let stdout;
    try {
      ({ stdout } = await this.run(
        this.hermes,
        ["sessions", "list", "--limit", "50"],
        { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true },
      ));
    } catch (error) {
      const detail = error?.stderr?.trim() || error?.message || String(error);
      throw new Error(`Hermes sessions could not be read: ${detail}`);
    }
    const rank = sessionRankFromListing(stdout, sessionId);
    if (!rank) {
      throw new Error("Hermes no longer lists this session among its recent sessions.");
    }
    if (rank > 9) {
      throw new Error("Hermes only exposes shortcuts for its nine most recent sessions.");
    }
    try {
      await this.run(this.launcher, ["--hermes-session-slot", String(rank)], {
        timeout: 5000,
        windowsHide: true,
      });
    } catch (error) {
      const detail = error?.stderr?.trim() || error?.message || String(error);
      throw new Error(detail);
    }
  }
}

export function createHermesNavigator(options) {
  return new HermesRecentSessionNavigator(options);
}
