import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applicationBundlePaths,
  applicationBundlePathsForCli,
  commitApplicationBundle,
  installApplicationBundle,
  rollbackApplicationBundle,
  stageApplicationBundleRemoval,
} from "../src/setup/application-bundle.mjs";

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
  assert.match(fs.readFileSync(transaction.launcher, "utf8"), /cli\.mjs/);
  assert.match(fs.readFileSync(transaction.launcher, "utf8"), /activate/);
  assert.equal(fs.statSync(transaction.node).mode & 0o777, 0o755);
  assert.equal(transaction.backup, null);
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
  fs.mkdirSync(paths.app, { recursive: true });
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

test("stages application removal so it can be restored", () => {
  const { root, home } = fixture();
  const paths = applicationBundlePaths(home);
  fs.mkdirSync(paths.app, { recursive: true });
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
