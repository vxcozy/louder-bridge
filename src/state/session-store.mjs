import { SLOT_COUNT } from "../config.mjs";

const ACTIVE_STATES = new Set(["running", "needs_input"]);
const EVENT_STATES = {
  SessionStart: "idle",
  UserPromptSubmit: "running",
  PermissionRequest: "needs_input",
  Stop: "complete",
  StopFailure: "error",
  SessionEnd: "off",
};

export class SessionStore {
  constructor({ slots = SLOT_COUNT, now = () => Date.now() } = {}) {
    this.slotCount = slots;
    this.now = now;
    this.sessions = new Map();
    this.slotSessions = Array(slots).fill(null);
    this.selectedSlot = null;
  }

  stateForEvent(event) {
    if (event.hook_event_name === "Notification") {
      if (
        [
          "permission_prompt",
          "idle_prompt",
          "elicitation_dialog",
        ].includes(event.notification_type)
      ) {
        return "needs_input";
      }
      return null;
    }
    return EVENT_STATES[event.hook_event_name] ?? null;
  }

  chooseSlot() {
    const free = this.slotSessions.indexOf(null);
    if (free >= 0) return free;

    let candidate = 0;
    for (let slot = 1; slot < this.slotCount; slot += 1) {
      const current = this.sessions.get(this.slotSessions[slot]);
      const best = this.sessions.get(this.slotSessions[candidate]);
      const currentActive = ACTIVE_STATES.has(current?.state);
      const bestActive = ACTIVE_STATES.has(best?.state);
      if (bestActive && !currentActive) {
        candidate = slot;
      } else if (bestActive === currentActive && current.updatedAt < best.updatedAt) {
        candidate = slot;
      }
    }
    const evictedId = this.slotSessions[candidate];
    if (evictedId) {
      this.sessions.delete(evictedId);
      if (this.selectedSlot === candidate) this.selectedSlot = null;
    }
    return candidate;
  }

  apply(event) {
    if (
      !event ||
      typeof event.session_id !== "string" ||
      event.session_id.length < 1 ||
      event.session_id.length > 256
    ) {
      return null;
    }
    const state = this.stateForEvent(event);
    if (!state) return null;

    let session = this.sessions.get(event.session_id);
    if (!session && state === "off") return null;
    if (!session) {
      const slot = this.chooseSlot();
      session = {
        id: event.session_id,
        slot,
        state: "idle",
        updatedAt: this.now(),
      };
      this.sessions.set(event.session_id, session);
      this.slotSessions[slot] = event.session_id;
    }

    if (state === "off") {
      const ended = {
        ...session,
        state,
        updatedAt: this.now(),
      };
      this.sessions.delete(event.session_id);
      this.slotSessions[session.slot] = null;
      if (this.selectedSlot === session.slot) this.selectedSlot = null;
      return ended;
    }

    session.state = state;
    session.updatedAt = this.now();
    return { ...session };
  }

  select(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCount) {
      return null;
    }
    const sessionId = this.slotSessions[slot];
    if (!sessionId) return null;
    this.selectedSlot = slot;
    return { ...this.sessions.get(sessionId) };
  }

  snapshot() {
    return this.slotSessions.map((sessionId, slot) => {
      const session = sessionId ? this.sessions.get(sessionId) : null;
      return session
        ? { ...session, selected: slot === this.selectedSlot }
        : { slot, id: null, state: "off", selected: false };
    });
  }
}
