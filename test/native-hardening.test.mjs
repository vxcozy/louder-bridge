import test from "node:test";
import assert from "node:assert/strict";
import { requireNativeHardening } from "../scripts/native-hardening.mjs";

test("requires stack protection and fortified calls in the native launcher", () => {
  assert.doesNotThrow(() => requireNativeHardening(
    [
      "___memcpy_chk",
      "___stack_chk_fail",
      "___stack_chk_guard",
    ].join("\n"),
    "Louder Bridge launcher",
  ));
  assert.throws(
    () => requireNativeHardening("___memcpy_chk", "Louder Bridge launcher"),
    /strong stack protection/,
  );
  assert.throws(
    () => requireNativeHardening(
      "___stack_chk_fail\n___stack_chk_guard",
      "Louder Bridge launcher",
    ),
    /fortified library calls/,
  );
});
