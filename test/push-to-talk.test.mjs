import test from "node:test";
import assert from "node:assert/strict";
import {
  PUSH_TO_TALK_WINDOW_MS,
  PushToTalkController,
  transitionPushToTalk,
} from "../src/device/push-to-talk.mjs";

const idle = { type: "idle" };

test("holding MIC starts on press and stops on release", () => {
  const pressed = transitionPushToTalk(idle, "press", 100);
  assert.deepEqual(pressed, {
    state: { type: "pressed", pressedAt: 100 },
    action: "start",
    timeoutAt: null,
  });
  assert.deepEqual(
    transitionPushToTalk(
      pressed.state,
      "release",
      100 + PUSH_TO_TALK_WINDOW_MS,
    ),
    {
      state: idle,
      action: "stop",
      timeoutAt: null,
    },
  );
});

test("a quick MIC tap stops when the double-press window expires", () => {
  const pressed = transitionPushToTalk(idle, "press", 100);
  const released = transitionPushToTalk(pressed.state, "release", 200);
  assert.deepEqual(released, {
    state: {
      type: "waiting-for-second-press",
      deadline: 100 + PUSH_TO_TALK_WINDOW_MS,
    },
    action: null,
    timeoutAt: 100 + PUSH_TO_TALK_WINDOW_MS,
  });
  assert.deepEqual(
    transitionPushToTalk(
      released.state,
      "timeout",
      released.timeoutAt,
    ),
    {
      state: idle,
      action: "stop",
      timeoutAt: null,
    },
  );
});

test("the controller runs the deferred stop after a quick tap", async () => {
  const actions = [];
  let now = 100;
  let scheduled;
  const controller = new PushToTalkController({
    now: () => now,
    onAction(action) {
      actions.push(action);
    },
    setTimer(callback, delay) {
      scheduled = { callback, delay };
      return callback;
    },
    clearTimer() {
      scheduled = null;
    },
  });

  await controller.handle("press");
  now = 200;
  await controller.handle("release");
  assert.equal(scheduled.delay, 250);

  scheduled.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(controller.status(), "idle");
});

test("two quick MIC taps latch dictation until the next press", () => {
  const firstPress = transitionPushToTalk(idle, "press", 100);
  const firstRelease = transitionPushToTalk(
    firstPress.state,
    "release",
    200,
  );
  const secondPress = transitionPushToTalk(
    firstRelease.state,
    "press",
    300,
  );
  assert.deepEqual(secondPress, {
    state: { type: "latched" },
    action: null,
    timeoutAt: null,
  });
  assert.deepEqual(
    transitionPushToTalk(secondPress.state, "release", 325),
    {
      state: { type: "latched" },
      action: null,
      timeoutAt: null,
    },
  );
  assert.deepEqual(
    transitionPushToTalk(secondPress.state, "press", 1_000),
    {
      state: {
        type: "suppressing-presses",
        deadline: 1_000 + PUSH_TO_TALK_WINDOW_MS,
      },
      action: "stop",
      timeoutAt: 1_000 + PUSH_TO_TALK_WINDOW_MS,
    },
  );
});

test("reset stops active or latched dictation immediately", async () => {
  const actions = [];
  let now = 100;
  let timer;
  const controller = new PushToTalkController({
    now: () => now,
    onAction(action) {
      actions.push(action);
    },
    setTimer(callback) {
      timer = callback;
      return callback;
    },
    clearTimer(callback) {
      if (timer === callback) timer = null;
    },
  });

  await controller.handle("press");
  now = 200;
  await controller.handle("release");
  now = 300;
  await controller.handle("press");
  assert.equal(controller.status(), "latched");

  await controller.reset();
  assert.deepEqual(actions, ["start", "stop"]);
  assert.equal(controller.status(), "idle");
  assert.equal(timer, null);
});
