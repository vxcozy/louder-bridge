import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  assertLocalAddress,
  BRIDGE_HOST,
  BRIDGE_PORT,
} from "./config.mjs";
import { createClaudeNavigator } from "./claude/navigator.mjs";
import { createClaudeSubmit } from "./claude/submit.mjs";
import { createClaudeVoice } from "./claude/voice.mjs";
import { createPushToTalk } from "./device/push-to-talk.mjs";
import { WorkLouderDevice, MockDevice } from "./device/worklouder.mjs";
import { applicationMetadata } from "./runtime/metadata.mjs";
import { SessionStore } from "./state/session-store.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_HTTP_LIMITS = {
  requestTimeoutMs: 5000,
  headersTimeoutMs: 5000,
  keepAliveTimeoutMs: 1000,
  connectionsCheckingIntervalMs: 1000,
  maxConnections: 64,
  maxRequestsPerSocket: 100,
};
function isAuthorized(request, authToken) {
  const prefix = "Bearer ";
  const header = request.headers.authorization;
  if (
    typeof authToken !== "string" ||
    authToken.length < 32 ||
    typeof header !== "string" ||
    !header.startsWith(prefix)
  ) {
    return false;
  }
  const supplied = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(authToken);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJsonError(response, statusCode, error, { allow } = {}) {
  response.statusCode = statusCode;
  if (allow) response.setHeader("allow", allow);
  response.end(JSON.stringify({ ok: false, error }));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new HttpError(413, "Request body exceeds 64 KiB."));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (settled) return;
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function requestMediaType(request) {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string") return null;
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

export async function startBridge({
  host = BRIDGE_HOST,
  port = BRIDGE_PORT,
  mockDevice = false,
  autoConnectDevice = true,
  deviceFactory,
  logger = console,
  navigator = createClaudeNavigator(),
  submit = createClaudeSubmit(),
  voice = createClaudeVoice(),
  openSession,
  runtimeMode = "manual",
  authToken,
  now = () => new Date(),
  httpLimits = {},
} = {}) {
  assertLocalAddress(host, port);
  if (typeof authToken !== "string" || authToken.length < 32) {
    throw new Error("A Louder Bridge authentication token is required.");
  }
  const resolvedHttpLimits = { ...DEFAULT_HTTP_LIMITS, ...httpLimits };
  const store = new SessionStore();
  let device = null;
  let pendingDeviceCleanup = null;
  let deviceRequested = autoConnectDevice;
  let deviceLifecycle = Promise.resolve();
  let lastDeviceError = null;
  let lastDeviceEventAt = null;
  let lastDeviceEvent = null;
  let lastHookAt = null;
  let agentQueue = Promise.resolve();
  let voiceQueue = Promise.resolve();
  let submitQueue = Promise.resolve();
  let stopPromise = null;
  const metadata = applicationMetadata();
  if (openSession) {
    navigator = {
      metadata: () => ({ id: "test-navigator", support: "test" }),
      open: openSession,
    };
  }
  let runtimeStatus = {
    mode: runtimeMode,
    claudeDesktop: runtimeMode === "service" ? "closed" : "unknown",
    codexDesktop: "unknown",
    inputMonitoring: "unknown",
    accessibility: "unknown",
  };
  function slotStates() {
    return store.snapshot().map(({ slot, state, selected }) => ({
      slot,
      state,
      selected,
    }));
  }
  async function renderDevice(slots, context) {
    try {
      await device?.render(slots);
      return true;
    } catch (error) {
      lastDeviceError = error?.message ?? String(error);
      logger.error(
        `Codex Micro lighting update failed${context ? ` (${context})` : ""}: ${lastDeviceError}`,
      );
      return false;
    }
  }

  const openAgentSlot = async (slot) => {
    const session = store.sessionAt(slot);
    if (!session) {
      logger.info(`Agent Key ${slot + 1} has no assigned Claude session.`);
      return;
    }
    await Promise.resolve(navigator.open(session.id));
    const selected = store.select(slot);
    if (selected?.id === session.id) {
      await renderDevice(slotStates(), "Agent Key");
    }
    logger.info(`Opened Claude session in slot ${slot + 1}.`);
  };
  const onAgentKey = (slot) => {
    agentQueue = agentQueue
      .catch(() => {})
      .then(() => openAgentSlot(slot));
    return agentQueue;
  };

  const runVoiceAction = (operation) => {
    voiceQueue = voiceQueue
      .catch(() => {})
      .then(async () => {
        await voice[operation]();
        logger.info(
          operation === "start"
            ? "Claude voice input started."
            : "Claude voice input stopped.",
        );
      });
    return voiceQueue;
  };
  const pushToTalk = createPushToTalk({
    onAction: runVoiceAction,
    onError(error) {
      logger.error(
        `Voice input action failed: ${error?.message ?? String(error)}`,
      );
    },
  });
  const onVoiceButton = (action) => pushToTalk.handle(action);
  const onSubmitButton = () => {
    submitQueue = submitQueue
      .catch(() => {})
      .then(async () => {
        await submit.submit();
        logger.info("Sent Return to Claude.");
      });
    return submitQueue;
  };

  const createDevice =
    deviceFactory ??
    ((options) =>
      mockDevice
        ? new MockDevice(options)
        : new WorkLouderDevice(options));

  function runDeviceLifecycle(operation) {
    const next = deviceLifecycle.catch(() => {}).then(operation);
    deviceLifecycle = next;
    return next;
  }

  function rememberDeviceEvent(status) {
    if (typeof status?.lastEventAt !== "string" || !status.lastEventAt) return;
    lastDeviceEventAt = status.lastEventAt;
    const event = status.lastEvent;
    lastDeviceEvent =
      event &&
      typeof event.type === "string" &&
      typeof event.action === "string"
        ? {
            type: event.type,
            action: event.action,
            at:
              typeof event.at === "string"
                ? event.at
                : status.lastEventAt,
          }
        : null;
  }

  function rememberDeviceEventFrom(target) {
    try {
      rememberDeviceEvent(target?.status?.());
    } catch {
      // Device status failures remain isolated from cleanup.
    }
  }

  function retainedDeviceEvent() {
    return lastDeviceEventAt
      ? { lastEventAt: lastDeviceEventAt, lastEvent: lastDeviceEvent }
      : {};
  }

  function diagnosticDeviceStatus(status) {
    const { lastEventAt: _lastEventAt, lastEvent: _lastEvent, ...safeStatus } =
      status;
    rememberDeviceEvent(status);
    return { ...safeStatus, ...retainedDeviceEvent() };
  }

  async function retryPendingDeviceCleanup() {
    if (!pendingDeviceCleanup) return;
    const cleanupTarget = pendingDeviceCleanup;
    try {
      await cleanupTarget.stop();
      rememberDeviceEventFrom(cleanupTarget);
      if (pendingDeviceCleanup === cleanupTarget) {
        pendingDeviceCleanup = null;
      }
    } catch (error) {
      rememberDeviceEventFrom(cleanupTarget);
      lastDeviceError = error?.message ?? String(error);
      throw error;
    }
  }

  async function connectDeviceNow() {
    deviceRequested = true;
    await retryPendingDeviceCleanup();
    if (device) return device;
    const nextDevice = createDevice({
      logger,
      onAgentKey,
      onVoiceButton,
      onSubmitButton,
      onDeviceDisconnect: () => pushToTalk.reset(),
    });
    device = nextDevice;
    try {
      await nextDevice.start();
      await nextDevice.render(slotStates());
      lastDeviceError = null;
      return nextDevice;
    } catch (error) {
      rememberDeviceEventFrom(nextDevice);
      device = null;
      lastDeviceError = error?.message ?? String(error);
      try {
        await nextDevice.stop();
      } catch (cleanupError) {
        pendingDeviceCleanup = nextDevice;
        lastDeviceError = [error, cleanupError]
          .map((failure) => failure?.message ?? String(failure))
          .join("; ");
        throw new AggregateError(
          [error, cleanupError],
          "Louder Bridge could not open the Codex Micro, and cleanup also failed.",
        );
      }
      throw error;
    }
  }

  function connectDevice() {
    return runDeviceLifecycle(connectDeviceNow);
  }

  async function disconnectDeviceNow() {
    deviceRequested = false;
    const currentDevice = device;
    rememberDeviceEventFrom(currentDevice);
    device = null;
    const failures = [];
    if (currentDevice) pendingDeviceCleanup = currentDevice;
    if (pendingDeviceCleanup) {
      try {
        await retryPendingDeviceCleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await pushToTalk.reset();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) {
      lastDeviceError = failures
        .map((error) => error?.message ?? String(error))
        .join("; ");
      throw new AggregateError(
        failures,
        "Louder Bridge could not release the Codex Micro cleanly.",
      );
    }
    lastDeviceError = null;
  }

  function disconnectDevice() {
    return runDeviceLifecycle(disconnectDeviceNow);
  }

  function currentDeviceStatus() {
    if (pendingDeviceCleanup) {
      return {
        state: "error",
        error: lastDeviceError,
        ...retainedDeviceEvent(),
      };
    }
    const status = device?.status?.();
    if (status) {
      return diagnosticDeviceStatus(status);
    }
    return {
      state: deviceRequested
        ? (lastDeviceError ? "error" : "starting")
        : "inactive",
      error: lastDeviceError,
      ...retainedDeviceEvent(),
    };
  }

  function health() {
    return {
      ok: true,
      service: {
        ...runtimeStatus,
        version: metadata.version,
        buildRevision: metadata.buildRevision,
        nodeVersion: process.version,
        navigator: navigator.metadata(),
        voice: voice.status(),
        lastHookAt,
        device: currentDeviceStatus(),
      },
      slots: slotStates(),
    };
  }

  if (autoConnectDevice) await connectDevice();

  const server = http.createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    if (!isAuthorized(request, authToken)) {
      response.setHeader("www-authenticate", "Bearer");
      sendJsonError(response, 401, "Authentication required.");
      return;
    }
    if (request.url === "/health") {
      if (request.method !== "GET") {
        sendJsonError(response, 405, "Method not allowed.", { allow: "GET" });
        return;
      }
      try {
        response.end(JSON.stringify(health()));
      } catch (error) {
        logger.error("Health request failed.", error);
        sendJsonError(response, 500, "Health request failed.");
      }
      return;
    }
    if (request.url !== "/hook") {
      sendJsonError(response, 404, "Route not found.");
      return;
    }
    if (request.method !== "POST") {
      sendJsonError(response, 405, "Method not allowed.", { allow: "POST" });
      return;
    }
    if (requestMediaType(request) !== "application/json") {
      sendJsonError(
        response,
        415,
        "Content-Type must be application/json.",
      );
      return;
    }
    try {
      const event = await readJson(request);
      lastHookAt = now().toISOString();
      const changed = store.apply(event);
      if (changed) {
        await renderDevice(slotStates(), "Claude hook");
        logger.info(`Slot ${changed.slot + 1}: ${changed.state}`);
      }
      response.end(JSON.stringify({ ok: true }));
    } catch (error) {
      const expected = error instanceof HttpError;
      if (!expected) logger.error("Hook request failed.", error);
      sendJsonError(
        response,
        expected ? error.statusCode : 500,
        expected ? error.message : "Hook request failed.",
      );
    }
  });
  server.requestTimeout = resolvedHttpLimits.requestTimeoutMs;
  server.headersTimeout = resolvedHttpLimits.headersTimeoutMs;
  server.keepAliveTimeout = resolvedHttpLimits.keepAliveTimeoutMs;
  server.connectionsCheckingInterval =
    resolvedHttpLimits.connectionsCheckingIntervalMs;
  server.maxConnections = resolvedHttpLimits.maxConnections;
  server.maxRequestsPerSocket = resolvedHttpLimits.maxRequestsPerSocket;
  server.maxHeadersCount = 32;

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error?.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${port} is already in use on ${host}. Stop the other Louder Bridge process or choose another port with LOUDER_BRIDGE_PORT.`,
            ),
          );
          return;
        }
        reject(error);
      };
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        resolve();
      });
    });
  } catch (error) {
    if (!device) throw error;
    try {
      await disconnectDevice();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error.message} The Codex Micro could not be released cleanly.`,
      );
    }
    throw error;
  }
  logger.info(`Louder Bridge is listening at http://${host}:${port}`);

  return {
    store,
    server,
    connectDevice,
    disconnectDevice,
    deviceStatus: currentDeviceStatus,
    health,
    setRuntimeStatus(nextStatus) {
      runtimeStatus = { ...runtimeStatus, ...nextStatus };
    },
    get device() {
      return device;
    },
    stop() {
      stopPromise ??= (async () => {
        const failures = [];
        const closeServer = new Promise((resolve) => {
          server.close((error) => {
            if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
              failures.push(error);
            }
            resolve();
          });
        });
        try {
          await disconnectDevice();
        } catch (error) {
          failures.push(error);
        }
        await agentQueue.catch(() => {});
        await voiceQueue.catch(() => {});
        await submitQueue.catch(() => {});
        await closeServer;
        if (failures.length) {
          throw new AggregateError(
            failures,
            "Louder Bridge did not shut down cleanly.",
          );
        }
      })();
      return stopPromise;
    },
  };
}
