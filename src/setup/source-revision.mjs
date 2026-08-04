import { spawnSync } from "node:child_process";

function runGit(root, args, run) {
  const result = run("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`Git source revision check failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

export function sourceRevision({ root, run = spawnSync }) {
  const revision = runGit(root, ["rev-parse", "HEAD"], run);
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error("Git returned an invalid source revision.");
  }
  const changes = runGit(
    root,
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    run,
  );
  return changes ? `${revision}+dirty` : revision;
}

export function requireCleanSignedSource(revision, required) {
  if (required && revision.endsWith("+dirty")) {
    throw new Error("Developer ID release builds require a clean Git checkout.");
  }
}
