import test from "node:test";
import assert from "node:assert/strict";
import { findAttribution } from "../src/policy/attribution.mjs";

test("rejects authorship trailers and generated-by credits", () => {
  const trailer = `${["Co", "authored"].join("-")}-by: Example <example.test>`;
  assert.equal(findAttribution(trailer), "authorship trailer");
  assert.equal(
    findAttribution("This change was generated with an AI."),
    "automated authorship attribution",
  );
});

test("allows product names in ordinary technical prose", () => {
  assert.equal(
    findAttribution("Louder Bridge connects Claude Desktop to the Codex Micro."),
    null,
  );
});
