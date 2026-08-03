import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function pathEntry(fileSystem, filename) {
  try {
    return fileSystem.lstatSync(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function fileIdentity(entry) {
  return { device: entry.dev, inode: entry.ino };
}

function sameFile(expected, actual) {
  return Boolean(
    expected &&
      actual &&
      expected.device === actual.device &&
      expected.inode === actual.inode,
  );
}

function requireRegularFile(fileSystem, filename, message) {
  const entry = pathEntry(fileSystem, filename);
  if (!entry?.isFile() || entry.nlink !== 1) throw new Error(message);
  return fileIdentity(entry);
}

function requireFileIdentity(fileSystem, filename, identity, message) {
  const entry = pathEntry(fileSystem, filename);
  if (
    !entry?.isFile() ||
    entry.nlink !== 1 ||
    !sameFile(identity, fileIdentity(entry))
  ) {
    throw new Error(message);
  }
  return identity;
}

function restoreArtifact(
  fileSystem,
  { target, backup, originalIdentity, publishedIdentity },
) {
  const backupEntry = pathEntry(fileSystem, backup);
  if (
    !backupEntry?.isFile() ||
    backupEntry.nlink !== 1 ||
    !sameFile(originalIdentity, fileIdentity(backupEntry))
  ) {
    throw new Error(
      `The previous release artifact changed during rollback: ${path.basename(target)}`,
    );
  }
  const current = pathEntry(fileSystem, target);
  if (current) {
    if (
      !current.isFile() ||
      current.nlink !== 1 ||
      !sameFile(publishedIdentity, fileIdentity(current))
    ) {
      throw new Error(
        `The release artifact changed during rollback: ${path.basename(target)}`,
      );
    }
    fileSystem.unlinkSync(target);
  }
  fileSystem.renameSync(backup, target);
  requireFileIdentity(
    fileSystem,
    target,
    originalIdentity,
    `The restored release artifact changed: ${path.basename(target)}`,
  );
}

export function publishNotarizedArchive({
  archive,
  app,
  run,
  fileSystem = fs,
}) {
  if (typeof run !== "function") {
    throw new TypeError("An archive command runner is required.");
  }
  const identifier = randomUUID();
  const stagedArchive = path.join(
    path.dirname(archive),
    `.${path.basename(archive, ".zip")}.${identifier}.tmp.zip`,
  );
  const checksum = `${archive}.sha256`;
  const stagedChecksum = `${checksum}.${identifier}.tmp`;
  const archiveBackup = `${archive}.${identifier}.previous`;
  const checksumBackup = `${checksum}.${identifier}.previous`;
  let archiveOriginalIdentity = null;
  let checksumOriginalIdentity = null;
  let archivePublishedIdentity = null;
  let checksumPublishedIdentity = null;
  let archiveMoved = false;
  let checksumMoved = false;
  let committed = false;

  try {
    run("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      app,
      stagedArchive,
    ]);
    archivePublishedIdentity = requireRegularFile(
      fileSystem,
      stagedArchive,
      "The notarized release archive is not a regular file with one link.",
    );
    const digest = createHash("sha256")
      .update(fileSystem.readFileSync(stagedArchive))
      .digest("hex");
    fileSystem.writeFileSync(
      stagedChecksum,
      `${digest}  ${path.basename(archive)}\n`,
      { mode: 0o644, flag: "wx" },
    );
    checksumPublishedIdentity = requireRegularFile(
      fileSystem,
      stagedChecksum,
      "The notarized release checksum is not a regular file with one link.",
    );
    archiveOriginalIdentity = requireRegularFile(
      fileSystem,
      archive,
      "The previous release archive is not a regular single-link file.",
    );
    checksumOriginalIdentity = requireRegularFile(
      fileSystem,
      checksum,
      "The previous release checksum is not a regular single-link file.",
    );
    fileSystem.renameSync(archive, archiveBackup);
    archiveMoved = true;
    requireFileIdentity(
      fileSystem,
      archiveBackup,
      archiveOriginalIdentity,
      "The previous release archive changed while it was moved into backup.",
    );
    fileSystem.renameSync(checksum, checksumBackup);
    checksumMoved = true;
    requireFileIdentity(
      fileSystem,
      checksumBackup,
      checksumOriginalIdentity,
      "The previous release checksum changed while it was moved into backup.",
    );
    fileSystem.renameSync(stagedArchive, archive);
    requireFileIdentity(
      fileSystem,
      archive,
      archivePublishedIdentity,
      "The notarized release archive changed during publication.",
    );
    fileSystem.renameSync(stagedChecksum, checksum);
    requireFileIdentity(
      fileSystem,
      checksum,
      checksumPublishedIdentity,
      "The notarized release checksum changed during publication.",
    );
    committed = true;
    requireFileIdentity(
      fileSystem,
      archiveBackup,
      archiveOriginalIdentity,
      "The previous release archive changed before cleanup.",
    );
    fileSystem.unlinkSync(archiveBackup);
    requireFileIdentity(
      fileSystem,
      checksumBackup,
      checksumOriginalIdentity,
      "The previous release checksum changed before cleanup.",
    );
    fileSystem.unlinkSync(checksumBackup);
    return digest;
  } catch (error) {
    if (!committed) {
      const rollbackErrors = [];
      if (checksumMoved) {
        try {
          restoreArtifact(fileSystem, {
            target: checksum,
            backup: checksumBackup,
            originalIdentity: checksumOriginalIdentity,
            publishedIdentity: checksumPublishedIdentity,
          });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (archiveMoved) {
        try {
          restoreArtifact(fileSystem, {
            target: archive,
            backup: archiveBackup,
            originalIdentity: archiveOriginalIdentity,
            publishedIdentity: archivePublishedIdentity,
          });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "The notarized release artifacts could not be published or restored cleanly.",
        );
      }
    }
    throw error;
  } finally {
    fileSystem.rmSync(stagedArchive, { force: true, recursive: true });
    fileSystem.rmSync(stagedChecksum, { force: true, recursive: true });
  }
}
