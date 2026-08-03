import test from "node:test";
import assert from "node:assert/strict";
import { findAttribution } from "../src/policy/attribution.mjs";

test("rejects authorship trailers and generated-by credits", () => {
  const trailer = `${["Co", "authored"].join("-")}-by: Example <example.test>`;
  const credit = ["This change was", "generated", "with an AI."].join(" ");
  assert.equal(findAttribution(trailer), "authorship trailer");
  assert.equal(
    findAttribution(credit),
    "automated authorship attribution",
  );
});

test("allows product names in ordinary technical prose", () => {
  assert.equal(
    findAttribution("Louder Bridge connects Claude Desktop to the Codex Micro."),
    null,
  );
});
