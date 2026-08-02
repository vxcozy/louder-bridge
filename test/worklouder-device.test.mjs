import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as waitForImmediate } from "node:timers/promises";
import { createPushToTalk } from "../src/device/push-to-talk.mjs";
import { WorkLouderDevice } from "../src/device/worklouder.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeTransport {
  constructor({ connectGate, connectError, sendError, closeError } = {}) {
    this.connectGate = connectGate;
    this.connectError = connectError;
    this.sendError = sendError;
    this.closeError = closeError;
    this.connectCalls = 0;
    this.closeCalls = 0;
    this.messages = [];
    this.callbacks = null;
  }

  metadata() {
    return {
      id: "test-native",
      support: "test",
      version: "v0.4.1",
      transport: "USB",
    };
  }

  async connect(callbacks) {
    this.connectCalls += 1;
    this.callbacks = callbacks;
    if (this.connectGate) await this.connectGate.promise;
    if (this.connectError) throw this.connectError;
    return this.metadata();
  }

  async send(message) {
    if (this.sendError) throw this.sendError;
    this.messages.push(message);
  }

  async close() {
    this.closeCalls += 1;
    if (this.closeError) throw this.closeError;
  }

  event(key, act) {
    this.callbacks.onEvent({ key, act });
  }

  disconnected(error = null) {
    return this.callbacks.onDisconnect(error);
  }
}

class DisconnectingSendTransport extends FakeTransport {
  async send() {
    const error = new Error("native driver stopped accepting commands");
    this.disconnected(error);
    throw error;
  }
}

function testDevice(transports, options = {}) {
  let index = 0;
  return new WorkLouderDevice({
    ...options,
    runtime: {
      id: "test-native",
      support: "test",
      version: null,
      available: true,
      error: null,
    },
    transportFactory() {
      return transports[Math.min(index++, transports.length - 1)];
    },
  });
}

test("serializes overlapping device connection attempts", async () => {
  const gate = deferred();
  const transport = new FakeTransport({ connectGate: gate });
  const device = testDevice([transport], {
    logger: { info() {}, error() {} },
  });

  const start = device.start();
  await waitForImmediate();
  const concurrent = device.connect();
  await waitForImmediate();
  assert.equal(transport.connectCalls, 1);

  gate.resolve();
  await Promise.all([start, concurrent]);
  assert.equal(device.status().state, "connected");
  assert.equal(device.status().error, null);
  assert.equal(device.status().lastEventAt !== null, true);
  assert.equal(device.status().runtime.version, "v0.4.1");
  await device.stop();
  assert.equal(device.status().state, "stopped");
});

test("contains asynchronous Agent Key handler failures", async () => {
  const errors = [];
  const transport = new FakeTransport();
  const device = testDevice([transport], {
    logger: {
      info() {},
      error(message) {
        errors.push(message);
      },
    },
    async onAgentKey() {
      throw new Error("navigation failed");
    },
  });

  await device.start();
  transport.event("AG03", 1);
  await waitForImmediate();
  assert.deepEqual(errors, ["Agent Key action failed: navigation failed"]);
  await device.stop();
});

test("routes the MIC key as press and release without duplicate edges", async () => {
  const actions = [];
  const transport = new FakeTransport();
  const device = testDevice([transport], {
    logger: { info() {}, error() {} },
    async onVoiceButton(action) {
      actions.push(action);
    },
  });

  await device.start();
  transport.event("ACT10", 1);
  transport.event("ACT10", 1);
  transport.event("ACT11", 1);
  transport.event("ACT10", 0);
  transport.event("ACT10", 0);
  transport.event("ACT11", 0);
  await waitForImmediate();
  assert.deepEqual(actions, ["press", "release"]);
  assert.deepEqual(device.status().lastEvent.type, "voice");
  assert.deepEqual(device.status().lastEvent.action, "release");
  await device.stop();
});

test("routes one send action for each ACT12 press", async () => {
  let submissions = 0;
  const transport = new FakeTransport();
  const device = testDevice([transport], {
    logger: { info() {}, error() {} },
    async onSubmitButton() {
      submissions += 1;
    },
  });

  await device.start();
  transport.event("ACT12", 1);
  transport.event("ACT12", 1);
  transport.event("ACT12", 0);
  transport.event("ACT12", 0);
  transport.event("ACT12", 1);
  await waitForImmediate();

  assert.equal(submissions, 2);
  assert.equal(device.status().lastEvent.type, "submit");
  assert.equal(device.status().lastEvent.action, "press");
  await device.stop();
});

test("contains asynchronous send key failures", async () => {
  const errors = [];
  const transport = new FakeTransport();
  const device = testDevice([transport], {
    logger: {
      info() {},
      error(message) {
        errors.push(message);
      },
    },
    async onSubmitButton() {
      throw new Error("Claude is not focused");
    },
  });

  await device.start();
  transport.event("ACT12", 1);
  await waitForImmediate();
  assert.deepEqual(errors, [
    "Send key action failed: Claude is not focused",
  ]);
  await device.stop();
});

test("accepts the next send press after reconnecting mid-press", async () => {
  let submissions = 0;
  const firstTransport = new FakeTransport();
  const secondTransport = new FakeTransport();
  const device = testDevice([firstTransport, secondTransport], {
    logger: { info() {}, error() {} },
    async onSubmitButton() {
      submissions += 1;
    },
  });

  await device.start();
  firstTransport.event("ACT12", 1);
  await waitForImmediate();
  firstTransport.disconnected();
  await waitForImmediate();
  await device.connect();
  secondTransport.event("ACT12", 1);
  await waitForImmediate();

  assert.equal(submissions, 2);
  await device.stop();
});

test("releases voice input if the Micro disconnects while held", async () => {
  const actions = [];
  const transport = new FakeTransport();
  const device = testDevice([transport], {
    logger: { info() {}, error() {} },
    async onVoiceButton(action) {
      actions.push(action);
    },
  });

  await device.start();
  transport.event("ACT10", 1);
  await waitForImmediate();
  transport.disconnected();
  await waitForImmediate();
  assert.deepEqual(actions, ["press", "release"]);
  await device.stop();
});

test("reports a native driver crash after connecting", async () => {
  const errors = [];
  const transport = new FakeTransport();
  const device = testDevice([transport], {
    logger: {
      info() {},
      error(message) {
        errors.push(message);
      },
    },
  });

  await device.start();
  transport.disconnected(new Error("native driver crashed"));
  await waitForImmediate();

  assert.equal(device.status().state, "error");
  assert.equal(device.status().error, "native driver crashed");
  assert.match(errors[0], /native driver crashed/);
  await device.stop();
});

test("reconnects after the native driver stops accepting commands", async () => {
  const first = new DisconnectingSendTransport();
  const second = new FakeTransport();
  const errors = [];
  const device = testDevice([first, second], {
    logger: {
      info() {},
      error(message) {
        errors.push(message);
      },
    },
  });

  await device.start();
  await assert.rejects(
    device.render([{ slot: 0, state: "running", selected: false }]),
    /stopped accepting commands/,
  );
  await waitForImmediate();

  assert.equal(device.transport, null);
  assert.equal(device.status().state, "error");
  assert.match(device.status().error, /stopped accepting commands/);
  await device.connect();
  assert.equal(device.transport, second);
  assert.equal(device.status().state, "connected");
  assert.equal(device.status().error, null);
  assert.equal(errors.length, 1);
  await device.stop();
});

test("stops latched voice input if the Micro disconnects", async () => {
  const actions = [];
  const transport = new FakeTransport();
  const pushToTalk = createPushToTalk({
    onAction(action) {
      actions.push(action);
    },
  });
  const device = testDevice([transport], {
    logger: { info() {}, error() {} },
    onVoiceButton(action) {
      return pushToTalk.handle(action);
    },
    onDeviceDisconnect() {
      return pushToTalk.reset();
    },
  });

  await device.start();
  transport.event("ACT10", 1);
  await waitForImmediate();
  transport.event("ACT10", 0);
  await waitForImmediate();
  transport.event("ACT10", 1);
  await waitForImmediate();
  transport.event("ACT10", 0);
  await waitForImmediate();
  assert.equal(pushToTalk.status(), "latched");

  transport.disconnected();
  await waitForImmediate();
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(pushToTalk.status(), "idle");
  await device.stop();
});

test("logs a missing device only once while retrying", async () => {
  const messages = [];
  const missing = new Error("Codex Micro was not found.");
  const first = new FakeTransport({ connectError: missing });
  const second = new FakeTransport({ connectError: missing });
  const device = testDevice([first, second], {
    logger: {
      info(message) {
        messages.push(message);
      },
      error() {},
    },
  });

  await device.start();
  await device.connect().catch((error) => device.reportConnectionError(error));
  assert.equal(
    messages.filter((message) => message.includes("not detected")).length,
    1,
  );
  assert.equal(device.status().state, "waiting");
  await device.stop();
});

test("does not publish a connection that ended while opening", async () => {
  const gate = deferred();
  const transport = new FakeTransport({ connectGate: gate });
  const device = testDevice([transport], {
    logger: { info() {}, error() {} },
  });

  const start = device.start();
  await waitForImmediate();
  transport.disconnected();
  gate.resolve();
  await start;

  assert.equal(device.status().state, "waiting");
  assert.equal(device.transport, null);
  assert.equal(transport.closeCalls > 0, true);
  await device.stop();
});

test("ignores a stale disconnect from an older connection", async () => {
  const first = new FakeTransport();
  const second = new FakeTransport();
  const device = testDevice([first, second], {
    logger: { info() {}, error() {} },
  });

  await device.start();
  first.disconnected();
  await waitForImmediate();
  await device.connect();
  assert.equal(device.transport, second);

  first.disconnected();
  await waitForImmediate();
  assert.equal(device.transport, second);
  assert.equal(second.closeCalls, 0);
  await device.stop();
});

test("reports a driver startup failure and closes its process", async () => {
  const transport = new FakeTransport({
    connectError: new Error("driver failed"),
  });
  const errors = [];
  const device = testDevice([transport], {
    logger: {
      info() {},
      error(message) {
        errors.push(message);
      },
    },
  });

  await device.start();
  assert.equal(device.status().state, "error");
  assert.match(errors[0], /driver failed/);
  assert.equal(transport.closeCalls, 1);
  await device.stop();
  assert.equal(device.status().state, "stopped");
});

test("reports cleanup failures after resetting the device state", async () => {
  const messages = [];
  const transport = new FakeTransport({
    sendError: new Error("lighting failed"),
    closeError: new Error("close failed"),
  });
  const device = testDevice([transport], {
    logger: {
      info() {},
      error(message) {
        messages.push(message);
      },
    },
  });

  await device.start();
  await assert.rejects(
    device.stop(),
    (error) =>
      error instanceof AggregateError &&
      error.message === "Codex Micro did not shut down cleanly." &&
      error.errors.length === 2,
  );

  assert.equal(device.status().state, "stopped");
  assert.equal(device.transport, null);
  assert.equal(transport.closeCalls, 1);
  assert.deepEqual(messages, [
    "Could not clear Codex Micro lighting: lighting failed",
    "Could not disconnect Codex Micro: close failed",
  ]);
});
