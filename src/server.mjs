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
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
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
} = {}) {
  assertLocalAddress(host, port);
  if (typeof authToken !== "string" || authToken.length < 32) {
    throw new Error("A Louder Bridge authentication token is required.");
  }
  const store = new SessionStore();
  let device = null;
  let deviceRequested = autoConnectDevice;
  let lastDeviceError = null;
  let lastHookAt = null;
  let voiceQueue = Promise.resolve();
  let submitQueue = Promise.resolve();
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

  const onAgentKey = async (slot) => {
    const session = store.select(slot);
    if (!session) {
      logger.info(`Agent Key ${slot + 1} has no assigned Claude session.`);
      return;
    }
    await renderDevice(store.snapshot(), "Agent Key");
    await Promise.resolve(navigator.open(session.id));
    logger.info(`Opened Claude session in slot ${slot + 1}.`);
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

  async function connectDevice() {
    deviceRequested = true;
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
      await nextDevice.render(store.snapshot());
      lastDeviceError = null;
      return nextDevice;
    } catch (error) {
      device = null;
      lastDeviceError = error?.message ?? String(error);
      await nextDevice.stop().catch(() => {});
      throw error;
    }
  }

  async function disconnectDevice() {
    deviceRequested = false;
    const currentDevice = device;
    device = null;
    await currentDevice?.stop();
    await pushToTalk.reset();
  }

  function health() {
    const deviceStatus = device?.status?.() ?? {
      state: deviceRequested
        ? (lastDeviceError ? "error" : "starting")
        : "inactive",
      error: lastDeviceError,
    };
    return {
      ok: true,
      service: {
        ...runtimeStatus,
        version: metadata.version,
        nodeVersion: process.version,
        navigator: navigator.metadata(),
        voice: voice.status(),
        lastHookAt,
        device: deviceStatus,
      },
      slots: store.snapshot(),
    };
  }

  if (autoConnectDevice) await connectDevice();

  const server = http.createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    response.setHeader("cache-control", "no-store");
    if (!isAuthorized(request, authToken)) {
      response.statusCode = 401;
      response.setHeader("www-authenticate", "Bearer");
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      response.end(JSON.stringify(health()));
      return;
    }
    if (request.method !== "POST" || request.url !== "/hook") {
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    if (
      !request.headers["content-type"]
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      response.statusCode = 415;
      response.end(JSON.stringify({ ok: false }));
      return;
    }
    try {
      const event = await readJson(request);
      lastHookAt = now().toISOString();
      const changed = store.apply(event);
      if (changed) {
        await renderDevice(store.snapshot(), "Claude hook");
        logger.info(`Slot ${changed.slot + 1}: ${changed.state}`);
      }
      response.end(JSON.stringify({ ok: true }));
    } catch (error) {
      response.statusCode = error.statusCode ?? 400;
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 32;

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
  logger.info(`Louder Bridge is listening at http://${host}:${port}`);

  return {
    store,
    server,
    connectDevice,
    disconnectDevice,
    health,
    setRuntimeStatus(nextStatus) {
      runtimeStatus = { ...runtimeStatus, ...nextStatus };
    },
    get device() {
      return device;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await disconnectDevice();
      await voiceQueue.catch(() => {});
      await submitQueue.catch(() => {});
    },
  };
}
