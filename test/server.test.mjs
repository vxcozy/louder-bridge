import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { startBridge } from "../src/server.mjs";

const logger = {
  info() {},
  error() {},
};
const authToken = "test-token-that-is-at-least-thirty-two-characters";

function bridgeUrl(bridge) {
  return `http://127.0.0.1:${bridge.server.address().port}`;
}

test("refuses to listen beyond the local machine", async () => {
  await assert.rejects(
    startBridge({
      host: "0.0.0.0",
      port: 0,
      autoConnectDevice: false,
      authToken,
      logger,
    }),
    /non-loopback/,
  );
});

test("reports a clear error when the local port is occupied", async (context) => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  context.after(
    () => new Promise((resolve) => occupied.close(resolve)),
  );

  await assert.rejects(
    startBridge({
      host: "127.0.0.1",
      port: occupied.address().port,
      autoConnectDevice: false,
      authToken,
      logger,
    }),
    /Port \d+ is already in use.*LOUDER_BRIDGE_PORT/,
  );
});

test("releases the device when the hook server cannot start", async (context) => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  context.after(
    () => new Promise((resolve) => occupied.close(resolve)),
  );
  const calls = [];
  const device = {
    async start() {
      calls.push("start");
    },
    async render() {
      calls.push("render");
    },
    async stop() {
      calls.push("stop");
    },
  };

  await assert.rejects(
    startBridge({
      host: "127.0.0.1",
      port: occupied.address().port,
      deviceFactory: () => device,
      authToken,
      logger,
    }),
    /Port \d+ is already in use/,
  );
  assert.deepEqual(calls, ["start", "render", "stop"]);
});

test("reports service and device health", async (context) => {
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    runtimeMode: "service",
    authToken,
    logger,
  });
  context.after(() => bridge.stop());
  bridge.setRuntimeStatus({ claudeDesktop: "open" });
  assert.deepEqual(bridge.deviceStatus(), {
    state: "inactive",
    error: null,
  });

  assert.equal(bridge.server.requestTimeout, 5000);
  assert.equal(bridge.server.headersTimeout, 5000);
  assert.equal(bridge.server.keepAliveTimeout, 1000);
  assert.equal(bridge.server.connectionsCheckingInterval, 1000);
  assert.equal(bridge.server.maxConnections, 64);
  assert.equal(bridge.server.maxRequestsPerSocket, 100);

  const response = await fetch(`${bridgeUrl(bridge)}/health`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: {
      mode: "service",
      claudeDesktop: "open",
      codexDesktop: "unknown",
      inputMonitoring: "unknown",
      accessibility: "unknown",
      version: "0.1.0",
      nodeVersion: process.version,
      navigator: {
        id: "claude-resume-url",
        support: "experimental",
      },
      voice: {
        id: "claude-accessibility-dictation",
        support: "experimental",
        state: "idle",
        error: null,
        lastActionAt: null,
        method: null,
      },
      lastHookAt: null,
      device: { state: "inactive", error: null },
    },
    slots: Array.from({ length: 6 }, (_, slot) => ({
      slot,
      state: "off",
      selected: false,
    })),
  });
});

test("closes an incomplete request when its deadline expires", async (context) => {
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    authToken,
    logger,
    httpLimits: {
      requestTimeoutMs: 50,
      headersTimeoutMs: 50,
      keepAliveTimeoutMs: 50,
      connectionsCheckingIntervalMs: 10,
      maxConnections: 4,
      maxRequestsPerSocket: 4,
    },
  });
  context.after(() => bridge.stop());

  const socket = net.connect(bridge.server.address().port, "127.0.0.1");
  context.after(() => socket.destroy());
  let received = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    received += chunk;
  });

  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The incomplete request stayed open.")),
      1000,
    );
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", reject);
  });
  socket.write(
    [
      "POST /hook HTTP/1.1",
      `Host: 127.0.0.1:${bridge.server.address().port}`,
      `Authorization: Bearer ${authToken}`,
      "Content-Type: application/json",
      "Content-Length: 100",
      "",
      "{",
    ].join("\r\n"),
  );

  await closed;
  assert.match(received, /^HTTP\/1\.1 408 Request Timeout/m);
});

test("contains health adapter failures without exposing their details", async (context) => {
  const errors = [];
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    authToken,
    logger: {
      info() {},
      error(...values) {
        errors.push(values);
      },
    },
    voice: {
      status() {
        throw new Error("private adapter detail");
      },
    },
  });
  context.after(() => bridge.stop());

  const response = await fetch(`${bridgeUrl(bridge)}/health`, {
    headers: { authorization: `Bearer ${authToken}` },
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Health request failed.",
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "Health request failed.");
});

test("records the last authenticated hook even when state does not change", async (context) => {
  const times = [
    new Date("2026-07-31T06:00:00.000Z"),
    new Date("2026-07-31T06:00:01.000Z"),
  ];
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    authToken,
    logger,
    now: () => times.shift(),
  });
  context.after(() => bridge.stop());
  const headers = {
    authorization: `Bearer ${authToken}`,
    "content-type": "application/json",
  };
  const event = {
    session_id: "00000000-0000-4000-8000-000000000001",
    hook_event_name: "SessionStart",
  };

  await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
  });
  await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
  });

  assert.equal(
    bridge.health().service.lastHookAt,
    "2026-07-31T06:00:01.000Z",
  );
});

test("acknowledges Claude hooks even when device lighting fails", async (context) => {
  let renderCalls = 0;
  const rendered = [];
  const errors = [];
  const messages = [];
  const device = {
    async start() {},
    async render(slots) {
      renderCalls += 1;
      rendered.push(slots);
      if (renderCalls > 1) throw new Error("USB write failed");
    },
    status() {
      return { state: "connected", error: null };
    },
    async stop() {},
  };
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    deviceFactory: () => device,
    authToken,
    logger: {
      info(message) {
        messages.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  });
  context.after(() => bridge.stop());

  const response = await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      session_id: "00000000-0000-4000-8000-000000000001",
      cwd: "/tmp/project",
      prompt: "private-prompt-sentinel",
      hook_event_name: "SessionStart",
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(errors[0], /USB write failed/);
  assert.equal(messages.includes("Slot 1: idle"), true);
  assert.equal(messages.some((message) => message.includes("project")), false);
  const logOutput = [...messages, ...errors].join("\n");
  assert.equal(
    logOutput.includes("00000000-0000-4000-8000-000000000001"),
    false,
  );
  assert.equal(logOutput.includes("private-prompt-sentinel"), false);
  assert.equal("id" in rendered.at(-1)[0], false);
  assert.equal("cwd" in rendered.at(-1)[0], false);

  const healthResponse = await fetch(`${bridgeUrl(bridge)}/health`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
  const health = await healthResponse.json();
  assert.match(health.service.lastHookAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(health.slots[0], {
    slot: 0,
    state: "idle",
    selected: false,
  });
  assert.equal("id" in health.slots[0], false);
  assert.equal("cwd" in health.slots[0], false);
});

test("rejects requests without the private bearer token", async (context) => {
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    authToken,
    logger,
  });
  context.after(() => bridge.stop());

  const response = await fetch(`${bridgeUrl(bridge)}/health`);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), "Bearer");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Authentication required.",
  });

  const invalid = await fetch(`${bridgeUrl(bridge)}/health`, {
    headers: { authorization: "Bearer wrong-token" },
  });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), {
    ok: false,
    error: "Authentication required.",
  });
});

test("distinguishes unknown routes from unsupported methods", async (context) => {
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    authToken,
    logger,
  });
  context.after(() => bridge.stop());
  const headers = { authorization: `Bearer ${authToken}` };

  const missing = await fetch(`${bridgeUrl(bridge)}/missing`, { headers });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    ok: false,
    error: "Route not found.",
  });

  const healthMethod = await fetch(`${bridgeUrl(bridge)}/health`, {
    method: "POST",
    headers,
  });
  assert.equal(healthMethod.status, 405);
  assert.equal(healthMethod.headers.get("allow"), "GET");
  assert.deepEqual(await healthMethod.json(), {
    ok: false,
    error: "Method not allowed.",
  });

  const hookMethod = await fetch(`${bridgeUrl(bridge)}/hook`, { headers });
  assert.equal(hookMethod.status, 405);
  assert.equal(hookMethod.headers.get("allow"), "POST");
  assert.deepEqual(await hookMethod.json(), {
    ok: false,
    error: "Method not allowed.",
  });
});

test("rejects oversized and non-JSON hook requests", async (context) => {
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    authToken,
    logger,
  });
  context.after(() => bridge.stop());
  const headers = { authorization: `Bearer ${authToken}` };

  const unsupported = await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers: { ...headers, "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(await unsupported.json(), {
    ok: false,
    error: "Content-Type must be application/json.",
  });

  const misleading = await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/jsonp" },
    body: "{}",
  });
  assert.equal(misleading.status, 415);
  assert.deepEqual(await misleading.json(), {
    ok: false,
    error: "Content-Type must be application/json.",
  });

  const invalid = await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: '{"prompt":"private text",}',
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    ok: false,
    error: "Request body must be valid JSON.",
  });

  const oversized = await fetch(`${bridgeUrl(bridge)}/hook`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(70 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), {
    ok: false,
    error: "Request body exceeds 64 KiB.",
  });
});

test("records empty Agent Key presses without exposing session data", async (context) => {
  const messages = [];
  let press;
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    authToken,
    logger: {
      info(message) {
        messages.push(message);
      },
      error() {},
    },
    deviceFactory({ onAgentKey }) {
      press = onAgentKey;
      return {
        async start() {},
        async render() {},
        status() {
          return { state: "connected", error: null };
        },
        async stop() {},
      };
    },
  });
  context.after(() => bridge.stop());

  await press(2);
  assert.equal(
    messages.includes("Agent Key 3 has no assigned Claude session."),
    true,
  );
});

test("serializes Micro voice press and release into Claude dictation", async (context) => {
  const actions = [];
  let voiceButton;
  const voice = {
    metadata() {
      return {
        id: "test-voice",
        support: "test",
      };
    },
    status() {
      return {
        ...this.metadata(),
        state: actions.at(-1) === "start" ? "recording" : "idle",
        error: null,
        lastActionAt: null,
      };
    },
    async start() {
      actions.push("start");
    },
    async stop() {
      actions.push("stop");
    },
  };
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    authToken,
    logger,
    voice,
    deviceFactory({ onVoiceButton }) {
      voiceButton = onVoiceButton;
      return {
        async start() {},
        async render() {},
        status() {
          return { state: "connected", error: null };
        },
        async stop() {},
      };
    },
  });
  context.after(() => bridge.stop());

  const press = voiceButton("press");
  await new Promise((resolve) => setTimeout(resolve, 375));
  const release = voiceButton("release");
  await Promise.all([press, release]);
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(bridge.health().service.voice.state, "idle");
});

test("routes the Micro send key to Claude", async (context) => {
  const actions = [];
  let submitButton;
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    authToken,
    logger,
    submit: {
      async submit() {
        actions.push("submit");
      },
    },
    deviceFactory({ onSubmitButton }) {
      submitButton = onSubmitButton;
      return {
        async start() {},
        async render() {},
        status() {
          return { state: "connected", error: null };
        },
        async stop() {},
      };
    },
  });
  context.after(() => bridge.stop());

  await submitButton();
  assert.deepEqual(actions, ["submit"]);
});

test("stops latched Claude dictation when the Micro disconnects", async (context) => {
  const actions = [];
  let voiceButton;
  let deviceDisconnected;
  const voice = {
    metadata() {
      return { id: "test-voice", support: "test" };
    },
    status() {
      return {
        ...this.metadata(),
        state: actions.at(-1) === "start" ? "recording" : "idle",
        error: null,
        lastActionAt: null,
      };
    },
    async start() {
      actions.push("start");
    },
    async stop() {
      actions.push("stop");
    },
  };
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    authToken,
    logger,
    voice,
    deviceFactory({ onVoiceButton, onDeviceDisconnect }) {
      voiceButton = onVoiceButton;
      deviceDisconnected = onDeviceDisconnect;
      return {
        async start() {},
        async render() {},
        status() {
          return { state: "connected", error: null };
        },
        async stop() {},
      };
    },
  });
  context.after(() => bridge.stop());

  await voiceButton("press");
  await voiceButton("release");
  await voiceButton("press");
  await voiceButton("release");
  assert.deepEqual(actions, ["start"]);

  await deviceDisconnected();
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(bridge.health().service.voice.state, "idle");
});

test("closes the server and releases voice when device cleanup fails", async () => {
  const actions = [];
  let voiceButton;
  let deviceStopCalls = 0;
  const voice = {
    metadata() {
      return { id: "test-voice", support: "test" };
    },
    status() {
      return {
        ...this.metadata(),
        state: actions.at(-1) === "start" ? "recording" : "idle",
        error: null,
        lastActionAt: null,
      };
    },
    async start() {
      actions.push("start");
    },
    async stop() {
      actions.push("stop");
    },
  };
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    authToken,
    logger,
    voice,
    deviceFactory({ onVoiceButton }) {
      voiceButton = onVoiceButton;
      return {
        async start() {},
        async render() {},
        status() {
          return { state: "connected", error: null };
        },
        async stop() {
          deviceStopCalls += 1;
          throw new Error("device cleanup failed");
        },
      };
    },
  });

  await voiceButton("press");
  await voiceButton("release");
  await voiceButton("press");
  await voiceButton("release");
  assert.deepEqual(actions, ["start"]);

  const firstStop = bridge.stop();
  const secondStop = bridge.stop();
  assert.equal(firstStop, secondStop);
  await assert.rejects(firstStop, /did not shut down cleanly/);
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(deviceStopCalls, 1);
  assert.equal(bridge.server.listening, false);
});
