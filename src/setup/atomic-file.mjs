import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function writeFileAtomic(filename, contents, { mode = 0o600 } = {}) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", mode);
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
    fs.chmodSync(filename, mode);

    let directoryDescriptor;
    try {
      directoryDescriptor = fs.openSync(directory, "r");
      fs.fsyncSync(directoryDescriptor);
    } catch (error) {
      if (!["EINVAL", "ENOTSUP"].includes(error.code)) throw error;
    } finally {
      if (directoryDescriptor !== undefined) {
        fs.closeSync(directoryDescriptor);
      }
    }
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
