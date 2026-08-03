import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publishDraft } from "../scripts/publish-release.mjs";

function makeProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "louder-publish-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "release-notes"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "0.1.0" }),
  );
  fs.writeFileSync(path.join(root, "release-notes", "v0.1.0.md"), "Notes\n");
  for (const [name, contents] of [
    ["Louder-Bridge-0.1.0-macOS-arm64.zip", "archive"],
    ["Louder-Bridge-0.1.0-macOS-arm64.zip.sha256", "checksum"],
    ["Louder-Bridge-0.1.0.spdx.json", "sbom"],
  ]) {
    fs.writeFileSync(path.join(root, "dist", name), contents);
  }
  return root;
}

function releaseFor(root, { draft = true, assets } = {}) {
  const names = [
    "Louder-Bridge-0.1.0-macOS-arm64.zip",
    "Louder-Bridge-0.1.0-macOS-arm64.zip.sha256",
    "Louder-Bridge-0.1.0.spdx.json",
  ];
  return JSON.stringify({
    draft,
    prerelease: true,
    tagName: "v0.1.0",
    assets:
      assets ??
      names.map((name) => ({
        name,
        size: fs.statSync(path.join(root, "dist", name)).size,
      })),
  });
}

function response({ status = 0, stdout = "", stderr = "" } = {}) {
  return { status, stdout, stderr };
}

function scripted(responses) {
  const calls = [];
  return {
    calls,
    execute(args) {
      calls.push(args);
      const next = responses.shift();
      assert.ok(next, `Unexpected gh call: ${args.join(" ")}`);
      return next;
    },
  };
}

test("creates a new draft and verifies the uploaded assets", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({ status: 1, stderr: "gh: Not Found (HTTP 404)" }),
    response(),
    response(),
    response({ stdout: releaseFor(root) }),
  ]);

  const result = publishDraft({
    root,
    tag: "v0.1.0",
    repository: "vxcozy/louder-bridge",
    execute: gh.execute,
  });

  assert.equal(result.resumed, false);
  assert.deepEqual(gh.calls[1].slice(0, 5), [
    "release",
    "create",
    "v0.1.0",
    "--repo",
    "vxcozy/louder-bridge",
  ]);
  assert.ok(gh.calls[1].includes("--draft"));
  assert.ok(gh.calls[1].includes("--verify-tag"));
  assert.ok(gh.calls[1].includes("--prerelease"));
  assert.deepEqual(gh.calls[2].slice(0, 3), [
    "release",
    "upload",
    "v0.1.0",
  ]);
  assert.ok(gh.calls[2].includes("--repo"));
  assert.equal(gh.calls[2].at(-1), "--clobber");
  assert.equal(gh.calls.length, 4);
});

test("resumes a draft and replaces only expected assets", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({
      stdout: releaseFor(root, {
        assets: [
          {
            name: "Louder-Bridge-0.1.0-macOS-arm64.zip",
            size: 1,
          },
        ],
      }),
    }),
    response(),
    response(),
    response({ stdout: releaseFor(root) }),
  ]);

  const result = publishDraft({
    root,
    tag: "v0.1.0",
    repository: "vxcozy/louder-bridge",
    execute: gh.execute,
  });

  assert.equal(result.resumed, true);
  assert.deepEqual(gh.calls[1].slice(0, 3), [
    "release",
    "edit",
    "v0.1.0",
  ]);
  assert.ok(gh.calls[1].includes("--draft=true"));
  assert.ok(gh.calls[1].includes("--prerelease=true"));
  assert.equal(gh.calls.length, 4);
});

test("refuses to change a published release", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({ stdout: releaseFor(root, { draft: false }) }),
  ]);

  assert.throws(
    () =>
      publishDraft({
        root,
        tag: "v0.1.0",
        repository: "vxcozy/louder-bridge",
        execute: gh.execute,
      }),
    /already published.*will not change it/,
  );
  assert.equal(gh.calls.length, 1);
});

test("refuses a draft containing an unexpected asset", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({
      stdout: releaseFor(root, {
        assets: [{ name: "unreviewed.txt", size: 10 }],
      }),
    }),
  ]);

  assert.throws(
    () =>
      publishDraft({
        root,
        tag: "v0.1.0",
        repository: "vxcozy/louder-bridge",
        execute: gh.execute,
      }),
    /unexpected asset: unreviewed\.txt/,
  );
  assert.equal(gh.calls.length, 1);
});

test("does not treat GitHub API failures as a missing release", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({ status: 1, stderr: "gh: Forbidden (HTTP 403)" }),
  ]);

  assert.throws(
    () =>
      publishDraft({
        root,
        tag: "v0.1.0",
        repository: "vxcozy/louder-bridge",
        execute: gh.execute,
      }),
    /HTTP 403/,
  );
  assert.equal(gh.calls.length, 1);
});

test("checks the remote asset sizes after upload", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({ status: 1, stderr: "gh: Not Found (HTTP 404)" }),
    response(),
    response(),
    response({
      stdout: releaseFor(root, {
        assets: [
          {
            name: "Louder-Bridge-0.1.0-macOS-arm64.zip",
            size: 1,
          },
        ],
      }),
    }),
  ]);

  assert.throws(
    () =>
      publishDraft({
        root,
        tag: "v0.1.0",
        repository: "vxcozy/louder-bridge",
        execute: gh.execute,
      }),
    /did not retain the expected.*asset/,
  );
});

test("leaves an interrupted draft for the next run to resume", (t) => {
  const root = makeProject(t);
  const gh = scripted([
    response({ status: 1, stderr: "gh: Not Found (HTTP 404)" }),
    response(),
    response({ status: 1, stderr: "upload interrupted" }),
  ]);

  assert.throws(
    () =>
      publishDraft({
        root,
        tag: "v0.1.0",
        repository: "vxcozy/louder-bridge",
        execute: gh.execute,
      }),
    /upload interrupted/,
  );
  assert.deepEqual(gh.calls[2].slice(0, 3), [
    "release",
    "upload",
    "v0.1.0",
  ]);
  assert.equal(gh.calls.length, 3);
});

test("checks local files before contacting GitHub", (t) => {
  const root = makeProject(t);
  fs.unlinkSync(
    path.join(root, "dist", "Louder-Bridge-0.1.0.spdx.json"),
  );
  const gh = scripted([]);

  assert.throws(
    () =>
      publishDraft({
        root,
        tag: "v0.1.0",
        repository: "vxcozy/louder-bridge",
        execute: gh.execute,
      }),
    /Release artifact is missing/,
  );
  assert.equal(gh.calls.length, 0);
});
