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

const identity = process.env.APPLE_SIGNING_IDENTITY;
if (identity) {
  run("/usr/bin/codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    path.join(root, "release", "node.entitlements.plist"),
    "--sign",
    identity,
    transaction.node,
  ]);
  run("/usr/bin/codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    transaction.launcher,
  ]);
  run("/usr/bin/codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    transaction.app,
  ]);
} else {
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    transaction.node,
  ]);
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    transaction.launcher,
  ]);
  run("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    transaction.app,
  ]);
}
run("/usr/bin/codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  transaction.app,
]);
if (identity) {
  const signature = run("/usr/bin/codesign", [
    "-dv",
    "--verbose=4",
    transaction.app,
  ]);
  const detail = `${signature.stdout ?? ""}${signature.stderr ?? ""}`;
  if (
    !detail.includes("Authority=Developer ID Application:") ||
    !/flags=.*runtime/.test(detail)
  ) {
    throw new Error(
      "APPLE_SIGNING_IDENTITY must resolve to a Developer ID Application certificate with the hardened runtime.",
    );
  }
}
run(transaction.launcher, ["--doctor"]);

const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
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
const sbom = run("/usr/bin/env", [
  "npm",
  "sbom",
  "--sbom-format",
  "spdx",
  "--omit",
  "dev",
]);
const sbomFile = path.join(
  dist,
  `Louder-Bridge-${metadata.version}.spdx.json`,
);
fs.writeFileSync(sbomFile, sbom.stdout, { mode: 0o644 });
console.log(`Built ${path.relative(root, archive)}`);
console.log(`Built ${path.relative(root, sbomFile)}`);
console.log(identity ? "Developer ID signature applied." : "Ad hoc signature applied.");
