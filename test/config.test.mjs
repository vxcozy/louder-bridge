import test from "node:test";
import assert from "node:assert/strict";
import {
  assertLocalAddress,
  bridgeUrl,
} from "../src/config.mjs";

test("accepts only local bridge endpoints", () => {
  assert.doesNotThrow(() => assertLocalAddress("127.0.0.1", 47831));
  assert.doesNotThrow(() => assertLocalAddress("::1", 47831));
  assert.doesNotThrow(() => assertLocalAddress("localhost", 47831));
  assert.throws(
    () => assertLocalAddress("192.0.2.1", 47831),
    /non-loopback address/,
  );
  assert.throws(() => assertLocalAddress("127.0.0.1", 65_536), /Invalid/);
});

test("formats IPv4, IPv6, and named loopback URLs", () => {
  assert.equal(bridgeUrl("127.0.0.1", 47831), "http://127.0.0.1:47831");
  assert.equal(bridgeUrl("::1", 47831), "http://[::1]:47831");
  assert.equal(bridgeUrl("localhost", 47831), "http://localhost:47831");
});
