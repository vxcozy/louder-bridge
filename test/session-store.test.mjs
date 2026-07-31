import test from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/state/session-store.mjs";

test("maps Claude lifecycle events to Micro states", () => {
  let time = 100;
  const store = new SessionStore({ now: () => time++ });
  const event = (name, extra = {}) =>
    store.apply({
      session_id: "session-a",
      cwd: "/work/alpha",
      hook_event_name: name,
      ...extra,
    });

  assert.equal(event("SessionStart").state, "idle");
  assert.equal(event("UserPromptSubmit").state, "running");
  assert.equal(event("PermissionRequest").state, "needs_input");
  assert.equal(event("Stop").state, "complete");
  assert.equal(event("StopFailure").state, "error");
  assert.equal(event("SessionEnd").state, "off");
});

test("notification prompts become needs-input", () => {
  const store = new SessionStore();
  const result = store.apply({
    session_id: "session-a",
    hook_event_name: "Notification",
    notification_type: "permission_prompt",
  });
  assert.equal(result.state, "needs_input");
});

test("keeps six stable slots and evicts the oldest inactive session", () => {
  let time = 1;
  const store = new SessionStore({ now: () => time++ });
  for (let index = 0; index < 6; index += 1) {
    store.apply({
      session_id: `session-${index}`,
      hook_event_name: "SessionStart",
    });
  }
  store.apply({
    session_id: "session-1",
    hook_event_name: "UserPromptSubmit",
  });
  const seventh = store.apply({
    session_id: "session-6",
    hook_event_name: "SessionStart",
  });

  assert.equal(seventh.slot, 0);
  assert.equal(store.snapshot()[1].id, "session-1");
  assert.equal(store.snapshot().length, 6);
});

test("select returns the session assigned to an Agent Key", () => {
  const store = new SessionStore();
  store.apply({ session_id: "abc", hook_event_name: "SessionStart" });
  assert.equal(store.select(0).id, "abc");
  assert.equal(store.snapshot()[0].selected, true);
  assert.equal(store.select(5), null);
});

test("rejects malformed session identifiers and working directories", () => {
  const store = new SessionStore();
  assert.equal(
    store.apply({
      session_id: "",
      hook_event_name: "SessionStart",
    }),
    null,
  );
  assert.equal(
    store.apply({
      session_id: "session-a",
      cwd: { unexpected: true },
      hook_event_name: "SessionStart",
    }),
    null,
  );
  assert.equal(store.snapshot()[0].id, null);
});
