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

function testKit({ devices = [{}], connectGate } = {}) {
  const state = {
    connectCalls: 0,
    disconnectCalls: 0,
    hidHandler: null,
    comms: [],
  };
  class Discovery {
    findWLDevices() {
      return devices;
    }
  }
  class Comm {
    constructor() {
      this.disconnectCalls = 0;
      state.comms.push(this);
    }
    onConnectionEvent(handler) {
      this.connectionHandler = handler;
      state.connectionHandler = handler;
      return () => {
        if (state.connectionHandler === handler) {
          state.connectionHandler = null;
        }
      };
    }
    async connect() {
      state.connectCalls += 1;
      if (connectGate) await connectGate.promise;
    }
    async disconnect() {
      this.disconnectCalls += 1;
      state.disconnectCalls += 1;
    }
  }
  class Api {
    onHidReceived(handler) {
      state.hidHandler = handler;
      return () => {
        state.hidHandler = null;
      };
    }
    async sendThreadsLighting() {
      return true;
    }
  }
  return {
    kit: {
      DeviceType: { CodexMicro: 1 },
      ConnectionEventType: { DISCONNECTED: "disconnected", ERROR: "error" },
      WLDeviceDiscovery: Discovery,
      WLDeviceCommImpl: Comm,
      RPCApiOAI: Api,
    },
    state,
  };
}

class TestDevice extends WorkLouderDevice {
  constructor(kit, options = {}) {
    super(options);
    this.testKit = kit;
  }
  loadLibrary() {
    return this.testKit;
  }
}

test("serializes overlapping device connection attempts", async () => {
  const gate = deferred();
  const { kit, state } = testKit({ connectGate: gate });
  const device = new TestDevice(kit, {
    logger: { info() {}, error() {} },
  });

  const start = device.start();
  await waitForImmediate();
  const concurrent = device.connect();
  await waitForImmediate();
  assert.equal(state.connectCalls, 1);

  gate.resolve();
  await Promise.all([start, concurrent]);
  assert.equal(device.status().state, "connected");
  assert.equal(device.status().error, null);
  assert.equal(device.status().lastEventAt !== null, true);
  await device.stop();
  assert.equal(device.status().state, "stopped");
});

test("contains asynchronous Agent Key handler failures", async () => {
  const errors = [];
  const { kit, state } = testKit();
  const device = new TestDevice(kit, {
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
  state.hidHandler({ key: "AG03", act: 1 });
  await waitForImmediate();
  assert.deepEqual(errors, ["Agent Key action failed: navigation failed"]);
  await device.stop();
});

test("routes the MIC key as press and release without duplicate edges", async () => {
  const actions = [];
  const { kit, state } = testKit();
  const device = new TestDevice(kit, {
    logger: { info() {}, error() {} },
    async onVoiceButton(action) {
      actions.push(action);
    },
  });

  await device.start();
  state.hidHandler({ key: "ACT10", act: 1 });
  state.hidHandler({ key: "ACT10", act: 1 });
  state.hidHandler({ key: "ACT10", act: 0 });
  state.hidHandler({ key: "ACT10", act: 0 });
  await waitForImmediate();
  assert.deepEqual(actions, ["press", "release"]);
  assert.deepEqual(device.status().lastEvent.type, "voice");
  assert.deepEqual(device.status().lastEvent.action, "release");
  await device.stop();
});

test("releases voice input if the Micro disconnects while held", async () => {
  const actions = [];
  const { kit, state } = testKit();
  const device = new TestDevice(kit, {
    logger: { info() {}, error() {} },
    async onVoiceButton(action) {
      actions.push(action);
    },
  });

  await device.start();
  state.hidHandler({ key: "ACT10", act: 1 });
  await waitForImmediate();
  state.connectionHandler({ type: "disconnected" });
  await waitForImmediate();
  assert.deepEqual(actions, ["press", "release"]);
  await device.stop();
});

test("stops latched voice input if the Micro disconnects", async () => {
  const actions = [];
  const { kit, state } = testKit();
  const pushToTalk = createPushToTalk({
    onAction(action) {
      actions.push(action);
    },
  });
  const device = new TestDevice(kit, {
    logger: { info() {}, error() {} },
    onVoiceButton(action) {
      return pushToTalk.handle(action);
    },
    onDeviceDisconnect() {
      return pushToTalk.reset();
    },
  });

  await device.start();
  state.hidHandler({ key: "ACT10", act: 1 });
  await waitForImmediate();
  state.hidHandler({ key: "ACT10", act: 0 });
  await waitForImmediate();
  state.hidHandler({ key: "ACT10", act: 1 });
  await waitForImmediate();
  state.hidHandler({ key: "ACT10", act: 0 });
  await waitForImmediate();
  assert.equal(pushToTalk.status(), "latched");

  state.connectionHandler({ type: "disconnected" });
  await waitForImmediate();
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(pushToTalk.status(), "idle");
  await device.stop();
});

test("logs a missing device only once while retrying", async () => {
  const messages = [];
  const { kit } = testKit({ devices: [] });
  const device = new TestDevice(kit, {
    logger: {
      info(message) {
        messages.push(message);
      },
      error() {},
    },
  });

  await device.start();
  await device.connect();
  await device.connect();
  assert.equal(
    messages.filter((message) => message.includes("not detected")).length,
    1,
  );
  assert.equal(device.status().state, "waiting");
  await device.stop();
});

test("does not publish a connection that ended while opening", async () => {
  const gate = deferred();
  const { kit, state } = testKit({ connectGate: gate });
  const device = new TestDevice(kit, {
    logger: { info() {}, error() {} },
  });

  const start = device.start();
  await waitForImmediate();
  state.connectionHandler({ type: "disconnected" });
  gate.resolve();
  await start;

  assert.equal(device.status().state, "waiting");
  assert.equal(device.api, null);
  await device.stop();
});

test("ignores a stale disconnect from an older connection", async () => {
  const { kit, state } = testKit();
  const device = new TestDevice(kit, {
    logger: { info() {}, error() {} },
  });

  await device.start();
  const firstComm = state.comms[0];
  const staleHandler = firstComm.connectionHandler;
  staleHandler({ type: "disconnected" });
  await waitForImmediate();
  await device.connect();
  const secondComm = state.comms[1];

  staleHandler({ type: "disconnected" });
  await waitForImmediate();
  assert.equal(device.status().state, "connected");
  assert.equal(secondComm.disconnectCalls, 0);
  await device.stop();
});

test("closes a partially loaded archive after startup failure", async () => {
  let closed = false;
  class FailingDevice extends WorkLouderDevice {
    loadLibrary() {
      throw new Error("package load failed");
    }
  }
  const device = new FailingDevice({
    provider: {
      metadata: () => ({
        id: "test",
        support: "test",
        version: null,
      }),
      close() {
        closed = true;
      },
    },
    logger: { info() {}, error() {} },
  });

  await assert.rejects(device.start(), /package load failed/);
  await device.stop();
  assert.equal(closed, true);
  assert.equal(device.status().state, "stopped");
});
