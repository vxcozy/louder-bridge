import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsarRequire } from "../src/runtime/asar-require.mjs";

function asarFixture(filename) {
  const contents = Buffer.from("hello");
  const header = Buffer.from(
    JSON.stringify({
      files: {
        "hello.txt": {
          size: contents.length,
          offset: "0",
        },
      },
    }),
  );
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(header.length + 8, 4);
  prefix.writeUInt32LE(header.length, 12);
  fs.writeFileSync(filename, Buffer.concat([prefix, header, contents]));
}

test("reads packed ASAR files without retaining the archive body", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-asar-"));
  const filename = path.join(directory, "fixture.asar");
  asarFixture(filename);

  const archive = new AsarRequire(filename);
  assert.equal(archive.readFile("hello.txt").toString(), "hello");
  assert.equal(Object.hasOwn(archive, "data"), false);
  archive.close();
  assert.equal(archive.descriptor, null);
  fs.rmSync(directory, { recursive: true });
});

test("rejects ASAR entries outside the archive bounds", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "louder-asar-"));
  const filename = path.join(directory, "fixture.asar");
  asarFixture(filename);
  const archive = new AsarRequire(filename);
  archive.header.files["hello.txt"].size = 500;

  assert.throws(() => archive.readFile("hello.txt"), /bounds/);
  archive.close();
  fs.rmSync(directory, { recursive: true });
});
