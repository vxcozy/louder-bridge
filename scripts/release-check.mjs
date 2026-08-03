#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "THIRD_PARTY_LICENSES/FreeMicro-LICENSE",
  ".github/CODEOWNERS",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  ".github/workflows/release.yml",
  "docs/compatibility.md",
  "docs/explanation.md",
  "docs/how-to.md",
  "docs/reference.md",
  "docs/releasing.md",
  "docs/testing.md",
  "docs/tutorial.md",
  "scripts/publish-release.mjs",
  "scripts/release-environment-check.mjs",
];
const failures = [];

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push(`Missing release file: ${relative}`);
  }
}

function sourceFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "coverage", "dist", "node_modules"].includes(entry.name)) {
      continue;
    }
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(filename));
    else if (entry.isFile()) output.push(filename);
  }
  return output;
}

const files = sourceFiles(root);
for (const filename of files.filter((file) => /\.(?:mjs|cjs|js)$/.test(file))) {
  const result = spawnSync(process.execPath, ["--check", filename], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push(
      `Syntax check failed: ${path.relative(root, filename)}\n${result.stderr.trim()}`,
    );
  }
}

for (const filename of files.filter((file) => /\.(md|json|yml)$/.test(file))) {
  const contents = fs.readFileSync(filename, "utf8");
  if (/\/Users\/[^/<\s]+|\/home\/[^/<\s]+|[A-Z]:\\Users\\/i.test(contents)) {
    failures.push(
      `Personal filesystem path found: ${path.relative(root, filename)}`,
    );
  }
}

for (const [relative, pattern] of [
  ["src", /LOUDER_CHATGPT_ASAR|app\.asar|chatgpt-asar/i],
  ["native", /LOUDER_CHATGPT_ASAR|app\.asar|chatgpt-asar/i],
]) {
  for (const filename of sourceFiles(path.join(root, relative))) {
    const contents = fs.readFileSync(filename, "utf8");
    if (pattern.test(contents)) {
      failures.push(
        `Removed ChatGPT runtime dependency found: ${path.relative(root, filename)}`,
      );
    }
  }
}
for (const relative of [
  "src/device/provider.mjs",
  "src/runtime/asar-require.mjs",
]) {
  if (fs.existsSync(path.join(root, relative))) {
    failures.push(`Removed runtime adapter still exists: ${relative}`);
  }
}

const metadata = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const releaseNotes = `release-notes/v${metadata.version}.md`;
if (!fs.existsSync(path.join(root, releaseNotes))) {
  failures.push(`Missing reviewed release notes: ${releaseNotes}`);
}
function readIfPresent(relative) {
  const filename = path.join(root, relative);
  return fs.existsSync(filename) ? fs.readFileSync(filename, "utf8") : "";
}

const ciWorkflow = readIfPresent(".github/workflows/ci.yml");
const releaseWorkflow = readIfPresent(".github/workflows/release.yml");
const buildReleaseScript = readIfPresent("scripts/build-release.mjs");
const publishReleaseScript = readIfPresent("scripts/publish-release.mjs");
const nativeDeviceSource = readIfPresent("native/micro_device.m");
const codeOwners = readIfPresent(".github/CODEOWNERS");
const nodeEntitlements = readIfPresent("release/node.entitlements.plist");
const actionPins = {
  "actions/checkout": "d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact": "b7c566a772e6b6bfb58ed0dc250532a479d7789f",
};
if (!/node:\s*\["22\.x", "24\.x", "26\.x"\]/.test(ciWorkflow)) {
  failures.push("CI must test Node.js 22, 24, and 26.");
}
if (
  !ciWorkflow.includes("runs-on: macos-26") ||
  !releaseWorkflow.includes("runs-on: macos-26")
) {
  failures.push("CI and release builds must use the native macos-26 runner.");
}
if (!ciWorkflow.includes("npm ci") || !releaseWorkflow.includes("npm ci")) {
  failures.push("CI and release jobs must install from package-lock.json.");
}
if (
  !ciWorkflow.includes("npm audit --omit=dev") ||
  !releaseWorkflow.includes("npm audit --omit=dev")
) {
  failures.push("CI and release jobs must audit production dependencies.");
}
if (!releaseWorkflow.includes("LOUDER_RELEASE_BRANCH_REF:")) {
  failures.push(
    "The release workflow must verify tags against the default branch.",
  );
}
if (!releaseWorkflow.includes("npm run release:credentials")) {
  failures.push("The release workflow must validate signing credentials.");
}
if (
  metadata.scripts?.["release:environment"] !==
  "node scripts/release-environment-check.mjs"
) {
  failures.push("The release environment check must remain available.");
}
if (
  releaseWorkflow.indexOf("name: Check source") < 0 ||
  releaseWorkflow.indexOf("name: Check release credentials") < 0 ||
  releaseWorkflow.indexOf("name: Check source") >
    releaseWorkflow.indexOf("name: Check release credentials")
  ) {
  failures.push(
    "The release workflow must check source before passing signing credentials to repository scripts.",
  );
}
if (!codeOwners.includes("release-notes/** @vxcozy")) {
  failures.push("Release notes must require maintainer review.");
}
if (
  (releaseWorkflow.match(/umask 077/g) ?? []).length < 2 ||
  (releaseWorkflow.includes("security import") &&
    !releaseWorkflow.includes("-T /usr/bin/codesign")
  )
) {
  failures.push(
    "The release workflow must restrict temporary credentials to the signing process.",
  );
}
if (
  !releaseWorkflow.includes("if: always()") ||
  !releaseWorkflow.includes("security delete-keychain") ||
  !releaseWorkflow.includes("AuthKey_*.p8") ||
  !releaseWorkflow.includes("keychain-search-list.mjs restore")
) {
  failures.push("The release workflow must remove temporary signing credentials.");
}
if (
  releaseWorkflow.indexOf("name: Remove signing credentials") < 0 ||
  releaseWorkflow.indexOf("name: Create or update draft GitHub release") < 0 ||
  releaseWorkflow.indexOf("name: Remove signing credentials") >
    releaseWorkflow.indexOf("name: Create or update draft GitHub release")
) {
  failures.push(
    "The release workflow must remove signing credentials before it receives a write-capable GitHub token.",
  );
}
if (
  !releaseWorkflow.includes("keychain-search-list.mjs add") ||
  !releaseWorkflow.includes("APPLE_SIGNING_KEYCHAIN:") ||
  /security list-keychain(?:s)? -d user -s/.test(releaseWorkflow) ||
  !buildReleaseScript.includes("signingKeychainArguments") ||
  !buildReleaseScript.includes("APPLE_SIGNING_KEYCHAIN")
) {
  failures.push(
    "The release workflow must preserve the user keychain search list and restrict signing to the temporary keychain.",
  );
}
if ((ciWorkflow.match(/fetch-depth:\s*0/g) ?? []).length < 2) {
  failures.push("CI jobs must fetch full history for attribution checks.");
}
const checkoutCount = [ciWorkflow, releaseWorkflow].reduce(
  (count, workflow) =>
    count + (workflow.match(/actions\/checkout@[a-f0-9]{40}/g) ?? []).length,
  0,
);
const nonPersistedCheckoutCount = [ciWorkflow, releaseWorkflow].reduce(
  (count, workflow) =>
    count + (workflow.match(/persist-credentials:\s*false/g) ?? []).length,
  0,
);
if (
  checkoutCount === 0 ||
  nonPersistedCheckoutCount !== checkoutCount
) {
  failures.push(
    "CI and release checkouts must not persist GitHub credentials.",
  );
}
for (const workflow of [ciWorkflow, releaseWorkflow]) {
  if (/\buses:\s*[^\s@]+@(?![a-f0-9]{40}\b)/i.test(workflow)) {
    failures.push(
      "GitHub Actions must use immutable 40-character commit SHAs.",
    );
    break;
  }
}
for (const [action, revision] of Object.entries(actionPins)) {
  const requiredWorkflows =
    action === "actions/upload-artifact"
      ? [["CI", ciWorkflow]]
      : [["CI", ciWorkflow], ["release", releaseWorkflow]];
  for (const [name, workflow] of requiredWorkflows) {
    if (!workflow.includes(`${action}@${revision}`)) {
      failures.push(
        `${name} must pin ${action} to its reviewed v6 commit.`,
      );
    }
  }
}
if (
  !releaseWorkflow.includes("npm run release:publish") ||
  metadata.scripts?.["release:publish"] !==
    "node scripts/publish-release.mjs" ||
  !publishReleaseScript.includes('"--draft"')
) {
  failures.push(
    "The release workflow must create a draft for physical qualification.",
  );
}
if (
  !publishReleaseScript.includes(
    "`Louder-Bridge-${version}-macOS-arm64.zip`",
  ) ||
  !publishReleaseScript.includes("`${archive}.sha256`") ||
  !publishReleaseScript.includes("`Louder-Bridge-${version}.spdx.json`") ||
  /dist\/\*\.(?:zip|sha256|spdx\.json)/.test(publishReleaseScript)
) {
  failures.push(
    "The release workflow must upload the exact versioned archive, checksum, and SBOM.",
  );
}
if (
  !publishReleaseScript.includes('"--notes-file"') ||
  publishReleaseScript.includes("--generate-notes")
) {
  failures.push(
    "The release workflow must use reviewed notes instead of generated notes.",
  );
}
if (
  !releaseWorkflow.includes("group: release-${{ github.ref }}") ||
  !releaseWorkflow.includes("cancel-in-progress: false") ||
  !publishReleaseScript.includes('"--clobber"') ||
  !publishReleaseScript.includes("existing && !existing.draft") ||
  !publishReleaseScript.includes("verifyDraftAssets(") ||
  !publishReleaseScript.includes('createHash("sha256")') ||
  !publishReleaseScript.includes("asset.digest !== expected.digest") ||
  !publishReleaseScript.includes('asset?.state !== "uploaded"') ||
  !publishReleaseScript.includes('"--verify-tag"') ||
  !publishReleaseScript.includes('"--repo"')
) {
  failures.push(
    "Draft publication must run one tag at a time, resume existing drafts, verify asset digests, and refuse published releases.",
  );
}
if (/\bgh release (?:create|edit|upload)\b/.test(releaseWorkflow)) {
  failures.push(
    "The release workflow must use the tested draft publisher instead of inline GitHub CLI commands.",
  );
}
if (releaseWorkflow.includes("LOUDER_SKIP_RUNTIME_AVAILABILITY_CHECK")) {
  failures.push("The release workflow contains a removed runtime bypass.");
}
if (
  !nativeDeviceSource.includes(
    '[message[@"m"] isEqualToString:@"v.oai.thstatus"]',
  ) ||
  nativeDeviceSource.includes(
    '[method isEqualToString:@"device.status"]',
  ) ||
  nativeDeviceSource.includes(
    '[method isEqualToString:@"v.oai.rgbcfg"]',
  ) ||
  !nativeDeviceSource.includes("valid_thread_lights(message[@\"p\"])")
) {
  failures.push(
    "The native driver must accept only schema-checked thread-status lighting from Node.",
  );
}
if (
  !nodeEntitlements.includes("com.apple.security.cs.allow-jit") ||
  nodeEntitlements.includes(
    "com.apple.security.cs.disable-library-validation",
  )
) {
  failures.push(
    "Node entitlements must allow JIT without disabling library validation.",
  );
}
if (!/^\d+\.\d+\.\d+$/.test(metadata.version ?? "")) {
  failures.push("package.json must contain a semantic version.");
}
if (
  process.env.GITHUB_REF_TYPE === "tag" &&
  process.env.GITHUB_REF_NAME !== `v${metadata.version}`
) {
  failures.push(
    `Release tag ${process.env.GITHUB_REF_NAME} does not match package version ${metadata.version}.`,
  );
}
if (process.env.GITHUB_REF_TYPE === "tag") {
  const branchRef = process.env.LOUDER_RELEASE_BRANCH_REF?.trim();
  if (!branchRef) {
    failures.push("The protected release branch reference is unavailable.");
  } else {
    const ancestry = spawnSync(
      "/usr/bin/git",
      ["merge-base", "--is-ancestor", "HEAD", branchRef],
      { cwd: root, encoding: "utf8" },
    );
    if (ancestry.status === 1) {
      failures.push(`The release tag commit is not part of ${branchRef}.`);
    } else if (ancestry.status !== 0) {
      failures.push(
        `Could not verify the release tag against ${branchRef}: ${ancestry.stderr?.trim() || `exit ${ancestry.status}`}`,
      );
    }
  }
}
if (metadata.engines?.node !== ">=22") {
  failures.push("package.json must require the supported Node baseline (>=22).");
}
if (metadata.louderBridge?.deviceProvider?.id !== "native-iokit-protocol") {
  failures.push("The bundled Codex Micro driver must be selected.");
}
const protocolReference =
  metadata.louderBridge?.deviceProvider?.protocolReference;
if (
  !protocolReference ||
  !/^[a-f0-9]{40}$/.test(protocolReference.revision ?? "") ||
  protocolReference.license !== "MIT" ||
  !URL.canParse(protocolReference.url ?? "")
) {
  failures.push(
    "The Codex Micro protocol reference must include an MIT-licensed revision.",
  );
}
for (const [label, adapter] of [
  ["Codex Micro device driver", metadata.louderBridge?.deviceProvider],
  ["Claude session navigator", metadata.louderBridge?.claudeNavigator],
  ["Claude voice interface", metadata.louderBridge?.claudeVoice],
]) {
  if (
    typeof adapter?.id !== "string" ||
    adapter.id.length < 1 ||
    !["experimental", "official"].includes(adapter.support)
  ) {
    failures.push(
      `${label} metadata must include an id and experimental or official support status.`,
    );
  }
}
const majorVersion = Number(metadata.version.split(".")[0]);
if (majorVersion >= 1) {
  if (metadata.louderBridge?.deviceProvider?.support !== "official") {
    failures.push(
      "v1 requires a vendor-supported Codex Micro interface.",
    );
  }
  if (metadata.louderBridge?.claudeNavigator?.support !== "official") {
    failures.push("v1 requires a supported Claude session navigator.");
  }
  if (metadata.louderBridge?.claudeVoice?.support !== "official") {
    failures.push("v1 requires a supported Claude voice interface.");
  }
}

if (failures.length) {
  console.error("Release check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Release check passed.");
}
