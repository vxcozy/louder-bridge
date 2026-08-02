import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  inspectNativeMicroRuntime,
  NativeMicroTransport,
  threadLightingMessage,
} from "../src/device/native-transport.mjs";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
  }

  finish(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  kill(signal) {
    this.finish(null, signal);
    return true;
  }
}

class StubbornChild extends FakeChild {
  constructor({ exitOnSignal = "SIGKILL" } = {}) {
    super();
    this.exitOnSignal = exitOnSignal;
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    if (signal === this.exitOnSignal) this.finish(null, signal);
    return true;
  }
}

test("recognizes the bundled native driver", () => {
  const status = inspectNativeMicroRuntime({ launcher: "/bin/ls" });
  assert.equal(status.id, "native-iokit-protocol");
  assert.equal(status.support, "experimental");
  assert.equal(status.available, true);
  assert.equal(status.error, null);
});

test("connects, reports firmware and transport, and routes HID events", async () => {
  const child = new FakeChild();
  const events = [];
  const transport = new NativeMicroTransport({
    launcher: "/bin/ls",
    spawnProcess(command, args) {
      assert.equal(command, "/bin/ls");
      assert.deepEqual(args, ["--micro-device"]);
      return child;
    },
  });
  const connected = transport.connect({
    onEvent(event) {
      events.push(event);
    },
  });
  child.stdout.write(
    `${JSON.stringify({
      _louder: {
        type: "connected",
        transport: "USB",
        status: { version: "v0.4.1", battery: 100 },
      },
    })}\n`,
  );
  await connected;
  child.stdout.write(
    `${JSON.stringify({
      m: "v.oai.hid",
      p: { k: "ACT10", act: 1, ag: 0 },
    })}\n`,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(transport.metadata(), {
    id: "native-iokit-protocol",
    support: "experimental",
    version: "v0.4.1",
    transport: "USB",
  });
  assert.deepEqual(events, [{ key: "ACT10", act: 1, agent: 0 }]);

  const written = [];
  child.stdin.on("data", (chunk) => written.push(chunk.toString("utf8")));
  await transport.send({ m: "v.oai.thstatus", p: [] });
  assert.equal(written.join(""), '{"m":"v.oai.thstatus","p":[]}\n');
  const closing = transport.close();
  child.finish();
  await closing;
});

test("reports a driver failure before startup completes", async () => {
  const child = new FakeChild();
  const transport = new NativeMicroTransport({
    launcher: "/bin/ls",
    spawnProcess: () => child,
  });
  const connected = transport.connect();
  child.stderr.write("Codex Micro was not found.\n");
  child.finish(4);
  await assert.rejects(connected, /Codex Micro was not found/);
});

test("reports a disconnect once after a successful connection", async () => {
  const child = new FakeChild();
  const disconnects = [];
  const transport = new NativeMicroTransport({
    launcher: "/bin/ls",
    spawnProcess: () => child,
  });
  const connected = transport.connect({
    onDisconnect(error) {
      disconnects.push(error?.message ?? "clean");
    },
  });
  child.stdout.write(
    '{"_louder":{"type":"connected","transport":"Bluetooth Low Energy","status":{"version":"v0.4.1"}}}\n',
  );
  await connected;
  child.stdout.write('{"_louder":{"type":"disconnected"}}\n');
  child.finish(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disconnects, ["clean"]);
});

test("forces an unresponsive native driver to exit before closing", async () => {
  const child = new StubbornChild();
  const transport = new NativeMicroTransport({
    launcher: "/bin/ls",
    spawnProcess: () => child,
    closeTimeoutMs: 1,
  });
  const connected = transport.connect();
  child.stdout.write(
    '{"_louder":{"type":"connected","transport":"USB","status":{"version":"v0.4.1"}}}\n',
  );
  await connected;

  await transport.close();

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.signalCode, "SIGKILL");
});

test("disconnects and terminates a driver that stops accepting commands", async () => {
  const child = new FakeChild();
  child.stdin = new Writable({
    write() {},
  });
  const disconnects = [];
  const transport = new NativeMicroTransport({
    launcher: "/bin/ls",
    spawnProcess: () => child,
    commandTimeoutMs: 5,
    closeTimeoutMs: 1,
  });
  const connected = transport.connect({
    onDisconnect(error) {
      disconnects.push(error?.message ?? "clean");
    },
  });
  child.stdout.write(
    '{"_louder":{"type":"connected","transport":"USB","status":{"version":"v0.4.1"}}}\n',
  );
  await connected;
  const exited = once(child, "exit");

  await assert.rejects(
    transport.send({ m: "v.oai.thstatus", p: [] }),
    /did not accept a command in time/,
  );
  await exited;

  assert.deepEqual(disconnects, [
    "Codex Micro did not accept a command in time.",
  ]);
  assert.equal(transport.child, null);
  assert.equal(transport.connected, false);
  assert.equal(child.signalCode, "SIGTERM");
});

test("encodes thread lights with the Codex Micro protocol fields", () => {
  assert.deepEqual(
    threadLightingMessage([
      {
        id: 2,
        color: 0x112233,
        brightness: 0.8,
        effect: 6,
        speed: 0.4,
        syncKeysLighting: true,
        syncAmbientLighting: false,
      },
    ]),
    {
      m: "v.oai.thstatus",
      p: [
        {
          id: 2,
          c: 0x112233,
          b: 0.8,
          e: 6,
          s: 0.4,
          sk: 1,
          sa: 0,
        },
      ],
    },
  );
});
