#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bundledComponentIds } from "./spdx-sbom.mjs";
import { assertBundledLicense } from "./bundled-license.mjs";
import {
  requireCleanSignedSource,
  sourceRevision,
} from "./source-revision.mjs";
import {
  assertRegularArchiveTree,
  validateArchiveEntries,
  validateArchiveSummary,
} from "./archive-safety.mjs";
import {
  requireDeveloperIdSignature,
  requireHardenedRuntime,
} from "./code-signature.mjs";
import { requireNativeHardening } from "./native-hardening.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const archive = path.join(
  dist,
  `Louder-Bridge-${metadata.version}-macOS-arm64.zip`,
);
const checksum = `${archive}.sha256`;
const sbomFile = path.join(
  dist,
  `Louder-Bridge-${metadata.version}.spdx.json`,
);
const revision = sourceRevision({ root });
requireCleanSignedSource(
  revision,
  process.env.LOUDER_REQUIRE_NOTARIZED === "1",
);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`}`,
    );
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

for (const filename of [archive, checksum, sbomFile]) {
  if (!fs.existsSync(filename)) {
    throw new Error(`Release artifact is missing: ${path.relative(root, filename)}`);
  }
}

const checksumParts = fs.readFileSync(checksum, "utf8").trim().split(/\s+/);
if (
  checksumParts.length !== 2 ||
  !/^[a-f0-9]{64}$/.test(checksumParts[0]) ||
  checksumParts[1] !== path.basename(archive)
) {
  throw new Error("The SHA-256 file has an invalid digest or archive name.");
}
const expectedDigest = checksumParts[0];
const actualDigest = createHash("sha256")
  .update(fs.readFileSync(archive))
  .digest("hex");
if (actualDigest !== expectedDigest) {
  throw new Error("The release archive does not match its SHA-256 checksum.");
}

const sbom = JSON.parse(fs.readFileSync(sbomFile, "utf8"));
if (sbom.spdxVersion !== "SPDX-2.3" || !Array.isArray(sbom.packages)) {
  throw new Error("The release SBOM is not valid SPDX 2.3 JSON.");
}
const projectPackage = sbom.packages.find(
  (entry) =>
    entry.name === metadata.name &&
    entry.versionInfo === metadata.version,
);
if (!projectPackage) {
  throw new Error(
    "The release SBOM does not identify the package name and version.",
  );
}
if (
  projectPackage.primaryPackagePurpose !== "APPLICATION" ||
  projectPackage.sourceInfo !== `Built from Git revision ${revision}.`
) {
  throw new Error(
    "The release SBOM does not match this application source revision.",
  );
}
for (const [label, identifier] of Object.entries(bundledComponentIds)) {
  if (!sbom.packages.some((entry) => entry.SPDXID === identifier)) {
    throw new Error(`The release SBOM does not identify the ${label} component.`);
  }
}
const nodePackage = sbom.packages.find(
  (entry) => entry.SPDXID === bundledComponentIds.node,
);
const nodeChecksum = nodePackage?.checksums?.find(
  (entry) => entry.algorithm === "SHA256",
)?.checksumValue;
if (!/^[a-f0-9]{64}$/.test(nodeChecksum ?? "")) {
  throw new Error("The release SBOM does not contain the Node.js SHA-256.");
}
const rootSpdxId = projectPackage.SPDXID;
for (const [identifier, relationshipType] of [
  [bundledComponentIds.node, "CONTAINS"],
  [bundledComponentIds.protocol, "OTHER"],
]) {
  if (
    !sbom.relationships?.some(
      (entry) =>
        entry.spdxElementId === rootSpdxId &&
        entry.relatedSpdxElement === identifier &&
        entry.relationshipType === relationshipType,
    )
  ) {
    throw new Error(
      `The release SBOM does not relate ${identifier} to the app.`,
    );
  }
}

const extracted = fs.mkdtempSync(
  path.join(os.tmpdir(), "louder-release-verify-"),
);
try {
  const archiveSummary = run("/usr/bin/unzip", ["-Z", "-t", archive]);
  const archiveListing = run("/usr/bin/unzip", ["-Z1", archive]);
  const archiveEntries = validateArchiveEntries(archiveListing);
  validateArchiveSummary(archiveSummary, {
    expectedEntries: archiveEntries.length,
  });
  run("/usr/bin/unzip", ["-tq", archive]);
  run("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
  assertRegularArchiveTree(extracted);
  const app = path.join(extracted, "Louder Bridge.app");
  if (!fs.existsSync(app)) {
    throw new Error("The release archive does not contain Louder Bridge.app.");
  }
  const resources = path.join(app, "Contents", "Resources", "app");
  assertBundledLicense(path.join(resources, "LICENSE"), {
    expectedContents: fs.readFileSync(path.join(root, "LICENSE"), "utf8"),
    label: "project license",
  });
  assertBundledLicense(
    path.join(resources, "THIRD_PARTY_LICENSES", "FreeMicro-LICENSE"),
    {
      expectedContents: fs.readFileSync(
        path.join(root, "THIRD_PARTY_LICENSES", "FreeMicro-LICENSE"),
        "utf8",
      ),
      label: "Codex Micro protocol license",
    },
  );
  assertBundledLicense(
    path.join(resources, "THIRD_PARTY_LICENSES", "Node.js-LICENSE"),
    {
      label: "Node.js license",
      minimumBytes: 512,
    },
  );

  run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    app,
  ]);
  const appSignature = run("/usr/bin/codesign", [
    "-dv",
    "--verbose=4",
    app,
  ]);
  requireHardenedRuntime(appSignature, "Louder Bridge app");
  const launcher = path.join(app, "Contents", "MacOS", "LouderBridge");
  const node = path.join(app, "Contents", "MacOS", "node");
  for (const args of [
    ["--test-micro-frame", "usb", "{}"],
    ["--test-micro-command", "{}"],
    ["--test-composer-gesture", "hold"],
    ["--test-permission-wait", "grant"],
    ["--test-input-monitoring-request", "grant"],
  ]) {
    const result = spawnSync(launcher, args, { encoding: "utf8" });
    if (
      result.status !== 2 ||
      !result.stderr?.includes("Unknown Louder Bridge option")
    ) {
      throw new Error(
        `The release launcher exposes the ${args[0]} test interface.`,
      );
    }
  }
  requireNativeHardening(
    run("/usr/bin/nm", ["-u", launcher]),
    "Louder Bridge launcher",
  );
  const extractedNodeChecksum = createHash("sha256")
    .update(fs.readFileSync(node))
    .digest("hex");
  if (extractedNodeChecksum !== nodeChecksum) {
    throw new Error("The embedded Node.js runtime does not match the SBOM.");
  }
  const executableSignatures = new Map();
  for (const executable of [launcher, node]) {
    const architectures = run("/usr/bin/lipo", ["-archs", executable]).trim();
    if (architectures !== "arm64") {
      throw new Error(
        `${path.basename(executable)} is not an arm64-only executable.`,
      );
    }
    const signature = run("/usr/bin/codesign", [
      "-dv",
      "--verbose=4",
      executable,
    ]);
    const label = path.basename(executable) === "node"
      ? "Embedded Node.js runtime"
      : "Louder Bridge launcher";
    requireHardenedRuntime(signature, label);
    executableSignatures.set(executable, { detail: signature, label });
  }
  const nodeEntitlements = run("/usr/bin/codesign", [
    "-d",
    "--entitlements",
    "-",
    node,
  ]);
  if (!nodeEntitlements.includes("com.apple.security.cs.allow-jit")) {
    throw new Error(
      "The embedded Node.js runtime is missing its JIT entitlement.",
    );
  }
  if (
    nodeEntitlements.includes(
      "com.apple.security.cs.disable-library-validation",
    )
  ) {
    throw new Error(
      "The embedded Node.js runtime must not disable library validation.",
    );
  }

  const infoPlist = path.join(app, "Contents", "Info.plist");
  const bundledMetadata = JSON.parse(
    fs.readFileSync(
      path.join(app, "Contents", "Resources", "app", "package.json"),
      "utf8",
    ),
  );
  if (
    bundledMetadata.name !== metadata.name ||
    bundledMetadata.version !== metadata.version
  ) {
    throw new Error(
      "The app's bundled package metadata does not match the release.",
    );
  }
  const bundleVersion = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    infoPlist,
  ]).trim();
  if (bundleVersion !== metadata.version) {
    throw new Error(
      `The app version ${bundleVersion} does not match package version ${metadata.version}.`,
    );
  }
  const bundleIdentifier = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIdentifier",
    infoPlist,
  ]).trim();
  if (bundleIdentifier !== "app.louder-bridge") {
    throw new Error("The app has an unexpected bundle identifier.");
  }
  const minimumSystemVersion = run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :LSMinimumSystemVersion",
    infoPlist,
  ]).trim();
  if (
    !/^\d+(?:\.\d+)*$/.test(minimumSystemVersion) ||
    Number(minimumSystemVersion.split(".")[0]) < 15
  ) {
    throw new Error("The release does not require macOS 15 or newer.");
  }

  if (process.env.LOUDER_REQUIRE_NOTARIZED === "1") {
    const appMetadata = requireDeveloperIdSignature(appSignature, {
      label: "Louder Bridge app",
    });
    for (const { detail, label } of executableSignatures.values()) {
      requireDeveloperIdSignature(detail, {
        expectedTeamIdentifier: appMetadata.teamIdentifier,
        label,
      });
    }
    run("/usr/bin/xcrun", ["stapler", "validate", app]);
    run("/usr/sbin/spctl", [
      "--assess",
      "--type",
      "execute",
      "--verbose=2",
      app,
    ]);
  }
} finally {
  fs.rmSync(extracted, { recursive: true, force: true });
}

console.log("Release verification passed.");
