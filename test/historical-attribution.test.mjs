import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { historicalAttributionFindings } from "../scripts/historical-attribution.mjs";

function git(repository, arguments_) {
  const result = spawnSync("/usr/bin/git", ["-C", repository, ...arguments_], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}

test("finds attribution in a file removed from reachable history", () => {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-attribution-history-"),
  );
  git(repository, ["init", "--quiet"]);
  const fixture = `${"Generated"} by ChatGPT\n`;
  fs.writeFileSync(path.join(repository, "public.txt"), fixture);
  git(repository, ["add", "."]);
  git(repository, [
    "-c",
    "user.name=Test Maintainer",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Add fixtures",
  ]);
  fs.rmSync(path.join(repository, "public.txt"));
  git(repository, ["add", "--all"]);
  git(repository, [
    "-c",
    "user.name=Test Maintainer",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Remove fixtures",
  ]);

  const findings = historicalAttributionFindings(repository);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /public\.txt: automated authorship attribution/);
  fs.rmSync(repository, { recursive: true, force: true });
});
