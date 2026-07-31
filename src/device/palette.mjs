const EFFECT = {
  off: 0,
  solid: 1,
  breath: 4,
  shallowBreath: 6,
};

const STATUS_LIGHT = {
  off: { color: 0x000000, brightness: 0, effect: EFFECT.off, speed: 0 },
  idle: { color: 0xffffff, brightness: 0.18, effect: EFFECT.solid, speed: 0 },
  running: {
    color: 0x3b82f6,
    brightness: 0.9,
    effect: EFFECT.shallowBreath,
    speed: 0.45,
  },
  complete: {
    color: 0x22c55e,
    brightness: 0.82,
    effect: EFFECT.solid,
    speed: 0,
  },
  needs_input: {
    color: 0xf59e0b,
    brightness: 1,
    effect: EFFECT.breath,
    speed: 0.6,
  },
  error: {
    color: 0xef4444,
    brightness: 1,
    effect: EFFECT.breath,
    speed: 0.8,
  },
};

export function lightingForSlots(slots) {
  return slots.map((slot) => ({
    id: slot.slot,
    ...(STATUS_LIGHT[slot.state] ?? STATUS_LIGHT.off),
    syncKeysLighting: slot.selected,
    syncAmbientLighting: slot.selected,
  }));
}
