import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isNativeExecutable } from "../src/macos/native-executable.mjs";

test("accepts Mach-O files and rejects scripts and symlinks", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-native-"));
  context.after(() => fs.rmSync(directory, { recursive: true }));
  const native = path.join(directory, "native");
  const script = path.join(directory, "script");
  const link = path.join(directory, "link");
  fs.writeFileSync(native, Buffer.from("cffaedfe", "hex"));
  fs.writeFileSync(script, "#!/bin/sh\n");
  fs.symlinkSync(native, link);

  assert.equal(isNativeExecutable(native), true);
  assert.equal(isNativeExecutable(script), false);
  assert.equal(isNativeExecutable(link), false);
  assert.equal(isNativeExecutable(path.join(directory, "missing")), false);
});
