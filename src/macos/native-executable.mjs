import fs from "node:fs";

const MACHO_MAGICS = new Set([
  "cafebabe",
  "cafebabf",
  "cefaedfe",
  "cffaedfe",
  "feedface",
  "feedfacf",
]);

export function isNativeExecutable(filename) {
  if (!filename) return false;
  try {
    const descriptor = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      if (!fs.fstatSync(descriptor).isFile()) return false;
      const prefix = Buffer.alloc(4);
      if (fs.readSync(descriptor, prefix, 0, prefix.length, 0) !== 4) {
        return false;
      }
      return MACHO_MAGICS.has(prefix.toString("hex"));
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return false;
  }
}
