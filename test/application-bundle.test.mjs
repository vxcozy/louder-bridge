import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applicationInfoPlist,
  applicationBundlePaths,
  applicationBundlePathsForCli,
  commitApplicationBundle,
  installApplicationBundle,
  rollbackApplicationBundle,
  stageApplicationBundleRemoval,
} from "../src/setup/application-bundle.mjs";

function writeOwnedBundle(app, marker) {
  fs.mkdirSync(path.join(app, "Contents"), { recursive: true });
  fs.writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    applicationInfoPlist({ version: "0.9.0" }),
  );
  if (marker) fs.writeFileSync(path.join(app, marker), marker);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "louder-bundle-"));
  const home = path.join(root, "home");
  const source = path.join(root, "source");
  const node = path.join(root, "node");
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.writeFileSync(path.join(source, "src", "cli.mjs"), "export {};\n");
  fs.writeFileSync(path.join(source, "src", "hook.mjs"), "export {};\n");
  fs.writeFileSync(
    path.join(source, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  fs.writeFileSync(path.join(source, "LICENSE"), "project license");
  fs.mkdirSync(path.join(source, "THIRD_PARTY_LICENSES"));
  fs.writeFileSync(
    path.join(source, "THIRD_PARTY_LICENSES", "Protocol-LICENSE"),
    "protocol license",
  );
  fs.writeFileSync(node, "node fixture");
  fs.writeFileSync(path.join(root, "LICENSE"), "node license");
  return { root, home, source, node };
}

test("installs a self-contained application bundle", () => {
  const { root, home, source, node } = fixture();
  const transaction = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });

  assert.equal(fs.existsSync(transaction.node), true);
  assert.equal(fs.existsSync(transaction.cli), true);
  assert.equal(fs.existsSync(transaction.hook), true);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(path.join(transaction.resources, "package.json"), "utf8"),
    ),
    { version: "1.2.3" },
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        transaction.resources,
        "THIRD_PARTY_LICENSES",
        "Node.js-LICENSE",
      ),
      "utf8",
    ),
    "node license",
  );
  assert.equal(
    fs.readFileSync(
      path.join(
        transaction.resources,
        "THIRD_PARTY_LICENSES",
        "Protocol-LICENSE",
      ),
      "utf8",
    ),
    "protocol license",
  );
  const infoPlist = fs.readFileSync(transaction.infoPlist, "utf8");
  assert.match(infoPlist, /1\.2\.3/);
  assert.match(
    infoPlist,
    /<key>LSMinimumSystemVersion<\/key>\s*<string>15\.0<\/string>/,
  );
  assert.match(
    infoPlist,
    /<key>NSAccessibilityUsageDescription<\/key>/,
  );
  assert.match(infoPlist, /<key>NSAppleEventsUsageDescription<\/key>/);
  assert.match(infoPlist, /focus the terminal selected on the Codex Micro/);
  assert.match(fs.readFileSync(transaction.launcher, "utf8"), /cli\.mjs/);
  assert.match(fs.readFileSync(transaction.launcher, "utf8"), /activate/);
  assert.equal(fs.statSync(transaction.node).mode & 0o777, 0o755);
  assert.equal(transaction.backup, null);
  fs.rmSync(root, { recursive: true });
});

test("records the source revision in the installed app", () => {
  const { root, home, source, node } = fixture();
  const buildRevision = `${"a".repeat(40)}+dirty`;
  const transaction = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
    buildRevision,
  });
  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(transaction.resources, "package.json"),
      "utf8",
    ),
  );

  assert.equal(metadata.louderBridge.buildRevision, buildRevision);
  rollbackApplicationBundle(transaction);
  fs.rmSync(root, { recursive: true });
});

test("rejects an invalid application build revision before staging", () => {
  const { root, home, source, node } = fixture();

  assert.throws(
    () => installApplicationBundle({
      homeDirectory: home,
      sourceRoot: source,
      nodePath: node,
      buildRevision: "main",
    }),
    /build revision is invalid/,
  );
  assert.equal(fs.existsSync(applicationBundlePaths(home).app), false);
  fs.rmSync(root, { recursive: true });
});

test("derives installed runtime paths from its CLI module", () => {
  const paths = applicationBundlePathsForCli(
    "/Applications/Louder Bridge.app/Contents/Resources/app/src/cli.mjs",
  );
  assert.equal(paths.app, "/Applications/Louder Bridge.app");
  assert.equal(
    paths.node,
    "/Applications/Louder Bridge.app/Contents/MacOS/node",
  );
});

test("can roll back or commit an application update", () => {
  const { root, home, source, node } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app);
  fs.writeFileSync(path.join(paths.app, "old"), "old");

  const rolledBack = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });
  rollbackApplicationBundle(rolledBack);
  assert.equal(fs.readFileSync(path.join(paths.app, "old"), "utf8"), "old");

  const committed = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });
  commitApplicationBundle(committed);
  assert.equal(fs.existsSync(committed.backup), false);
  assert.equal(fs.existsSync(paths.cli), true);
  fs.rmSync(root, { recursive: true });
});

test("prepares the complete bundle before replacing the installed app", () => {
  const { root, home, source, node } = fixture();
  const installed = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });
  commitApplicationBundle(installed);
  const originalPackage = fs.readFileSync(
    path.join(installed.resources, "package.json"),
    "utf8",
  );

  assert.throws(
    () =>
      installApplicationBundle({
        homeDirectory: home,
        sourceRoot: source,
        nodePath: node,
        prepare(staged) {
          assert.notEqual(staged.app, installed.app);
          assert.equal(fs.existsSync(installed.app), true);
          throw new Error("preparation failed");
        },
      }),
    /preparation failed/,
  );

  assert.equal(
    fs.readFileSync(
      path.join(installed.resources, "package.json"),
      "utf8",
    ),
    originalPackage,
  );
  assert.deepEqual(
    fs
      .readdirSync(path.join(home, "Applications"))
      .filter((name) => name.includes(".tmp")),
    [],
  );
  fs.rmSync(root, { recursive: true });
});

test("keeps the installed app when the pre-replacement handoff fails", () => {
  const { root, home, source, node } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app);
  fs.writeFileSync(path.join(paths.app, "marker"), "previous app");

  assert.throws(
    () =>
      installApplicationBundle({
        homeDirectory: home,
        sourceRoot: source,
        nodePath: node,
        beforeReplace(staged) {
          assert.equal(fs.existsSync(staged.cli), true);
          assert.equal(
            fs.readFileSync(path.join(paths.app, "marker"), "utf8"),
            "previous app",
          );
          throw new Error("handoff failed");
        },
      }),
    /handoff failed/,
  );

  assert.equal(
    fs.readFileSync(path.join(paths.app, "marker"), "utf8"),
    "previous app",
  );
  assert.deepEqual(
    fs
      .readdirSync(path.join(home, "Applications"))
      .filter((name) => name.includes(".tmp")),
    [],
  );
  fs.rmSync(root, { recursive: true });
});

test("stages application removal so it can be restored", () => {
  const { root, home } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app);
  fs.writeFileSync(path.join(paths.app, "marker"), "present");

  const removal = stageApplicationBundleRemoval({ homeDirectory: home });
  assert.equal(fs.existsSync(paths.app), false);
  rollbackApplicationBundle(removal);
  assert.equal(
    fs.readFileSync(path.join(paths.app, "marker"), "utf8"),
    "present",
  );
  fs.rmSync(root, { recursive: true });
});

test("refuses to replace an unrelated application directory", () => {
  const { root, home, source, node } = fixture();
  const paths = applicationBundlePaths(home);
  fs.mkdirSync(paths.app, { recursive: true });
  fs.writeFileSync(path.join(paths.app, "marker"), "unrelated app");
  let handoffCalled = false;

  assert.throws(
    () =>
      installApplicationBundle({
        homeDirectory: home,
        sourceRoot: source,
        nodePath: node,
        beforeReplace() {
          handoffCalled = true;
        },
      }),
    /does not match Louder Bridge/,
  );

  assert.equal(handoffCalled, false);
  assert.equal(
    fs.readFileSync(path.join(paths.app, "marker"), "utf8"),
    "unrelated app",
  );
  fs.rmSync(root, { recursive: true });
});

test("refuses to stage an unrelated application or symlink for removal", () => {
  const { root, home } = fixture();
  const paths = applicationBundlePaths(home);
  const unrelated = path.join(root, "unrelated");
  fs.mkdirSync(unrelated);
  fs.mkdirSync(path.dirname(paths.app), { recursive: true });
  fs.symlinkSync(unrelated, paths.app);

  assert.throws(
    () => stageApplicationBundleRemoval({ homeDirectory: home }),
    /does not match Louder Bridge/,
  );
  assert.equal(fs.lstatSync(paths.app).isSymbolicLink(), true);
  assert.equal(fs.existsSync(unrelated), true);
  fs.rmSync(root, { recursive: true });
});

test("rollback leaves a replacement at the application path untouched", () => {
  const { root, home, source, node } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app, "previous");
  const transaction = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });
  const installedElsewhere = path.join(root, "installed-elsewhere");
  fs.renameSync(paths.app, installedElsewhere);
  fs.mkdirSync(paths.app);
  fs.writeFileSync(path.join(paths.app, "marker"), "replacement");

  assert.throws(
    () => rollbackApplicationBundle(transaction),
    /changed during rollback.*left untouched/,
  );
  assert.equal(
    fs.readFileSync(path.join(paths.app, "marker"), "utf8"),
    "replacement",
  );
  assert.equal(fs.existsSync(transaction.backup), true);
  fs.rmSync(root, { recursive: true });
});

test("commit leaves a changed application backup untouched", () => {
  const { root, home, source, node } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app, "previous");
  const transaction = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });
  fs.renameSync(transaction.backup, path.join(root, "original-backup"));
  fs.mkdirSync(transaction.backup);
  fs.writeFileSync(path.join(transaction.backup, "marker"), "replacement");

  assert.throws(
    () => commitApplicationBundle(transaction),
    /backup changed.*left untouched/,
  );
  assert.equal(
    fs.readFileSync(path.join(transaction.backup, "marker"), "utf8"),
    "replacement",
  );
  fs.rmSync(root, { recursive: true });
});

test("rollback keeps the installed app when its backup is missing", () => {
  const { root, home, source, node } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app, "previous");
  const transaction = installApplicationBundle({
    homeDirectory: home,
    sourceRoot: source,
    nodePath: node,
  });
  fs.renameSync(transaction.backup, path.join(root, "missing-backup"));

  assert.throws(
    () => rollbackApplicationBundle(transaction),
    /backup is missing.*installed app untouched/,
  );
  assert.equal(fs.existsSync(paths.cli), true);
  fs.rmSync(root, { recursive: true });
});

test("removal rollback does not delete an item that appeared later", () => {
  const { root, home } = fixture();
  const paths = applicationBundlePaths(home);
  writeOwnedBundle(paths.app, "original");
  const transaction = stageApplicationBundleRemoval({ homeDirectory: home });
  fs.mkdirSync(paths.app);
  fs.writeFileSync(path.join(paths.app, "marker"), "new item");

  assert.throws(
    () => rollbackApplicationBundle(transaction),
    /became occupied.*left untouched/,
  );
  assert.equal(
    fs.readFileSync(path.join(paths.app, "marker"), "utf8"),
    "new item",
  );
  assert.equal(fs.existsSync(transaction.backup), true);
  fs.rmSync(root, { recursive: true });
});
