#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function commandFailure(args, result) {
  const detail =
    result.error?.message ||
    result.stderr?.trim() ||
    result.stdout?.trim() ||
    `exit ${result.status ?? "unknown"}`;
  return new Error(`GitHub CLI failed (${args.join(" ")}): ${detail}`);
}

export function runGitHub(args, { cwd = projectRoot } = {}) {
  const result = spawnSync("gh", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function releaseFileMetadata(filename, label) {
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} is missing: ${filename}`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${filename}`);
  }
  if (stat.size === 0) {
    throw new Error(`${label} is empty: ${filename}`);
  }
  const digest = createHash("sha256")
    .update(fs.readFileSync(filename))
    .digest("hex");
  return { size: stat.size, digest: `sha256:${digest}` };
}

function readRelease(execute, repository, tag) {
  const args = [
    "release",
    "view",
    tag,
    "--repo",
    repository,
    "--json",
    "isDraft,isPrerelease,tagName,assets",
    "--jq",
    "{draft: .isDraft, prerelease: .isPrerelease, tagName: .tagName, assets: [.assets[] | {name: .name, size: .size, digest: .digest, state: .state}]}",
  ];
  const result = execute(args);
  if (result.status !== 0) {
    if (
      /\b(?:HTTP 404|release not found)\b/i.test(
        `${result.stderr}\n${result.stdout}`,
      )
    ) {
      return null;
    }
    throw commandFailure(args, result);
  }

  try {
    const release = JSON.parse(result.stdout);
    if (
      typeof release !== "object" ||
      release === null ||
      typeof release.draft !== "boolean" ||
      release.tagName !== tag ||
      !Array.isArray(release.assets)
    ) {
      throw new Error("unexpected response shape");
    }
    return release;
  } catch (error) {
    throw new Error(`GitHub returned invalid release metadata: ${error.message}`);
  }
}

function runOrThrow(execute, args) {
  const result = execute(args);
  if (result.status !== 0) throw commandFailure(args, result);
}

function verifyDraftAssets(release, expectedAssets) {
  if (!release?.draft) {
    throw new Error("GitHub did not preserve the release as a draft.");
  }
  const actual = new Map(release.assets.map((asset) => [asset.name, asset]));
  if (actual.size !== release.assets.length) {
    throw new Error("The draft contains a duplicate asset name.");
  }
  const unexpected = [...actual.keys()].filter(
    (name) => !expectedAssets.has(name),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `The draft contains an unexpected asset: ${unexpected.join(", ")}`,
    );
  }
  for (const [name, expected] of expectedAssets) {
    const asset = actual.get(name);
    if (
      asset?.state !== "uploaded" ||
      asset.size !== expected.size ||
      asset.digest !== expected.digest
    ) {
      throw new Error(
        `GitHub did not retain the exact ${name} asset (${expected.size} bytes, ${expected.digest}).`,
      );
    }
  }
}

function verifyResumableDraft(release, expectedNames) {
  const uniqueNames = new Set(release.assets.map((asset) => asset.name));
  if (uniqueNames.size !== release.assets.length) {
    throw new Error("The draft contains a duplicate asset name.");
  }
  const unexpected = release.assets
    .map((asset) => asset.name)
    .filter((name) => !expectedNames.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `The draft contains an unexpected asset: ${unexpected.join(", ")}`,
    );
  }
}

export function publishDraft({
  root = projectRoot,
  tag = process.env.GITHUB_REF_NAME,
  repository = process.env.GITHUB_REPOSITORY,
  execute = (args) => runGitHub(args, { cwd: root }),
} = {}) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const expectedTag = `v${metadata.version}`;
  if (tag !== expectedTag) {
    throw new Error(
      `Release tag ${tag || "(missing)"} does not match package version ${metadata.version}.`,
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("GITHUB_REPOSITORY must identify an owner and repository.");
  }

  const version = metadata.version;
  const notes = path.join(root, "release-notes", `${tag}.md`);
  const archive = path.join(
    root,
    "dist",
    `Louder-Bridge-${version}-macOS-arm64.zip`,
  );
  const artifacts = [
    archive,
    `${archive}.sha256`,
    path.join(root, "dist", `Louder-Bridge-${version}.spdx.json`),
  ];
  releaseFileMetadata(notes, "Release notes");
  const expectedAssets = new Map(
    artifacts.map((filename) => [
      path.basename(filename),
      releaseFileMetadata(filename, "Release artifact"),
    ]),
  );

  const existing = readRelease(execute, repository, tag);
  if (existing && !existing.draft) {
    throw new Error(
      `Release ${tag} is already published. The workflow will not change it.`,
    );
  }
  if (existing) {
    verifyResumableDraft(existing, new Set(expectedAssets.keys()));
  }

  const prerelease = version.startsWith("0.");
  if (existing) {
    runOrThrow(execute, [
      "release",
      "edit",
      tag,
      "--repo",
      repository,
      "--draft=true",
      `--prerelease=${prerelease}`,
      "--verify-tag",
      "--notes-file",
      notes,
    ]);
  } else {
    const createArgs = [
      "release",
      "create",
      tag,
      "--repo",
      repository,
      "--draft",
      "--verify-tag",
      "--notes-file",
      notes,
    ];
    if (prerelease) createArgs.push("--prerelease");
    runOrThrow(execute, createArgs);
  }

  runOrThrow(execute, [
    "release",
    "upload",
    tag,
    "--repo",
    repository,
    ...artifacts,
    "--clobber",
  ]);
  verifyDraftAssets(
    readRelease(execute, repository, tag),
    expectedAssets,
  );
  return { tag, artifacts, resumed: Boolean(existing) };
}

function isMainModule() {
  return (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

if (isMainModule()) {
  try {
    const result = publishDraft();
    const verb = result.resumed ? "updated" : "created";
    console.log(
      `Draft release ${result.tag} ${verb} with ${result.artifacts.length} verified assets.`,
    );
  } catch (error) {
    console.error(`Could not prepare the draft release: ${error.message}`);
    process.exitCode = 1;
  }
}
