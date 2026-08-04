import test from "node:test";
import assert from "node:assert/strict";
import { startBridge } from "../src/server.mjs";
import { waitForBridgeReady } from "../src/setup/service-readiness.mjs";

const authToken = "a".repeat(64);

function response(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

test("accepts the real authenticated bridge health endpoint", async (context) => {
  const bridge = await startBridge({
    host: "127.0.0.1",
    port: 0,
    autoConnectDevice: false,
    runtimeMode: "service",
    authToken,
    logger: { info() {}, error() {} },
  });
  context.after(() => bridge.stop());
  const address = bridge.server.address();

  const health = await waitForBridgeReady({
    authToken,
    expectedVersion: "0.2.0",
    url: `http://127.0.0.1:${address.port}`,
    attempts: 1,
  });

  assert.equal(health.ok, true);
  assert.equal(health.service.mode, "service");
  assert.equal(health.service.version, "0.2.0");
});

test("waits for the authenticated background agent health response", async () => {
  const calls = [];
  const waits = [];
  const health = {
    ok: true,
    service: { mode: "service", version: "0.1.0" },
  };

  const result = await waitForBridgeReady({
    authToken,
    expectedVersion: "0.1.0",
    url: "http://127.0.0.1:47831",
    attempts: 3,
    requestTimeoutMs: 250,
    async request(url, options) {
      calls.push({ url, options });
      return calls.length === 1 ? response(503) : response(200, health);
    },
    async wait(milliseconds) {
      waits.push(milliseconds);
    },
  });

  assert.equal(result, health);
  assert.deepEqual(waits, [100]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://127.0.0.1:47831/health");
  assert.deepEqual(calls[0].options.headers, {
    authorization: `Bearer ${authToken}`,
  });
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
});

test("rejects a stale or malformed health response", async () => {
  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        attempts: 1,
        request: async () =>
          response(200, {
            ok: true,
            service: { mode: "service", version: "0.0.9" },
          }),
      }),
    /unexpected health response/,
  );

  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        attempts: 1,
        request: async () => ({
          status: 200,
          ok: true,
          async json() {
            throw new SyntaxError("private parser detail");
          },
        }),
      }),
    (error) => {
      assert.equal(
        error.message,
        "The background agent returned an unexpected health response.",
      );
      assert.doesNotMatch(error.message, /private parser detail/);
      return true;
    },
  );
});

test("reports an authentication mismatch without exposing a token", async () => {
  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        attempts: 1,
        request: async () => response(401),
      }),
    (error) => {
      assert.equal(
        error.message,
        "The background agent rejected its local authentication token.",
      );
      assert.doesNotMatch(error.message, new RegExp(authToken));
      return true;
    },
  );
});

test("bounds unavailable background-agent retries", async () => {
  let requests = 0;
  let waits = 0;
  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        attempts: 3,
        async request() {
          requests += 1;
          throw new Error("private network detail");
        },
        async wait() {
          waits += 1;
        },
      }),
    (error) => {
      assert.equal(
        error.message,
        "The background agent did not become ready in time.",
      );
      assert.doesNotMatch(error.message, /private network detail/);
      return true;
    },
  );
  assert.equal(requests, 3);
  assert.equal(waits, 2);
});

test("stops readiness retries at the overall deadline", async () => {
  let currentTime = 0;
  let requests = 0;
  let waits = 0;

  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        attempts: 100,
        timeoutMs: 15_000,
        now: () => currentTime,
        async request() {
          requests += 1;
          currentTime = 15_000;
          throw new Error("unavailable");
        },
        async wait() {
          waits += 1;
        },
      }),
    /did not become ready in time/,
  );

  assert.equal(requests, 1);
  assert.equal(waits, 0);
});

test("validates readiness configuration before making a request", async () => {
  let requests = 0;
  const request = async () => {
    requests += 1;
    return response(200);
  };

  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken: "short",
        expectedVersion: "0.1.0",
        request,
      }),
    /authentication token is required/,
  );
  await assert.rejects(
    () => waitForBridgeReady({ authToken, expectedVersion: "", request }),
    /expected Louder Bridge version is required/,
  );
  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        attempts: 0,
        request,
      }),
    /attempts must be a positive integer/,
  );
  await assert.rejects(
    () =>
      waitForBridgeReady({
        authToken,
        expectedVersion: "0.1.0",
        timeoutMs: 0,
        request,
      }),
    /Readiness timeout must be positive/,
  );
  assert.equal(requests, 0);
});
