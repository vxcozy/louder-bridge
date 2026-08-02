import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { writeFileAtomic } from "./setup/atomic-file.mjs";

const LEGACY_CONTEXT_SUFFIX =
  /(\bSlot \d+: (?:idle|running|needs_input|complete|error|off)|\bOpened Claude session in slot \d+) \([^\r\n]*\)(?=\r?$)/gm;
const LEGACY_PRIVATE_PATH_LINE =
  /(?:file:\/\/)?\/(?:Users\/|private\/var\/folders\/|var\/folders\/)/;
const LEGACY_STACK_LINE = /^\s*at\s+/;
const LEGACY_SOURCE_LINE = /^(?:file:\/\/)?\/.*\.(?:[cm]?js|mjs):\d+/;
const LEGACY_STACK_DETAIL_LINE = /^(?:\s{2,}\S|Node\.js v\d)/;
const PRIVATE_PATH_ROOTS = [
  "file:///Users/",
  "/Users/",
  "/private/var/folders/",
  "/var/folders/",
];
const SESSION_IDENTIFIER =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const AUTH_TOKEN = /\b[a-f0-9]{64}\b/gi;

function sanitizePart(value) {
  let text = String(value)
    .replace(SESSION_IDENTIFIER, "<session identifier omitted>")
    .replace(AUTH_TOKEN, "<authentication token omitted>")
    .replace(/\s+/g, " ")
    .trim();
  const privatePathIndex = PRIVATE_PATH_ROOTS.reduce((earliest, root) => {
    const index = text.indexOf(root);
    if (index < 0) return earliest;
    return earliest < 0 ? index : Math.min(earliest, index);
  }, -1);
  if (privatePathIndex >= 0) {
    const prefix = text
      .slice(0, privatePathIndex)
      .trimEnd()
      .replace(/[([{<]\s*$/, "")
      .trimEnd();
    text = `${prefix} <local path omitted>`;
  }
  return text;
}

function formatPart(value) {
  if (value instanceof Error) {
    return sanitizePart(`${value.name}: ${value.message}`);
  }
  if (typeof value === "string") return sanitizePart(value);
  return sanitizePart(inspect(value, { breakLength: Infinity, depth: 4 }));
}

function preparePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let descriptor;
  try {
    descriptor = fs.openSync(
      directory,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    if (!fs.fstatSync(descriptor).isDirectory()) {
      throw new Error("not a directory");
    }
    fs.fchmodSync(descriptor, 0o700);
  } catch (error) {
    throw new Error(
      `Louder Bridge log storage is not a regular directory: ${directory}`,
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function openPrivateLog(filename, flags, { allowMissing = false } = {}) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      filename,
      flags | fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return null;
    throw new Error(`Louder Bridge log is not a regular file: ${filename}`, {
      cause: error,
    });
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) {
      throw new Error(`Louder Bridge log is not a regular file: ${filename}`);
    }
    fs.fchmodSync(descriptor, 0o600);
    return { descriptor, stat };
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
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
  const opened = openPrivateLog(filename, fs.constants.O_RDONLY, {
    allowMissing: true,
  });
  if (!opened) return;
  try {
    const contents = fs.readFileSync(opened.descriptor, "utf8");
    const scrubbed = contents
      .replace(LEGACY_CONTEXT_SUFFIX, "$1")
      .split("\n")
      .filter(
        (line) =>
          !LEGACY_PRIVATE_PATH_LINE.test(line) &&
          !LEGACY_STACK_LINE.test(line) &&
          !LEGACY_SOURCE_LINE.test(line) &&
          !LEGACY_STACK_DETAIL_LINE.test(line),
      )
      .map((line) => sanitizePart(line))
      .join("\n");
    if (scrubbed !== contents) {
      writeFileAtomic(filename, scrubbed, { mode: 0o600 });
    }
  } finally {
    fs.closeSync(opened.descriptor);
  }
}

export function prepareRotatingLogs({
  stdout,
  stderr,
  backups = 3,
} = {}) {
  if (!stdout || !stderr) {
    throw new Error("Rotating logger requires stdout and stderr paths.");
  }
  if (!Number.isInteger(backups) || backups < 1) {
    throw new Error("Rotating logger backups must be a positive integer.");
  }
  const filenames = new Set([stdout, stderr]);
  for (const directory of new Set([...filenames].map(path.dirname))) {
    preparePrivateDirectory(directory);
  }
  for (const filename of filenames) {
    for (let index = 0; index <= backups; index += 1) {
      scrubLegacyContext(index === 0 ? filename : `${filename}.${index}`);
    }
  }
}

export function createRotatingLogger({
  stdout,
  stderr,
  maxBytes = 1024 * 1024,
  backups = 3,
  now = () => new Date(),
} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Rotating logger maxBytes must be a positive integer.");
  }
  prepareRotatingLogs({ stdout, stderr, backups });

  function write(filename, level, values) {
    const message = values.map(formatPart).join(" ");
    const line = `${now().toISOString()} ${level} ${message}\n`;
    let opened;
    try {
      preparePrivateDirectory(path.dirname(filename));
      opened = openPrivateLog(
        filename,
        fs.constants.O_WRONLY |
          fs.constants.O_APPEND |
          fs.constants.O_CREAT,
      );
      if (
        opened.stat.size > 0 &&
        opened.stat.size + Buffer.byteLength(line) > maxBytes
      ) {
        fs.closeSync(opened.descriptor);
        opened = null;
        rotate(filename, backups);
        opened = openPrivateLog(
          filename,
          fs.constants.O_WRONLY |
            fs.constants.O_APPEND |
            fs.constants.O_CREAT,
        );
      }
      fs.writeFileSync(opened.descriptor, line, { encoding: "utf8" });
    } catch {
      // Logging must never crash the bridge.
    } finally {
      if (opened) fs.closeSync(opened.descriptor);
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
