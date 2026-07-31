import { performance } from "node:perf_hooks";

export const PUSH_TO_TALK_WINDOW_MS = 350;

const IDLE = Object.freeze({ type: "idle" });

export function transitionPushToTalk(
  state,
  event,
  now,
  windowMs = PUSH_TO_TALK_WINDOW_MS,
) {
  if (!Number.isFinite(now)) throw new TypeError("A monotonic time is required.");
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new TypeError("The push-to-talk window must be nonnegative.");
  }

  switch (state.type) {
    case "idle":
      return event === "press"
        ? {
            state: { type: "pressed", pressedAt: now },
            action: "start",
            timeoutAt: null,
          }
        : { state, action: null, timeoutAt: null };
    case "pressed": {
      if (event !== "release") {
        return { state, action: null, timeoutAt: null };
      }
      const deadline = state.pressedAt + windowMs;
      return now >= deadline
        ? { state: IDLE, action: "stop", timeoutAt: null }
        : {
            state: { type: "waiting-for-second-press", deadline },
            action: null,
            timeoutAt: deadline,
          };
    }
    case "waiting-for-second-press":
      if (now >= state.deadline) {
        return { state: IDLE, action: "stop", timeoutAt: null };
      }
      return event === "press"
        ? { state: { type: "latched" }, action: null, timeoutAt: null }
        : { state, action: null, timeoutAt: state.deadline };
    case "latched": {
      if (event !== "press") {
        return { state, action: null, timeoutAt: null };
      }
      const deadline = now + windowMs;
      return {
        state: { type: "suppressing-presses", deadline },
        action: "stop",
        timeoutAt: deadline,
      };
    }
    case "suppressing-presses":
      if (now < state.deadline) {
        return { state, action: null, timeoutAt: state.deadline };
      }
      return event === "press"
        ? {
            state: { type: "pressed", pressedAt: now },
            action: "start",
            timeoutAt: null,
          }
        : { state: IDLE, action: null, timeoutAt: null };
    default:
      throw new TypeError(`Unknown push-to-talk state "${state.type}".`);
  }
}

export class PushToTalkController {
  constructor({
    onAction,
    onError = () => {},
    now = () => performance.now(),
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    windowMs = PUSH_TO_TALK_WINDOW_MS,
  }) {
    if (typeof onAction !== "function") {
      throw new TypeError("A push-to-talk action handler is required.");
    }
    this.onAction = onAction;
    this.onError = onError;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.windowMs = windowMs;
    this.state = IDLE;
    this.timer = null;
  }

  status() {
    return this.state.type;
  }

  handle(event) {
    if (event !== "press" && event !== "release") {
      throw new TypeError(`Unknown push-to-talk event "${event}".`);
    }
    return this.advance(event, this.now());
  }

  advance(event, now) {
    const result = transitionPushToTalk(
      this.state,
      event,
      now,
      this.windowMs,
    );
    this.state = result.state;
    this.cancelTimer();
    const action = this.runAction(result.action);
    if (result.timeoutAt !== null) {
      const deadline = result.timeoutAt;
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.advance("timeout", deadline).catch(this.onError);
      }, Math.max(0, deadline - now));
    }
    return action;
  }

  reset() {
    this.cancelTimer();
    const shouldStop =
      this.state.type !== "idle" &&
      this.state.type !== "suppressing-presses";
    this.state = IDLE;
    return this.runAction(shouldStop ? "stop" : null);
  }

  cancelTimer() {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  runAction(action) {
    return action === null
      ? Promise.resolve()
      : Promise.resolve().then(() => this.onAction(action));
  }
}

export function createPushToTalk(options) {
  return new PushToTalkController(options);
}
