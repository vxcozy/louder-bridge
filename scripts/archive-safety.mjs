import fs from "node:fs";
import path from "node:path";

export const MAX_ARCHIVE_ENTRIES = 512;
export const MAX_ARCHIVE_COMPRESSED_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export function validateArchiveSummary(
  summary,
  {
    expectedEntries,
    maxEntries = MAX_ARCHIVE_ENTRIES,
    maxCompressedBytes = MAX_ARCHIVE_COMPRESSED_BYTES,
    maxUncompressedBytes = MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  } = {},
) {
  const match =
    /(?:^|\n)\s*(\d+)\s+files?,\s+(\d+)\s+bytes uncompressed,\s+(\d+)\s+bytes compressed:/i.exec(
      String(summary),
    );
  if (!match) {
    throw new Error("The release archive has an invalid size summary.");
  }
  const [entries, uncompressedBytes, compressedBytes] = match
    .slice(1)
    .map(Number);
  if (
    ![entries, uncompressedBytes, compressedBytes].every(Number.isSafeInteger)
  ) {
    throw new Error("The release archive has an invalid size summary.");
  }
  if (expectedEntries !== undefined && entries !== expectedEntries) {
    throw new Error(
      "The release archive entry count does not match its file listing.",
    );
  }
  if (entries > maxEntries) {
    throw new Error(
      `The release archive contains more than ${maxEntries} entries.`,
    );
  }
  if (compressedBytes > maxCompressedBytes) {
    throw new Error("The release archive exceeds the compressed-size limit.");
  }
  if (uncompressedBytes > maxUncompressedBytes) {
    throw new Error("The release archive exceeds the extraction-size limit.");
  }
  return { entries, compressedBytes, uncompressedBytes };
}

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
