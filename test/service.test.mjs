import test from "node:test";
import assert from "node:assert/strict";
import {
  isClaudeDesktopRunning,
  startDesktopService,
} from "../src/service.mjs";

test("detects whether Claude Desktop is running", async () => {
  assert.equal(
    await isClaudeDesktopRunning(async () => ({ stdout: "123\n" })),
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
