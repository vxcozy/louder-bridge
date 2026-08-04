import { BRIDGE_URL } from "../config.mjs";

const DEFAULT_ATTEMPTS = 150;
const DEFAULT_DELAY_MS = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 500;
const DEFAULT_READINESS_TIMEOUT_MS = 15_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readinessError(lastResult) {
  if (lastResult?.type === "authentication") {
    return new Error(
      "The background agent rejected its local authentication token.",
    );
  }
  if (lastResult?.type === "http") {
    return new Error(
      `The background agent health check returned HTTP ${lastResult.status}.`,
    );
  }
  if (lastResult?.type === "response") {
    return new Error(
      "The background agent returned an unexpected health response.",
    );
  }
  return new Error("The background agent did not become ready in time.");
}

export async function waitForBridgeReady({
  authToken,
  expectedVersion,
  url = BRIDGE_URL,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  timeoutMs = DEFAULT_READINESS_TIMEOUT_MS,
  request = fetch,
  wait = delay,
  now = Date.now,
} = {}) {
  if (typeof authToken !== "string" || authToken.length < 32) {
    throw new TypeError("A Louder Bridge authentication token is required.");
  }
  if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
    throw new TypeError("The expected Louder Bridge version is required.");
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError("Readiness attempts must be a positive integer.");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError("Readiness delay must be nonnegative.");
  }
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new TypeError("Readiness request timeout must be positive.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Readiness timeout must be positive.");
  }
  if (typeof now !== "function") {
    throw new TypeError("A readiness clock is required.");
  }

  let lastResult = null;
  const deadline = now() + timeoutMs;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remainingBeforeRequest = deadline - now();
    if (remainingBeforeRequest <= 0) break;
    try {
      const response = await request(`${url}/health`, {
        headers: { authorization: `Bearer ${authToken}` },
        signal: AbortSignal.timeout(
          Math.max(
            1,
            Math.ceil(Math.min(requestTimeoutMs, remainingBeforeRequest)),
          ),
        ),
      });
      if (response.status === 401) {
        lastResult = { type: "authentication" };
      } else if (!response.ok) {
        lastResult = { type: "http", status: response.status };
      } else {
        try {
          const health = await response.json();
          if (
            health?.ok === true &&
            health.service?.mode === "service" &&
            health.service?.version === expectedVersion
          ) {
            return health;
          }
        } catch {
          // The response is handled as invalid below.
        }
        lastResult = { type: "response" };
      }
    } catch {
      lastResult = { type: "unavailable" };
    }
    if (attempt + 1 < attempts) {
      const remainingBeforeWait = deadline - now();
      if (remainingBeforeWait <= 0) break;
      await wait(Math.min(delayMs, remainingBeforeWait));
    }
  }
  throw readinessError(lastResult);
}
