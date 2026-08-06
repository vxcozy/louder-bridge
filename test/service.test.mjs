import test from "node:test";
import assert from "node:assert/strict";
import {
  isClaudeDesktopRunning,
  isCodexDesktopRunning,
  isGhosttyRunning,
  isHermesDesktopRunning,
  terminalAgentsFromProcessList,
  terminalAgentsRunning,
  startDesktopService as startDesktopServiceImplementation,
} from "../src/service.mjs";

function startDesktopService(options) {
  return startDesktopServiceImplementation({
    checkHermes: async () => false,
    checkGhostty: async () => false,
    checkTerminalAgents: async () => [],
    ...options,
  });
}

test("detects whether Claude Desktop is running", async () => {
  const calls = [];
  assert.equal(
    await isClaudeDesktopRunning(async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "123\n" };
    }),
    true,
  );
  assert.equal(
    await isClaudeDesktopRunning(async () => {
      const error = new Error("not found");
      error.code = 1;
      throw error;
    }),
    false,
  );
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/pgrep",
      args: ["-x", "Claude"],
      options: { timeout: 2000, maxBuffer: 1024, windowsHide: true },
    },
  ]);
});

test("detects the ChatGPT and Codex desktop process names", async () => {
  const calls = [];
  const running = await isCodexDesktopRunning(async (command, args) => {
    calls.push([command, ...args]);
    if (args[1] === "ChatGPT") {
      const error = new Error("not found");
      error.code = 1;
      throw error;
    }
    return { stdout: "123\n" };
  });

  assert.equal(running, true);
  assert.deepEqual(calls, [
    ["/usr/bin/pgrep", "-x", "ChatGPT"],
    ["/usr/bin/pgrep", "-x", "Codex"],
  ]);
});

test("detects whether Hermes Desktop is running", async () => {
  const calls = [];
  assert.equal(
    await isHermesDesktopRunning(async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "123\n" };
    }),
    true,
  );
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/pgrep",
      args: ["-x", "Hermes"],
      options: { timeout: 2000, maxBuffer: 1024, windowsHide: true },
    },
  ]);
});

test("detects Ghostty and TTY-backed terminal agents", async () => {
  assert.equal(
    await isGhosttyRunning(async () => ({ stdout: "123\n" })),
    true,
  );
  assert.deepEqual(
    terminalAgentsFromProcessList(`
ttys000  /opt/homebrew/bin/claude
ttys001  /usr/local/bin/hermes
??       /Applications/Codex.app/Contents/MacOS/Codex
ttys002  /opt/homebrew/bin/codex
ttys003  /bin/zsh
`),
    ["claude", "hermes", "codex"],
  );
  const calls = [];
  assert.deepEqual(
    await terminalAgentsRunning(async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "ttys000 /opt/homebrew/bin/claude\n" };
    }),
    ["claude"],
  );
  assert.deepEqual(calls, [{
    command: "/bin/ps",
    args: ["-axo", "tty=,comm="],
    options: {
      timeout: 2000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  }]);
});

test("gives Ghostty ownership only while a terminal agent is running", async () => {
  let agents = [];
  const calls = [];
  const service = await startDesktopService({
    checkClaude: async () => false,
    checkHermes: async () => false,
    checkCodex: async () => false,
    checkGhostty: async () => true,
    checkTerminalAgents: async () => agents,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async setSurface(surface) {
        calls.push(["surface", surface]);
      },
      async connectDevice() {
        calls.push(["connect"]);
      },
      async disconnectDevice() {
        calls.push(["disconnect"]);
      },
      async stop() {},
      setRuntimeStatus() {},
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, []);
  agents = ["codex"];
  await service.sync();
  assert.deepEqual(calls, [["surface", "ghostty"], ["connect"]]);
  agents = [];
  await service.sync();
  assert.deepEqual(calls, [
    ["surface", "ghostty"],
    ["connect"],
    ["disconnect"],
    ["surface", null],
  ]);
  await service.stop();
});

test("gives Hermes Desktop ownership of the Micro", async () => {
  const calls = [];
  const service = await startDesktopService({
    checkClaude: async () => false,
    checkHermes: async () => true,
    checkCodex: async () => false,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async setSurface(surface) {
        calls.push(["surface", surface]);
      },
      async connectDevice() {
        calls.push(["connect"]);
      },
      async disconnectDevice() {
        calls.push(["disconnect"]);
      },
      async stop() {},
      setRuntimeStatus() {},
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, [["surface", "hermes"], ["connect"]]);
  await service.stop();
});

test("releases the Micro while Claude and Hermes are both open", async () => {
  let hermesIsRunning = false;
  const calls = [];
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkHermes: async () => hermesIsRunning,
    checkCodex: async () => false,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async setSurface(surface) {
        calls.push(["surface", surface]);
      },
      async connectDevice() {
        calls.push(["connect"]);
      },
      async disconnectDevice() {
        calls.push(["disconnect"]);
      },
      async stop() {},
      setRuntimeStatus() {},
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, [["surface", "claude"], ["connect"]]);
  hermesIsRunning = true;
  await service.sync();
  assert.deepEqual(calls, [
    ["surface", "claude"],
    ["connect"],
    ["disconnect"],
    ["surface", null],
  ]);
  await service.stop();
});

test("reports Micro input contention once for each app overlap", async () => {
  let codexIsRunning = true;
  const messages = [];
  const deviceCalls = [];
  let notices = 0;
  const statuses = [];
  const bridge = {
    async connectDevice() {
      deviceCalls.push("connect");
    },
    async disconnectDevice() {
      deviceCalls.push("disconnect");
    },
    async stop() {},
    deviceStatus() {
      return { state: "connected" };
    },
    setRuntimeStatus(status) {
      statuses.push(status);
    },
  };
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkCodex: async () => codexIsRunning,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    notifyContention({ onError }) {
      assert.equal(typeof onError, "function");
      notices += 1;
    },
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: {
      info(message) {
        messages.push(message);
      },
      error() {},
    },
  });

  await service.sync();
  codexIsRunning = false;
  await service.sync();
  codexIsRunning = true;
  await service.sync();

  assert.equal(
    messages.filter((message) => message.includes("give the Micro to Claude"))
      .length,
    2,
  );
  assert.equal(notices, 2);
  assert.deepEqual(deviceCalls, ["connect", "disconnect"]);
  assert.deepEqual(statuses.at(-1), {
    claudeDesktop: "open",
    codexDesktop: "open",
    hermesDesktop: "closed",
    ghostty: "closed",
    terminalAgent: "closed",
  });
  await service.stop();
});

test("does not open the Micro while Codex already owns its input", async () => {
  let codexIsRunning = true;
  const calls = [];
  const bridge = {
    async connectDevice() {
      calls.push("connect");
    },
    async disconnectDevice() {
      calls.push("disconnect");
    },
    async stop() {},
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkCodex: async () => codexIsRunning,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    notifyContention() {
      calls.push("notice");
    },
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, ["notice"]);
  await service.sync();
  assert.deepEqual(calls, ["notice"]);

  codexIsRunning = false;
  await service.sync();
  assert.deepEqual(calls, ["notice", "connect"]);

  codexIsRunning = true;
  await service.sync();
  assert.deepEqual(calls, ["notice", "connect", "disconnect", "notice"]);
  await service.stop();
});

test("logs when the Codex conflict notice cannot be shown", async () => {
  const errors = [];
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkCodex: async () => true,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    notifyContention: () => false,
    createBridge: async () => ({
      async connectDevice() {},
      async disconnectDevice() {},
      async stop() {},
      setRuntimeStatus() {},
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: {
      info() {},
      error(error) {
        errors.push(error);
      },
    },
  });

  assert.deepEqual(errors, ["Could not show the Codex conflict notice."]);
  await service.stop();
});

test("releases the Micro when desktop ownership cannot be checked", async () => {
  let processCheckFails = false;
  const calls = [];
  const errors = [];
  const statuses = [];
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkCodex: async () => {
      if (processCheckFails) throw new Error("process check failed");
      return false;
    },
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async connectDevice() {
        calls.push("connect");
      },
      async disconnectDevice() {
        calls.push("disconnect");
      },
      async stop() {},
      setRuntimeStatus(status) {
        statuses.push(status);
      },
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: {
      info() {},
      error(error) {
        errors.push(error.message);
      },
    },
  });

  assert.deepEqual(calls, ["connect"]);
  processCheckFails = true;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect"]);
  assert.deepEqual(statuses.at(-1), {
    claudeDesktop: "open",
    codexDesktop: "unknown",
    hermesDesktop: "closed",
    ghostty: "closed",
    terminalAgent: "closed",
  });
  assert.deepEqual(errors, ["process check failed"]);

  processCheckFails = false;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect", "connect"]);
  await service.stop();
});

test("reports both desktop ownership check failures", async () => {
  let processChecksFail = false;
  const calls = [];
  const errors = [];
  const statuses = [];
  const service = await startDesktopService({
    checkClaude: async () => {
      if (processChecksFail) throw new Error("Claude check failed");
      return true;
    },
    checkCodex: async () => {
      if (processChecksFail) throw new Error("Codex check failed");
      return false;
    },
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async connectDevice() {
        calls.push("connect");
      },
      async disconnectDevice() {
        calls.push("disconnect");
      },
      async stop() {},
      setRuntimeStatus(status) {
        statuses.push(status);
      },
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: {
      info() {},
      error(error) {
        errors.push(error);
      },
    },
  });

  processChecksFail = true;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect"]);
  assert.deepEqual(statuses.at(-1), {
    claudeDesktop: "unknown",
    codexDesktop: "unknown",
    hermesDesktop: "closed",
    ghostty: "closed",
    terminalAgent: "closed",
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0] instanceof AggregateError, true);
  assert.equal(
    errors[0].message,
    "Louder Bridge could not check whether a supported app or Codex is open.",
  );
  assert.deepEqual(
    errors[0].errors.map((error) => error.message),
    ["Claude check failed", "Codex check failed"],
  );

  processChecksFail = false;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect", "connect"]);
  await service.stop();
});

test("keeps both ownership and device cleanup failures", async () => {
  let processCheckFails = false;
  const errors = [];
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkCodex: async () => {
      if (processCheckFails) throw new Error("process check failed");
      return false;
    },
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async connectDevice() {},
      async disconnectDevice() {
        throw new Error("device cleanup failed");
      },
      async stop() {},
      setRuntimeStatus() {},
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: {
      info() {},
      error(error) {
        errors.push(error);
      },
    },
  });

  processCheckFails = true;
  await service.sync();
  assert.equal(errors.length, 1);
  assert.equal(errors[0] instanceof AggregateError, true);
  assert.equal(
    errors[0].message,
    "Louder Bridge could not check the open desktop apps or release the Codex Micro cleanly.",
  );
  assert.deepEqual(
    errors[0].errors.map((error) => error.message),
    ["process check failed", "device cleanup failed"],
  );
  await service.stop();
});

test("retries a failed Codex handoff before reconnecting", async () => {
  let codexIsRunning = false;
  let cleanupFails = true;
  const calls = [];
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkCodex: async () => codexIsRunning,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => ({
      async connectDevice() {
        calls.push("connect");
      },
      async disconnectDevice() {
        calls.push("disconnect");
        if (cleanupFails) throw new Error("device cleanup failed");
      },
      async stop() {},
      setRuntimeStatus() {},
    }),
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  codexIsRunning = true;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect"]);

  cleanupFails = false;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect", "disconnect"]);

  codexIsRunning = false;
  await service.sync();
  assert.deepEqual(calls, [
    "connect",
    "disconnect",
    "disconnect",
    "connect",
  ]);
  await service.stop();
});

test("connects the device only while Claude Desktop is open", async () => {
  let claudeIsRunning = false;
  const calls = [];
  const bridge = {
    async connectDevice() {
      calls.push("connect");
    },
    async disconnectDevice() {
      calls.push("disconnect");
    },
    async stop() {
      calls.push("stop");
    },
  };
  const service = await startDesktopService({
    checkClaude: async () => claudeIsRunning,
    createBridge: async (options) => {
      assert.equal(options.autoConnectDevice, false);
      assert.equal(options.authToken, "test-auth-token");
      return bridge;
    },
    authToken: "test-auth-token",
    checkCodex: async () => false,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, []);
  claudeIsRunning = true;
  await service.sync();
  await service.sync();
  assert.deepEqual(calls, ["connect"]);

  claudeIsRunning = false;
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect"]);

  await service.stop();
  assert.deepEqual(calls, ["connect", "disconnect", "stop"]);
});

test("retries a failed device startup while Claude remains open", async () => {
  let attempts = 0;
  const errors = [];
  const bridge = {
    async connectDevice() {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary HID failure");
    },
    async disconnectDevice() {},
    async stop() {},
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => true,
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    checkCodex: async () => false,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    pollInterval: 60_000,
    logger: {
      info() {},
      error(error) {
        errors.push(error.message);
      },
    },
  });

  assert.equal(attempts, 1);
  assert.deepEqual(errors, ["temporary HID failure"]);
  await service.sync();
  assert.equal(attempts, 2);
  await service.stop();
});

test("requests an agent restart when Input Monitoring becomes available", async () => {
  let permission = "denied";
  let restarts = 0;
  const bridge = {
    async connectDevice() {},
    async disconnectDevice() {},
    async stop() {},
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => false,
    checkInputMonitoring: () => permission,
    checkAccessibility: () => "granted",
    onPermissionGranted: () => {
      restarts += 1;
    },
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    checkCodex: async () => false,
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  permission = "granted";
  await service.sync();
  assert.equal(restarts, 1);
  await service.stop();
});

test("does not request the device before Input Monitoring is granted", async () => {
  let permission = "denied";
  const calls = [];
  const bridge = {
    async connectDevice() {
      calls.push("connect");
    },
    async disconnectDevice() {
      calls.push("disconnect");
    },
    async stop() {
      calls.push("stop");
    },
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkInputMonitoring: () => permission,
    checkAccessibility: () => "granted",
    onPermissionGranted() {},
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    checkCodex: async () => false,
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, []);
  permission = "granted";
  await service.sync();
  assert.deepEqual(calls, []);
  await service.stop();
  assert.deepEqual(calls, ["stop"]);
});

test("releases the device when Input Monitoring is revoked", async () => {
  let permission = "granted";
  const calls = [];
  const bridge = {
    async connectDevice() {
      calls.push("connect");
    },
    async disconnectDevice() {
      calls.push("disconnect");
    },
    async stop() {
      calls.push("stop");
    },
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkInputMonitoring: () => permission,
    checkAccessibility: () => "granted",
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    checkCodex: async () => false,
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, ["connect"]);
  permission = "denied";
  await service.sync();
  assert.deepEqual(calls, ["connect", "disconnect"]);
  await service.stop();
});

test("requires Accessibility before connecting the device", async () => {
  let accessibility = "denied";
  let restarts = 0;
  const calls = [];
  const bridge = {
    async connectDevice() {
      calls.push("connect");
    },
    async disconnectDevice() {
      calls.push("disconnect");
    },
    async stop() {
      calls.push("stop");
    },
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => true,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => accessibility,
    onPermissionGranted() {
      restarts += 1;
    },
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    checkCodex: async () => false,
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  assert.deepEqual(calls, []);
  accessibility = "granted";
  await service.sync();
  assert.equal(restarts, 1);
  assert.deepEqual(calls, []);
  await service.stop();
});

test("stops the desktop service only once", async () => {
  let bridgeStopCalls = 0;
  const bridge = {
    async connectDevice() {},
    async disconnectDevice() {},
    async stop() {
      bridgeStopCalls += 1;
    },
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude: async () => false,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    checkCodex: async () => false,
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  const firstStop = service.stop();
  const secondStop = service.stop();
  assert.equal(firstStop, secondStop);
  await firstStop;
  assert.equal(bridgeStopCalls, 1);
});

test("coalesces overlapping service sync requests", async () => {
  let checks = 0;
  let releaseCheck;
  const bridge = {
    async connectDevice() {},
    async disconnectDevice() {},
    async stop() {},
    setRuntimeStatus() {},
  };
  const service = await startDesktopService({
    checkClaude() {
      checks += 1;
      if (checks !== 2) return Promise.resolve(false);
      return new Promise((resolve) => {
        releaseCheck = resolve;
      });
    },
    checkCodex: async () => false,
    checkInputMonitoring: () => "granted",
    checkAccessibility: () => "granted",
    createBridge: async () => bridge,
    authToken: "test-auth-token",
    pollInterval: 60_000,
    logger: { info() {}, error() {} },
  });

  const first = service.sync();
  await new Promise((resolve) => setImmediate(resolve));
  const second = service.sync();
  const third = service.sync();
  assert.equal(first, second);
  assert.equal(second, third);

  releaseCheck(false);
  await first;
  assert.equal(checks, 3);
  await service.stop();
});
