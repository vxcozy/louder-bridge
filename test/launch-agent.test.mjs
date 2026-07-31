import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installLaunchAgent,
  launchAgentIsRunning,
  launchAgentPaths,
  launchAgentPlist,
  removeLaunchAgent,
} from "../src/setup/launch-agent.mjs";

test("builds a launch agent for the background service", () => {
  const plist = launchAgentPlist({
    runtime: {
      launcher: "/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
      node: "/Applications/Louder Bridge.app/Contents/MacOS/node",
      cli: "/Applications/Louder Bridge.app/Contents/Resources/app/src/cli.mjs",
      workingDirectory: "/Applications/Louder Bridge.app/Contents/Resources/app",
    },
    workingDirectory: "/repo",
    paths: {
      stdout: "/logs/out.log",
      stderr: "/logs/error.log",
    },
    environment: {
      LOUDER_BRIDGE_HOST: "127.0.0.1",
      LOUDER_BRIDGE_PORT: "47831",
      SPECIAL: "a&b",
    },
  });

  assert.match(
    plist,
    /<string>\/Applications\/Louder Bridge\.app\/Contents\/MacOS\/LouderBridge<\/string>/,
  );
  assert.match(plist, /<string>--service<\/string>/);
  assert.doesNotMatch(
    plist,
    /<string>\/Applications\/Louder Bridge\.app\/Contents\/MacOS\/node<\/string>/,
  );
  assert.match(plist, /<key>RunAtLoad<\/key>\s+<true\/>/);
  assert.match(plist, /<string>a&amp;b<\/string>/);
});

test("installs and removes the launch agent without shell commands", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-agent-"),
  );
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };

  const installed = installLaunchAgent({
    homeDirectory,
    userId: 501,
    run,
  });
  assert.equal(fs.existsSync(installed.plist), true);
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["print", "bootout", "bootstrap", "kickstart"],
  );

  removeLaunchAgent({ homeDirectory, userId: 501, run });
  assert.equal(fs.existsSync(launchAgentPaths(homeDirectory).plist), false);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("reports only a running launch agent as active", () => {
  const running = (command, args) => ({
    status: 0,
    stdout: "state = running\n",
    stderr: "",
  });
  const waiting = (command, args) => ({
    status: 0,
    stdout: "state = waiting\n",
    stderr: "",
  });
  assert.equal(launchAgentIsRunning({ userId: 501, run: running }), true);
  assert.equal(launchAgentIsRunning({ userId: 501, run: waiting }), false);
});

test("retries bootstrap while the previous agent is unloading", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-retry-"),
  );
  let bootstraps = 0;
  const run = (command, args) => {
    if (args[0] === "bootstrap") {
      bootstraps += 1;
      if (bootstraps === 1) {
        return { status: 5, stdout: "", stderr: "Input/output error" };
      }
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  installLaunchAgent({ homeDirectory, userId: 501, run });
  assert.equal(bootstraps, 2);
  removeLaunchAgent({ homeDirectory, userId: 501, run });
  fs.rmSync(homeDirectory, { recursive: true });
});

test("restores the previous launch agent after an install failure", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-rollback-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  let bootstraps = 0;
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    if (args[0] === "bootstrap") {
      bootstraps += 1;
      if (bootstraps <= 3) {
        return { status: 5, stdout: "", stderr: "Input/output error" };
      }
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(
    () => installLaunchAgent({ homeDirectory, userId: 501, run }),
    /launchctl bootstrap failed/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "previous plist");
  assert.equal(bootstraps, 4);
  fs.rmSync(homeDirectory, { recursive: true });
});
