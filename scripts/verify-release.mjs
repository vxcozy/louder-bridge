#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
if (
  !sbom.packages.some(
    (entry) =>
      entry.name === metadata.name &&
      entry.versionInfo === metadata.version,
  )
) {
  throw new Error(
    "The release SBOM does not identify the package name and version.",
  );
}

const extracted = fs.mkdtempSync(
  path.join(os.tmpdir(), "louder-release-verify-"),
);
try {
  run("/usr/bin/unzip", ["-tq", archive]);
  run("/usr/bin/ditto", ["-x", "-k", archive, extracted]);
  const app = path.join(extracted, "Louder Bridge.app");
  if (!fs.existsSync(app)) {
    throw new Error("The release archive does not contain Louder Bridge.app.");
  }

  run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    app,
  ]);
  for (const executable of [
    path.join(app, "Contents", "MacOS", "LouderBridge"),
    path.join(app, "Contents", "MacOS", "node"),
  ]) {
    const description = run("/usr/bin/file", [executable]);
    if (!description.includes("arm64")) {
      throw new Error(
        `${path.basename(executable)} is not an arm64 executable.`,
      );
    }
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
    const signature = run("/usr/bin/codesign", ["-dv", "--verbose=4", app]);
    if (!signature.includes("Authority=Developer ID Application:")) {
      throw new Error(
        "The release does not have a Developer ID Application signature.",
      );
    }
    if (!/flags=.*runtime/.test(signature)) {
      throw new Error("The release is missing the hardened runtime.");
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
