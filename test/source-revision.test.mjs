import test from "node:test";
import assert from "node:assert/strict";
import {
  requireCleanSignedSource,
  sourceRevision,
} from "../scripts/source-revision.mjs";

const revision = "a".repeat(40);

function gitFixture(statusOutput = "") {
  const calls = [];
  return {
    calls,
    run(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: args[0] === "rev-parse" ? `${revision}\n` : statusOutput,
        stderr: "",
      };
    },
  };
}

test("reports clean and dirty source revisions", () => {
  const clean = gitFixture();
  assert.equal(
    sourceRevision({ root: "/source", run: clean.run }),
    revision,
  );
  assert.deepEqual(clean.calls, [
    {
      command: "/usr/bin/git",
      args: ["rev-parse", "HEAD"],
      options: { cwd: "/source", encoding: "utf8" },
    },
    {
      command: "/usr/bin/git",
      args: ["status", "--porcelain=v1", "--untracked-files=normal"],
      options: { cwd: "/source", encoding: "utf8" },
    },
  ]);

  const dirty = gitFixture(" M src/cli.mjs\n");
  assert.equal(
    sourceRevision({ root: "/source", run: dirty.run }),
    `${revision}+dirty`,
  );
});

test("rejects an unavailable or invalid source revision", () => {
  assert.throws(
    () => sourceRevision({
      root: "/source",
      run() {
        return { status: 1, stdout: "", stderr: "not a repository" };
      },
    }),
    /source revision check failed: not a repository/,
  );
  assert.throws(
    () => sourceRevision({
      root: "/source",
      run() {
        return { status: 0, stdout: "main\n", stderr: "" };
      },
    }),
    /invalid source revision/,
  );
});

test("requires clean source for Developer ID releases", () => {
  assert.doesNotThrow(() => requireCleanSignedSource(revision, true));
  assert.doesNotThrow(
    () => requireCleanSignedSource(`${revision}+dirty`, false),
  );
  assert.throws(
    () => requireCleanSignedSource(`${revision}+dirty`, true),
    /require a clean Git checkout/,
  );
});
