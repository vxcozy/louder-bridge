import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export function publishNotarizedArchive({ archive, app, run }) {
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

  try {
    run("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      app,
      stagedArchive,
    ]);
    const entry = fs.lstatSync(stagedArchive);
    if (!entry.isFile()) {
      throw new Error("The notarized release archive is not a regular file.");
    }
    const digest = createHash("sha256")
      .update(fs.readFileSync(stagedArchive))
      .digest("hex");
    fs.writeFileSync(
      stagedChecksum,
      `${digest}  ${path.basename(archive)}\n`,
      { mode: 0o644, flag: "wx" },
    );
    fs.renameSync(stagedArchive, archive);
    fs.renameSync(stagedChecksum, checksum);
    return digest;
  } finally {
    fs.rmSync(stagedArchive, { force: true, recursive: true });
    fs.rmSync(stagedChecksum, { force: true, recursive: true });
  }
}
