import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

function temporaryPath(filename) {
  return path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP"].includes(error.code)) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function writeFileAtomic(filename, contents, { mode = 0o600 } = {}) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = temporaryPath(filename);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, contents);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    if (fs.existsSync(temporary)) {
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
    throw error;
  }
}

export function writeFileAtomicIfAbsent(
  filename,
  contents,
  { mode = 0o600 } = {},
) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = temporaryPath(filename);
  let descriptor;
  let created = false;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, contents);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      fs.linkSync(temporary, filename);
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    fs.unlinkSync(temporary);
    fsyncDirectory(directory);
    return created;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    if (fs.existsSync(temporary)) {
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }
    throw error;
  }
}
