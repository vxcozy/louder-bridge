#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const profile = process.env.APPLE_NOTARY_PROFILE;
const keyId = process.env.APPLE_NOTARY_KEY_ID;
const issuerId = process.env.APPLE_NOTARY_ISSUER_ID;
const keyPath = process.env.APPLE_NOTARY_KEY_PATH;
const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const app = path.join(
  dist,
  "staging",
  "Applications",
  "Louder Bridge.app",
);
const archive = path.join(
  dist,
  `Louder-Bridge-${metadata.version}-macOS-arm64.zip`,
);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}.`);
  }
}

if (!profile && !(keyId && issuerId && keyPath)) {
  throw new Error(
    "Set APPLE_NOTARY_PROFILE or the APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER_ID, and APPLE_NOTARY_KEY_PATH variables.",
  );
}
if (!process.env.APPLE_SIGNING_IDENTITY) {
  throw new Error("A Developer ID-signed build is required for notarization.");
}
if (!fs.existsSync(app) || !fs.existsSync(archive)) {
  throw new Error("Run `npm run release:build` before notarization.");
}
const signature = spawnSync(
  "/usr/bin/codesign",
  ["-dv", "--verbose=4", app],
  { encoding: "utf8" },
);
const signatureDetail = `${signature.stdout ?? ""}${signature.stderr ?? ""}`;
if (
  signature.status !== 0 ||
  !signatureDetail.includes("Authority=Developer ID Application:") ||
  !/flags=.*runtime/.test(signatureDetail)
) {
  throw new Error(
    "The app must have a Developer ID Application signature and hardened runtime before notarization.",
  );
}

const credentials = profile
  ? ["--keychain-profile", profile]
  : ["--key", keyPath, "--key-id", keyId, "--issuer", issuerId];
run("/usr/bin/xcrun", [
  "notarytool",
  "submit",
  archive,
  ...credentials,
  "--wait",
]);
run("/usr/bin/xcrun", ["stapler", "staple", app]);
run("/usr/bin/xcrun", ["stapler", "validate", app]);
fs.unlinkSync(archive);
run("/usr/bin/ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  app,
  archive,
]);
const digest = createHash("sha256")
  .update(fs.readFileSync(archive))
  .digest("hex");
fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`, {
  mode: 0o644,
});
run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
console.log(`Notarized ${path.relative(root, archive)}`);
