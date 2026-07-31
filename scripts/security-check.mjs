#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "coverage", "dist", "node_modules"]);
const excludedFiles = new Set([".env.example"]);
const excludedPaths = new Set(["scripts/security-check.mjs"]);
const forbiddenFiles = [
  /^\.env(?:\.|$)/,
  /^\.mcp\.json$/,
  /^config\.json$/,
  /^credentials\./,
];
const secretPatterns = [
  ["private key", /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{16,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bghp_[A-Za-z0-9]{20,}\b/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[bpsa]-[A-Za-z0-9-]{10,}\b/],
  ["64-byte hex secret", /\b0x[0-9a-fA-F]{64}\b/],
  ["seed phrase", /\b(?:mnemonic\s*=|seed phrase)\b/i],
];

function files(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...files(filename));
    else if (entry.isFile()) output.push(filename);
  }
  return output;
}

const findings = [];
for (const filename of files(root)) {
  const relative = path.relative(root, filename);
  if (excludedPaths.has(relative)) continue;
  const basename = path.basename(filename);
  if (
    !excludedFiles.has(basename) &&
    forbiddenFiles.some((pattern) => pattern.test(basename))
  ) {
    findings.push(`${relative}: file should not be committed`);
    continue;
  }
  const contents = fs.readFileSync(filename);
  if (contents.includes(0)) continue;
  const text = contents.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(text)) findings.push(`${relative}: possible ${label}`);
  }
}

if (findings.length) {
  console.error("Security check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("Security check passed.");
}
