import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { publishNotarizedArchive } from "../scripts/notarized-artifacts.mjs";

function fixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-notarized-artifacts-"),
  );
  const archive = path.join(directory, "Louder-Bridge.zip");
  const checksum = `${archive}.sha256`;
  const app = path.join(directory, "Louder Bridge.app");
  fs.mkdirSync(app);
  fs.writeFileSync(archive, "old archive");
  fs.writeFileSync(checksum, "old checksum\n");
  return { directory, archive, checksum, app };
}

test("publishes a complete notarized archive and checksum", () => {
  const files = fixture();
  try {
    const digest = publishNotarizedArchive({
      archive: files.archive,
      app: files.app,
      run(command, args) {
        assert.equal(command, "/usr/bin/ditto");
        assert.deepEqual(args.slice(0, -2), [
          "-c",
          "-k",
          "--sequesterRsrc",
          "--keepParent",
        ]);
        assert.equal(args.at(-2), files.app);
        fs.writeFileSync(args.at(-1), "notarized archive");
      },
    });
    const expectedDigest = createHash("sha256")
      .update("notarized archive")
      .digest("hex");

    assert.equal(digest, expectedDigest);
    assert.equal(fs.readFileSync(files.archive, "utf8"), "notarized archive");
    assert.equal(
      fs.readFileSync(files.checksum, "utf8"),
      `${expectedDigest}  Louder-Bridge.zip\n`,
    );
    assert.deepEqual(
      fs.readdirSync(files.directory).sort(),
      ["Louder Bridge.app", "Louder-Bridge.zip", "Louder-Bridge.zip.sha256"],
    );
  } finally {
    fs.rmSync(files.directory, { recursive: true, force: true });
  }
});

test("keeps the previous artifacts when archive creation fails", () => {
  const files = fixture();
  try {
    assert.throws(
      () => publishNotarizedArchive({
        archive: files.archive,
        app: files.app,
        run() {
          throw new Error("archive creation failed");
        },
      }),
      /archive creation failed/,
    );

    assert.equal(fs.readFileSync(files.archive, "utf8"), "old archive");
    assert.equal(fs.readFileSync(files.checksum, "utf8"), "old checksum\n");
    assert.deepEqual(
      fs.readdirSync(files.directory).sort(),
      ["Louder Bridge.app", "Louder-Bridge.zip", "Louder-Bridge.zip.sha256"],
    );
  } finally {
    fs.rmSync(files.directory, { recursive: true, force: true });
  }
});

test("rejects a non-file staging result without replacing artifacts", () => {
  const files = fixture();
  try {
    assert.throws(
      () => publishNotarizedArchive({
        archive: files.archive,
        app: files.app,
        run(_command, args) {
          fs.mkdirSync(args.at(-1));
        },
      }),
      /not a regular file/,
    );

    assert.equal(fs.readFileSync(files.archive, "utf8"), "old archive");
    assert.equal(fs.readFileSync(files.checksum, "utf8"), "old checksum\n");
    assert.deepEqual(
      fs.readdirSync(files.directory).sort(),
      ["Louder Bridge.app", "Louder-Bridge.zip", "Louder-Bridge.zip.sha256"],
    );
  } finally {
    fs.rmSync(files.directory, { recursive: true, force: true });
  }
});
