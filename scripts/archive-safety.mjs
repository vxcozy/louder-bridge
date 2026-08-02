import fs from "node:fs";
import path from "node:path";

export function validateArchiveEntries(
  listing,
  { appRoot = "Louder Bridge.app" } = {},
) {
  const entries = String(listing).split(/\r?\n/).filter(Boolean);
  if (!entries.some((entry) => entry === `${appRoot}/`)) {
    throw new Error(`The release archive does not contain ${appRoot}.`);
  }
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.includes("\\")) {
      throw new Error(`The release archive contains an unsafe path: ${entry}`);
    }
    const parts = entry.split("/").filter(Boolean);
    if (
      parts.some((part) => part === "." || part === "..") ||
      (parts[0] !== appRoot && parts[0] !== "__MACOSX")
    ) {
      throw new Error(`The release archive contains an unsafe path: ${entry}`);
    }
  }
  return entries;
}

export function assertRegularArchiveTree(root) {
  const entry = fs.lstatSync(root);
  if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
    throw new Error(
      `The extracted release contains an unsupported file: ${path.basename(root)}`,
    );
  }
  if ((entry.mode & 0o022) !== 0) {
    throw new Error(
      `The extracted release contains unsafe permissions: ${path.basename(root)}`,
    );
  }
  if (!entry.isDirectory()) return;
  for (const child of fs.readdirSync(root)) {
    assertRegularArchiveTree(path.join(root, child));
  }
}
