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
    { slot: 5, state: "off", selected: false },
  ]);
  assert.equal(lights.length, 6);
  assert.equal(lights[1].color, 0x3b82f6);
  assert.equal(lights[1].syncAmbientLighting, true);
  assert.equal(lights[5].brightness, 0);
});
