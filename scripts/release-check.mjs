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
function readIfPresent(relative) {
  const filename = path.join(root, relative);
  return fs.existsSync(filename) ? fs.readFileSync(filename, "utf8") : "";
}

const ciWorkflow = readIfPresent(".github/workflows/ci.yml");
const releaseWorkflow = readIfPresent(".github/workflows/release.yml");
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
if (!releaseWorkflow.includes("npm run release:credentials")) {
  failures.push("The release workflow must check signing credentials first.");
}
if ((ciWorkflow.match(/fetch-depth:\s*0/g) ?? []).length < 2) {
  failures.push("CI jobs must fetch full history for attribution checks.");
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
if (!releaseWorkflow.includes("--draft")) {
  failures.push(
    "The release workflow must create a draft for physical qualification.",
  );
}
if (releaseWorkflow.includes("LOUDER_SKIP_RUNTIME_AVAILABILITY_CHECK")) {
  failures.push("The release workflow contains a removed runtime bypass.");
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
