import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertBundledLicense } from "../scripts/bundled-license.mjs";

test("accepts a complete reviewed license", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-license-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const filename = path.join(directory, "LICENSE");
  fs.writeFileSync(filename, "reviewed license text\n");

  assert.equal(
    assertBundledLicense(filename, {
      expectedContents: "reviewed license text\n",
      label: "project license",
      minimumBytes: 10,
    }),
    "reviewed license text\n",
  );
});

test("rejects a missing, incomplete, or substituted license", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-license-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const filename = path.join(directory, "LICENSE");
  const options = {
    expectedContents: "reviewed license text\n",
    label: "project license",
    minimumBytes: 10,
  };

  assert.throws(
    () => assertBundledLicense(filename, options),
    /does not contain the project license/,
  );
  fs.writeFileSync(filename, "short");
  assert.throws(
    () => assertBundledLicense(filename, options),
    /project license is incomplete/,
  );
  fs.writeFileSync(filename, "substituted license text\n");
  assert.throws(
    () => assertBundledLicense(filename, options),
    /does not match the reviewed source/,
  );
});
