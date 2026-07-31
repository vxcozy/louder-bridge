import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const script = path.join(root, "scripts", "release-check.mjs");

function run(refName) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: refName,
    },
  });
}

test("requires the release tag to match the package version", () => {
  const matching = run("v0.1.0");
  assert.equal(matching.status, 0, matching.stderr);

  const mismatched = run("v0.1.1");
  assert.equal(mismatched.status, 1);
  assert.match(
    mismatched.stderr,
    /Release tag v0\.1\.1 does not match package version 0\.1\.0/,
  );
});
