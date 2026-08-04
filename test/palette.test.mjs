import test from "node:test";
import assert from "node:assert/strict";
import { lightingForSlots } from "../src/device/palette.mjs";

test("renders six firmware lighting records", () => {
  const lights = lightingForSlots([
    { slot: 0, state: "idle", selected: false },
    { slot: 1, state: "running", selected: true },
    { slot: 2, state: "complete", selected: false },
    { slot: 3, state: "needs_input", selected: false },
    { slot: 4, state: "error", selected: false },
    { slot: 5, state: "off", selected: false, ambient: true },
  ]);
  assert.equal(lights.length, 6);
  assert.equal(lights[1].color, 0x3b82f6);
  assert.equal(lights[1].syncKeysLighting, false);
  assert.equal(lights[1].syncAmbientLighting, false);
  assert.equal(lights[5].syncAmbientLighting, true);
  assert.equal(lights[5].brightness, 0);
});

test("keeps every unused Agent Key white while the bridge owns the Micro", () => {
  const lights = lightingForSlots(
    Array.from({ length: 6 }, (_, slot) => ({
      slot,
      state: "standby",
      selected: false,
      ambient: slot === 0,
    })),
  );

  assert.equal(lights.every((light) => light.color === 0xffffff), true);
  assert.equal(lights.every((light) => light.brightness === 0.18), true);
  assert.equal(lights.every((light) => light.effect === 1), true);
  assert.deepEqual(
    lights.map((light) => light.syncAmbientLighting),
    [true, false, false, false, false, false],
  );
});
