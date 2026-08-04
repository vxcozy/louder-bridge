#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findAttribution } from "../src/policy/attribution.mjs";
import { historicalAttributionFindings } from "./historical-attribution.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set([".git", "coverage", "dist", "node_modules"]);

function projectFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...projectFiles(filename));
    else if (entry.isFile()) output.push(filename);
  }
  return output;
}

const findings = [];
for (const filename of projectFiles(root)) {
  const relative = path.relative(root, filename);
  const contents = fs.readFileSync(filename);
  if (contents.includes(0)) continue;
  const finding = findAttribution(contents.toString("utf8"));
  if (finding) findings.push(`${relative}: ${finding}`);
}

const history = spawnSync(
  "/usr/bin/git",
  ["-C", root, "log", "--all", "--format=%H%n%B%n--END-COMMIT--"],
  { encoding: "utf8" },
);
if (history.status === 0) {
  for (const commit of history.stdout.split("--END-COMMIT--")) {
    const finding = findAttribution(commit);
    if (finding) {
      const hash = commit.trim().split("\n")[0];
      findings.push(`${hash}: ${finding}`);
    }
  }
} else {
  findings.push(
    `history: git log failed: ${history.stderr?.trim() || `exit ${history.status}`}`,
  );
}

try {
  findings.push(...historicalAttributionFindings(root));
} catch (error) {
  findings.push(
    `history: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (findings.length) {
  console.error("Authorship check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("Authorship check passed.");
}
