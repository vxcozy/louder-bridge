import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertRegularArchiveTree,
  validateArchiveEntries,
} from "../scripts/archive-safety.mjs";

test("accepts only release paths inside the app or metadata directory", () => {
  assert.deepEqual(
    validateArchiveEntries([
      "Louder Bridge.app/",
      "Louder Bridge.app/Contents/Info.plist",
      "__MACOSX/Louder Bridge.app/Contents/._Info.plist",
    ].join("\n")),
    [
      "Louder Bridge.app/",
      "Louder Bridge.app/Contents/Info.plist",
      "__MACOSX/Louder Bridge.app/Contents/._Info.plist",
    ],
  );
  for (const unsafe of [
    "Louder Bridge.app/../outside",
    "/Louder Bridge.app/Contents/Info.plist",
    "Louder Bridge.app\\..\\outside",
    "unexpected/file",
  ]) {
    assert.throws(
      () => validateArchiveEntries(`Louder Bridge.app/\n${unsafe}\n`),
      /unsafe path/,
    );
  }
});

test("rejects links and special files in an extracted release", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-archive-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  fs.mkdirSync(path.join(directory, "Contents"));
  fs.writeFileSync(path.join(directory, "Contents", "Info.plist"), "plist");
  assert.doesNotThrow(() => assertRegularArchiveTree(directory));

  fs.symlinkSync("Info.plist", path.join(directory, "Contents", "link"));
  assert.throws(
    () => assertRegularArchiveTree(directory),
    /unsupported file: link/,
  );
  fs.unlinkSync(path.join(directory, "Contents", "link"));
  fs.chmodSync(path.join(directory, "Contents", "Info.plist"), 0o666);
  assert.throws(
    () => assertRegularArchiveTree(directory),
    /unsafe permissions: Info.plist/,
  );
});
