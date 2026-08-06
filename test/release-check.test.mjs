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

function run(refName, { branchRef = "HEAD" } = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_REF_TYPE: "tag",
      GITHUB_REF_NAME: refName,
      ...(branchRef === null
        ? { LOUDER_RELEASE_BRANCH_REF: "" }
        : { LOUDER_RELEASE_BRANCH_REF: branchRef }),
    },
  });
}

test("requires the release tag to match the package version", () => {
  const matching = run("v0.3.0");
  assert.equal(matching.status, 0, matching.stderr);

  const mismatched = run("v0.1.0");
  assert.equal(mismatched.status, 1);
  assert.match(
    mismatched.stderr,
    /Release tag v0\.1\.0 does not match package version 0\.3\.0/,
  );
});

test("requires the release tag commit to belong to the protected branch", () => {
  const outsideBranch = run("v0.3.0", { branchRef: "HEAD^" });
  assert.equal(outsideBranch.status, 1);
  assert.match(
    outsideBranch.stderr,
    /release tag commit is not part of HEAD\^/,
  );

  const missingBranch = run("v0.3.0", { branchRef: null });
  assert.equal(missingBranch.status, 1);
  assert.match(
    missingBranch.stderr,
    /protected release branch reference is unavailable/,
  );
});
