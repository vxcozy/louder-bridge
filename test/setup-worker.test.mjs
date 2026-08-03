import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(
  new URL("../fixtures/setup-worker-parent.mjs", import.meta.url),
);

async function waitForMarker(marker) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(marker)) return fs.readFileSync(marker, "utf8");
    await delay(25);
  }
  throw new Error("The detached setup worker did not finish rollback.");
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await delay(25);
  }
  throw new Error("The detached setup worker did not exit after rollback.");
}

test("a detached setup worker rolls back after its npm parent dies", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-worker-"));
  const marker = path.join(directory, "rollback");
  const parent = spawn(process.execPath, [fixture], {
    detached: true,
    env: { ...process.env, LOUDER_SETUP_TEST_MARKER: marker },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let workerPid;

  try {
    const ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("The setup worker did not start in time.")),
        5000,
      );
      parent.once("error", reject);
      parent.on("message", (message) => {
        if (message?.type === "error") reject(new Error(message.detail));
        if (message?.type === "ready") {
          clearTimeout(timeout);
          resolve(message);
        }
      });
    });
    workerPid = ready.workerPid;

    process.kill(parent.pid, "SIGKILL");
    assert.equal(await waitForMarker(marker), "rolled-back");
    await waitForProcessExit(workerPid);
    workerPid = undefined;
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) {
      try {
        process.kill(parent.pid, "SIGKILL");
      } catch {}
    }
    if (workerPid) {
      try {
        process.kill(workerPid, "SIGKILL");
      } catch {}
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
