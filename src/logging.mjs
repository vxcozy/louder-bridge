import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { writeFileAtomic } from "./setup/atomic-file.mjs";

const LEGACY_CONTEXT_SUFFIX =
  /(\bSlot \d+: (?:idle|running|needs_input|complete|error|off)|\bOpened Claude session in slot \d+) \([^\r\n]*\)(?=\r?$)/gm;

function formatPart(value) {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  return inspect(value, { breakLength: Infinity, depth: 4 });
}

function rotate(filename, backups) {
  if (fs.existsSync(`${filename}.${backups}`)) {
    fs.unlinkSync(`${filename}.${backups}`);
  }
  for (let index = backups - 1; index >= 1; index -= 1) {
    const source = `${filename}.${index}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${filename}.${index + 1}`);
  }
  if (fs.existsSync(filename)) fs.renameSync(filename, `${filename}.1`);
}

function scrubLegacyContext(filename) {
  if (!fs.existsSync(filename)) return;
  const contents = fs.readFileSync(filename, "utf8");
  const scrubbed = contents.replace(LEGACY_CONTEXT_SUFFIX, "$1");
  if (scrubbed !== contents) {
    writeFileAtomic(filename, scrubbed, { mode: 0o600 });
  }
  fs.chmodSync(filename, 0o600);
}

export function createRotatingLogger({
  stdout,
  stderr,
  maxBytes = 1024 * 1024,
  backups = 3,
  now = () => new Date(),
} = {}) {
  if (!stdout || !stderr) {
    throw new Error("Rotating logger requires stdout and stderr paths.");
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Rotating logger maxBytes must be a positive integer.");
  }
  if (!Number.isInteger(backups) || backups < 1) {
    throw new Error("Rotating logger backups must be a positive integer.");
  }
  for (const filename of new Set([stdout, stderr])) {
    const directory = path.dirname(filename);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    for (let index = 0; index <= backups; index += 1) {
      scrubLegacyContext(index === 0 ? filename : `${filename}.${index}`);
    }
  }

  function write(filename, level, values) {
    const message = values.map(formatPart).join(" ");
    const line = `${now().toISOString()} ${level} ${message}\n`;
    try {
      const currentSize = fs.existsSync(filename)
        ? fs.statSync(filename).size
        : 0;
      if (currentSize > 0 && currentSize + Buffer.byteLength(line) > maxBytes) {
        rotate(filename, backups);
      }
      fs.appendFileSync(filename, line, { encoding: "utf8", mode: 0o600 });
      fs.chmodSync(filename, 0o600);
    } catch {
      // Logging must never crash the bridge.
    }
  }

  return {
    info(...values) {
      write(stdout, "INFO", values);
    },
    error(...values) {
      write(stderr, "ERROR", values);
    },
  };
}
