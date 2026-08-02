#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  commitApplicationBundle,
  installApplicationBundle,
} from "../src/setup/application-bundle.mjs";
import { compileNativeLauncher } from "../src/setup/native-launcher.mjs";
import { addBundledComponents } from "./spdx-sbom.mjs";
import {
  requireCleanSignedSource,
  sourceRevision,
} from "./source-revision.mjs";
import {
  requireDeveloperIdSignature,
  requireHardenedRuntime,
} from "./code-signature.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const stagingHome = path.join(dist, "staging");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.stderr?.trim() || `exit ${result.status}`}`,
    );
  }
  return result;
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Release bundles must be built on an Apple Silicon Mac.");
}

const identity = process.env.APPLE_SIGNING_IDENTITY;
const revision = sourceRevision({ root });
requireCleanSignedSource(revision, Boolean(identity));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stagingHome, { recursive: true });
const transaction = installApplicationBundle({
  homeDirectory: stagingHome,
  sourceRoot: root,
});
commitApplicationBundle(transaction);

compileNativeLauncher({
  sourceRoot: root,
  output: transaction.launcher,
});

const signingIdentity = identity ?? "-";
const signingOptions = [
  "--force",
  "--options",
  "runtime",
  ...(identity ? ["--timestamp"] : []),
  "--sign",
  signingIdentity,
];
run("/usr/bin/codesign", [
  ...signingOptions.slice(0, -2),
  "--entitlements",
  path.join(root, "release", "node.entitlements.plist"),
  ...signingOptions.slice(-2),
  transaction.node,
]);
run("/usr/bin/codesign", [
  ...signingOptions,
  transaction.launcher,
]);
run("/usr/bin/codesign", [
  ...signingOptions,
  transaction.app,
]);
run("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  transaction.app,
]);
const signature = run("/usr/bin/codesign", [
  "-dv",
  "--verbose=4",
  transaction.app,
]);
const detail = `${signature.stdout ?? ""}${signature.stderr ?? ""}`;
if (identity) {
  requireDeveloperIdSignature(detail, { label: "Louder Bridge app" });
} else {
  requireHardenedRuntime(detail, "Louder Bridge app");
}
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const smokeTest = run(transaction.launcher, ["--version"]);
if (smokeTest.stdout.trim() !== metadata.version) {
  throw new Error(
    "The signed launcher did not start the embedded Node.js runtime.",
  );
}
run(transaction.launcher, ["--package-preflight"]);
const archive = path.join(
  dist,
  `Louder-Bridge-${metadata.version}-macOS-arm64.zip`,
);
run("/usr/bin/ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  transaction.app,
  archive,
]);

const digest = createHash("sha256")
  .update(fs.readFileSync(archive))
  .digest("hex");
fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`, {
  mode: 0o644,
});
const generatedSbom = run("/usr/bin/env", [
  "npm",
  "sbom",
  "--sbom-format",
  "spdx",
  "--omit",
  "dev",
]);
const nodeSha256 = createHash("sha256")
  .update(fs.readFileSync(transaction.node))
  .digest("hex");
const sbomFile = path.join(
  dist,
  `Louder-Bridge-${metadata.version}.spdx.json`,
);
const sbom = addBundledComponents(JSON.parse(generatedSbom.stdout), {
  metadata,
  nodeVersion: process.version,
  nodeSha256,
  sourceRevision: revision,
});
fs.writeFileSync(sbomFile, `${JSON.stringify(sbom, null, 2)}\n`, {
  mode: 0o644,
});
console.log(`Built ${path.relative(root, archive)}`);
console.log(`Built ${path.relative(root, sbomFile)}`);
console.log(identity ? "Developer ID signature applied." : "Ad hoc signature applied.");
