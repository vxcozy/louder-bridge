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
  restoreRemovedLaunchAgent,
  waitForLaunchAgent,
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

test("installs and removes the launch agent without shell commands", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-agent-"),
  );
  const calls = [];
  const run = (command, args, options) => {
    assert.deepEqual(options, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    calls.push([command, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };

  const installed = await installLaunchAgent({
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

test("waits briefly for the replacement launch agent to start", () => {
  let checks = 0;
  let sleeps = 0;
  const run = (command) => {
    if (command === "/bin/sleep") {
      sleeps += 1;
      return { status: 0, stdout: "", stderr: "" };
    }
    checks += 1;
    return {
      status: 0,
      stdout: checks === 3 ? "state = running\n" : "state = waiting\n",
      stderr: "",
    };
  };

  assert.equal(
    waitForLaunchAgent({ userId: 501, run, attempts: 4 }),
    true,
  );
  assert.equal(checks, 3);
  assert.equal(sleeps, 2);
});

test("reports when the replacement launch agent never starts", () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === "/bin/sleep") {
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "state = waiting\n", stderr: "" };
  };

  assert.equal(
    waitForLaunchAgent({ userId: 501, run, attempts: 3 }),
    false,
  );
  assert.deepEqual(
    calls.map((call) => call[0]),
    [
      "/bin/launchctl",
      "/bin/sleep",
      "/bin/launchctl",
      "/bin/sleep",
      "/bin/launchctl",
    ],
  );
});

test("reports a bounded retry-sleep failure", () => {
  const run = (command, args, options) => {
    if (command === "/bin/sleep") {
      assert.deepEqual(options, {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
      return { status: null, error: new Error("timed out") };
    }
    return { status: 0, stdout: "state = waiting\n", stderr: "" };
  };

  assert.throws(
    () => waitForLaunchAgent({ userId: 501, run, attempts: 2 }),
    /sleep failed: timed out/,
  );
});

test("retries bootstrap while the previous agent is unloading", async () => {
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

  await installLaunchAgent({ homeDirectory, userId: 501, run });
  assert.equal(bootstraps, 2);
  removeLaunchAgent({ homeDirectory, userId: 501, run });
  fs.rmSync(homeDirectory, { recursive: true });
});

test("restores the previous launch agent after an install failure", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-rollback-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  fs.chmodSync(paths.plist, 0o600);
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

  await assert.rejects(
    () => installLaunchAgent({ homeDirectory, userId: 501, run }),
    /launchctl bootstrap failed/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "previous plist");
  assert.equal(fs.statSync(paths.plist).mode & 0o777, 0o600);
  assert.equal(bootstraps, 4);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("reloads the previous agent after an uncertain install bootout", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-bootout-rollback-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  let bootouts = 0;
  let bootstraps = 0;
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    if (args[0] === "bootout") {
      bootouts += 1;
      if (bootouts === 1) {
        return { status: 5, stdout: "", stderr: "Input/output error" };
      }
    }
    if (args[0] === "bootstrap") bootstraps += 1;
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    () => installLaunchAgent({ homeDirectory, userId: 501, run }),
    /launchctl bootout failed/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "previous plist");
  assert.equal(bootouts, 2);
  assert.equal(bootstraps, 1);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("restores a launch agent removed during a failed setup", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-removal-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  fs.chmodSync(paths.plist, 0o600);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  const removal = removeLaunchAgent({
    homeDirectory,
    userId: 501,
    run,
  });
  assert.equal(fs.existsSync(paths.plist), false);
  restoreRemovedLaunchAgent(removal, { run });

  assert.equal(fs.readFileSync(paths.plist, "utf8"), "previous plist");
  assert.equal(fs.statSync(paths.plist).mode & 0o777, 0o600);
  assert.deepEqual(
    calls.map((call) => call[1]),
    ["print", "bootout", "bootout", "bootstrap", "kickstart"],
  );
  fs.rmSync(homeDirectory, { recursive: true });
});

test("does not remove a launch-agent file changed after bootout", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-remove-conflict-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  let bootstraps = 0;
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    if (args[0] === "bootout") {
      fs.writeFileSync(paths.plist, "newer plist");
    }
    if (args[0] === "bootstrap") bootstraps += 1;
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(
    () => removeLaunchAgent({ homeDirectory, userId: 501, run }),
    /changed before removal.*left untouched/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "newer plist");
  assert.equal(bootstraps, 0);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("reloads the previous agent after an uncertain removal bootout", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-remove-bootout-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  let bootouts = 0;
  let bootstraps = 0;
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    if (args[0] === "bootout") {
      bootouts += 1;
      if (bootouts === 1) {
        return { status: 5, stdout: "", stderr: "Input/output error" };
      }
    }
    if (args[0] === "bootstrap") bootstraps += 1;
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(
    () => removeLaunchAgent({ homeDirectory, userId: 501, run }),
    /launchctl bootout failed/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "previous plist");
  assert.equal(bootouts, 2);
  assert.equal(bootstraps, 1);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("does not overwrite a launch-agent file created before rollback", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-restore-conflict-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  const run = (command, args) => ({
    status: args[0] === "print" ? 1 : 0,
    stdout: "",
    stderr: "",
  });
  const removal = removeLaunchAgent({ homeDirectory, userId: 501, run });
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "newer plist");

  assert.throws(
    () => restoreRemovedLaunchAgent(removal, { run }),
    /appeared during rollback.*left untouched/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "newer plist");
  fs.rmSync(homeDirectory, { recursive: true });
});

test("does not overwrite a launch-agent file created during rollback", () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-restore-race-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  const removeRun = (command, args) => ({
    status: 0,
    stdout: args[0] === "print" ? "state = running" : "",
    stderr: "",
  });
  const removal = removeLaunchAgent({
    homeDirectory,
    userId: 501,
    run: removeRun,
  });
  let created = false;
  const restoreRun = (command, args) => {
    if (args[0] === "bootout" && !created) {
      created = true;
      fs.writeFileSync(paths.plist, "newer plist");
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  assert.throws(
    () => restoreRemovedLaunchAgent(removal, { run: restoreRun }),
    /appeared during rollback.*left untouched/,
  );
  assert.equal(fs.readFileSync(paths.plist, "utf8"), "newer plist");
  fs.rmSync(homeDirectory, { recursive: true });
});

test("rejects a symlinked launch-agent property list", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-link-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  const target = path.join(homeDirectory, "unrelated.plist");
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(target, "unrelated");
  fs.symlinkSync(target, paths.plist);
  let calls = 0;

  await assert.rejects(
    () =>
      installLaunchAgent({
        homeDirectory,
        userId: 501,
        run() {
          calls += 1;
          return { status: 0, stdout: "", stderr: "" };
        },
      }),
    /launch agent is not a regular file/,
  );
  assert.equal(calls, 0);
  assert.equal(fs.readFileSync(target, "utf8"), "unrelated");
  fs.rmSync(homeDirectory, { recursive: true });
});

test("does not change permissions through a symlinked log directory", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-log-link-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  const target = path.join(homeDirectory, "unrelated-logs");
  fs.mkdirSync(path.dirname(paths.logs), { recursive: true });
  fs.mkdirSync(target, { mode: 0o755 });
  fs.chmodSync(target, 0o755);
  fs.symlinkSync(target, paths.logs);

  await assert.rejects(
    () => installLaunchAgent({ homeDirectory, userId: 501 }),
    /log storage is not a user-owned directory/,
  );
  assert.equal(fs.statSync(target).mode & 0o777, 0o755);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("verifies the replacement agent before installation succeeds", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-verify-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  };
  let verified = false;

  await installLaunchAgent({
    homeDirectory,
    userId: 501,
    run,
    async verify(installed) {
      assert.equal(installed.plist, paths.plist);
      assert.equal(fs.existsSync(paths.plist), true);
      assert.equal(calls.at(-1)[1], "kickstart");
      verified = true;
    },
  });

  assert.equal(verified, true);
  await removeLaunchAgent({ homeDirectory, userId: 501, run });
  fs.rmSync(homeDirectory, { recursive: true });
});

test("restores the previous agent when readiness verification fails", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-health-rollback-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  fs.chmodSync(paths.plist, 0o600);
  let bootstraps = 0;
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    if (args[0] === "bootstrap") bootstraps += 1;
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    () =>
      installLaunchAgent({
        homeDirectory,
        userId: 501,
        run,
        async verify() {
          throw new Error("agent health check failed");
        },
      }),
    /agent health check failed/,
  );

  assert.equal(fs.readFileSync(paths.plist, "utf8"), "previous plist");
  assert.equal(fs.statSync(paths.plist).mode & 0o777, 0o600);
  assert.equal(bootstraps, 2);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("removes a first-install agent when readiness verification fails", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-health-first-install-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  const run = (command, args) => ({
    status: args[0] === "print" ? 1 : 0,
    stdout: "",
    stderr: "",
  });

  await assert.rejects(
    () =>
      installLaunchAgent({
        homeDirectory,
        userId: 501,
        run,
        async verify() {
          throw new Error("agent health check failed");
        },
      }),
    /agent health check failed/,
  );

  assert.equal(fs.existsSync(paths.plist), false);
  fs.rmSync(homeDirectory, { recursive: true });
});

test("does not overwrite a launch-agent file changed during verification", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-health-conflict-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    () =>
      installLaunchAgent({
        homeDirectory,
        userId: 501,
        run,
        async verify() {
          fs.writeFileSync(paths.plist, "newer plist");
          throw new Error("agent health check failed");
        },
      }),
    (error) => {
      assert.match(error.message, /agent health check failed/);
      assert.match(error.message, /changed during rollback/);
      return true;
    },
  );

  assert.equal(fs.readFileSync(paths.plist, "utf8"), "newer plist");
  fs.rmSync(homeDirectory, { recursive: true });
});

test("does not replace a launch-agent file changed before publication", async () => {
  const homeDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-launch-publish-conflict-"),
  );
  const paths = launchAgentPaths(homeDirectory);
  fs.mkdirSync(path.dirname(paths.plist), { recursive: true });
  fs.writeFileSync(paths.plist, "previous plist");
  let changed = false;
  const run = (command, args) => {
    if (args[0] === "print") {
      return { status: 0, stdout: "state = running", stderr: "" };
    }
    if (args[0] === "bootout" && !changed) {
      changed = true;
      fs.writeFileSync(paths.plist, "newer plist");
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    () => installLaunchAgent({ homeDirectory, userId: 501, run }),
    /changed before setup could replace it/,
  );

  assert.equal(fs.readFileSync(paths.plist, "utf8"), "newer plist");
  assert.deepEqual(
    fs.readdirSync(path.dirname(paths.plist)),
    [path.basename(paths.plist)],
  );
  fs.rmSync(homeDirectory, { recursive: true });
});
