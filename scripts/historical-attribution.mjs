import { spawnSync } from "node:child_process";
import { findAttribution } from "../src/policy/attribution.mjs";

const allowedPolicyFixtureObjects = new Set([
  "9933928d79af6f4600c452acd665608549803106",
]);

function runGit(
  repository,
  arguments_,
  { encoding = "utf8", input } = {},
) {
  const result = spawnSync("/usr/bin/git", ["-C", repository, ...arguments_], {
    encoding,
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      `git ${arguments_[0]} failed: ${result.stderr?.toString().trim() || result.error?.message || `exit ${result.status}`}`,
    );
  }
  return result.stdout;
}

function historicalBlobs(repository) {
  const commits = runGit(repository, ["rev-list", "--all"])
    .trim()
    .split("\n")
    .filter(Boolean);
  const blobs = new Map();
  for (const commit of commits) {
    const tree = runGit(
      repository,
      ["ls-tree", "-r", "-z", "--full-tree", commit],
      { encoding: "buffer" },
    );
    for (const record of tree.toString("utf8").split("\0")) {
      if (!record) continue;
      const separator = record.indexOf("\t");
      if (separator < 0) {
        throw new Error("git ls-tree returned an invalid record.");
      }
      const [mode, type, object] = record.slice(0, separator).split(" ");
      const filename = record.slice(separator + 1);
      if (
        !/^\d{6}$/.test(mode) ||
        type !== "blob" ||
        !/^[a-f0-9]{40,64}$/.test(object)
      ) {
        throw new Error("git ls-tree returned invalid blob metadata.");
      }
      if (!blobs.has(object)) blobs.set(object, new Set());
      blobs.get(object).add(filename);
    }
  }
  return blobs;
}

function readBlobBatch(repository, objects) {
  if (objects.length === 0) return new Map();
  const output = runGit(repository, ["cat-file", "--batch"], {
    encoding: "buffer",
    input: Buffer.from(`${objects.join("\n")}\n`),
  });
  const contents = new Map();
  let offset = 0;
  for (const expectedObject of objects) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) {
      throw new Error("git cat-file returned an incomplete header.");
    }
    const [object, type, sizeText] = output
      .subarray(offset, headerEnd)
      .toString("utf8")
      .split(" ");
    const size = Number(sizeText);
    if (
      object !== expectedObject ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0
    ) {
      throw new Error("git cat-file returned invalid blob metadata.");
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error("git cat-file returned incomplete blob content.");
    }
    contents.set(object, output.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  if (offset !== output.length) {
    throw new Error("git cat-file returned unexpected trailing data.");
  }
  return contents;
}

export function historicalAttributionFindings(repository) {
  const findings = [];
  const targets = [];
  for (const [object, paths] of historicalBlobs(repository)) {
    if (allowedPolicyFixtureObjects.has(object)) continue;
    targets.push({ object, filename: paths.values().next().value });
  }
  const blobs = readBlobBatch(
    repository,
    targets.map(({ object }) => object),
  );
  for (const { object, filename } of targets) {
    const contents = blobs.get(object);
    if (!contents) throw new Error("A historical blob could not be read.");
    if (contents.includes(0)) continue;
    const finding = findAttribution(contents.toString("utf8"));
    if (finding) findings.push(`${object} ${filename}: ${finding}`);
  }
  return findings;
}
