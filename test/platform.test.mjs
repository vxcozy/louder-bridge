import test from "node:test";
import assert from "node:assert/strict";
import {
  macOSVersion,
  platformSupport,
} from "../src/macos/platform.mjs";

test("reads and validates the macOS product version", () => {
  assert.equal(
    macOSVersion({
      platform: "darwin",
      run: () => ({ status: 0, stdout: "15.7.1\n" }),
    }),
    "15.7.1",
  );
  assert.equal(
    macOSVersion({
      platform: "darwin",
      run: () => ({ status: 0, stdout: "unexpected\n" }),
    }),
    null,
  );
  assert.equal(macOSVersion({ platform: "linux" }), null);
});

test("requires Apple Silicon and macOS 15 or newer", () => {
  assert.equal(
    platformSupport({
      platform: "darwin",
      arch: "arm64",
      version: "15.0",
    }).supported,
    true,
  );
  assert.equal(
    platformSupport({
      platform: "darwin",
      arch: "arm64",
      version: "14.7",
    }).supported,
    false,
  );
  assert.equal(
    platformSupport({
      platform: "darwin",
      arch: "x64",
      version: "15.0",
    }).supported,
    false,
  );
});

test("uses the Darwin release only when sw_vers is unavailable", () => {
  assert.equal(
    platformSupport({
      platform: "darwin",
      arch: "arm64",
      version: null,
      release: "24.6.0",
    }).supported,
    true,
  );
  assert.equal(
    platformSupport({
      platform: "darwin",
      arch: "arm64",
      version: null,
      release: "23.6.0",
    }).supported,
    false,
  );
});
