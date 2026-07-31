import fs from "node:fs";
import path from "node:path";
import Module, { builtinModules, createRequire } from "node:module";

const nativeRequire = createRequire(import.meta.url);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const MAX_HEADER_BYTES = 64 * 1024 * 1024;

function readExactly(descriptor, length, position) {
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = fs.readSync(
      descriptor,
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (bytesRead === 0) throw new Error("Unexpected end of ASAR archive.");
    offset += bytesRead;
  }
  return buffer;
}

function normalizeArchivePath(value) {
  return path.posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^(\.\/|\/)+/, "");
}

function packageParts(request) {
  const parts = request.split("/");
  const packageName = request.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  return {
    packageName,
    subpath: parts.slice(request.startsWith("@") ? 2 : 1).join("/"),
  };
}

/**
 * Read CommonJS modules directly from an Electron ASAR without extracting it.
 * Unpacked native addons are resolved to the adjacent app.asar.unpacked tree.
 */
export class AsarRequire {
  constructor(archivePath) {
    this.archivePath = path.resolve(archivePath);
    this.virtualRoot = `${this.archivePath}${path.sep}`;
    this.unpackedRoot = `${this.archivePath}.unpacked`;
    this.descriptor = fs.openSync(this.archivePath, "r");
    try {
      const prefix = readExactly(this.descriptor, 16, 0);
      const headerLength = prefix.readUInt32LE(12);
      if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) {
        throw new Error(`Invalid ASAR header length: ${headerLength}.`);
      }
      this.header = JSON.parse(
        readExactly(this.descriptor, headerLength, 16).toString("utf8"),
      );
      this.contentOffset = 8 + prefix.readUInt32LE(4);
      this.archiveSize = fs.fstatSync(this.descriptor).size;
      if (
        this.contentOffset < 16 + headerLength ||
        this.contentOffset > this.archiveSize
      ) {
        throw new Error("Invalid ASAR content offset.");
      }
    } catch (error) {
      fs.closeSync(this.descriptor);
      this.descriptor = null;
      throw error;
    }
    this.cache = new Map();
    this.originalLoad = null;
    this.originalResolve = null;
    this.fsProxy = null;
    this.fsPromisesProxy = null;
  }

  entry(archivePath) {
    let node = this.header;
    for (const part of normalizeArchivePath(archivePath).split("/")) {
      if (!part) continue;
      node = node?.files?.[part];
      if (!node) return null;
    }
    return node;
  }

  isFile(archivePath) {
    const entry = this.entry(archivePath);
    return Boolean(entry && !entry.files);
  }

  isDirectory(archivePath) {
    return Boolean(this.entry(archivePath)?.files);
  }

  readFile(archivePath) {
    const normalized = normalizeArchivePath(archivePath);
    const entry = this.entry(normalized);
    if (!entry || entry.files) {
      throw new Error(`ASAR file not found: ${normalized}`);
    }
    if (entry.unpacked) {
      return fs.readFileSync(path.join(this.unpackedRoot, normalized));
    }
    const start = this.contentOffset + Number(entry.offset);
    const size = Number(entry.size);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(size) ||
      start < this.contentOffset ||
      size < 0 ||
      start + size > this.archiveSize
    ) {
      throw new Error(`Invalid ASAR file bounds: ${normalized}`);
    }
    return readExactly(this.descriptor, size, start);
  }

  toArchivePath(filename) {
    const absolute = path.resolve(filename);
    if (!absolute.startsWith(this.virtualRoot)) return null;
    return normalizeArchivePath(absolute.slice(this.virtualRoot.length));
  }

  toVirtualPath(archivePath) {
    return path.join(this.archivePath, normalizeArchivePath(archivePath));
  }

  mapUnpackedPath(value) {
    if (typeof value !== "string") return value;
    const archivePath = this.toArchivePath(value);
    if (archivePath === null) return value;
    const unpackedPath = path.join(this.unpackedRoot, archivePath);
    return fs.existsSync(unpackedPath) ? unpackedPath : value;
  }

  proxiedFs(target) {
    const archive = this;
    return new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property);
        if (typeof value !== "function") return value;
        return function mappedFsCall(...args) {
          if (args.length) args[0] = archive.mapUnpackedPath(args[0]);
          return Reflect.apply(value, object, args);
        };
      },
    });
  }

  loadBuiltin(request) {
    if (request === "fs" || request === "node:fs") {
      this.fsProxy ??= this.proxiedFs(nativeRequire("node:fs"));
      return this.fsProxy;
    }
    if (request === "fs/promises" || request === "node:fs/promises") {
      this.fsPromisesProxy ??= this.proxiedFs(nativeRequire("node:fs/promises"));
      return this.fsPromisesProxy;
    }
    return nativeRequire(request);
  }

  resolveFile(candidate) {
    const normalized = normalizeArchivePath(candidate);
    for (const suffix of ["", ".js", ".cjs", ".json", ".node"]) {
      const current = `${normalized}${suffix}`;
      if (this.isFile(current)) return current;
    }
    if (!this.isDirectory(normalized)) return null;

    const packageJsonPath = `${normalized}/package.json`;
    if (this.isFile(packageJsonPath)) {
      const packageJson = JSON.parse(this.readFile(packageJsonPath).toString());
      const target =
        packageJson.main ??
        (typeof packageJson.exports === "string"
          ? packageJson.exports
          : packageJson.exports?.["."]?.require);
      if (target) {
        const resolved = this.resolveFile(
          path.posix.join(normalized, target),
        );
        if (resolved) return resolved;
      }
    }
    return this.resolveFile(`${normalized}/index`);
  }

  resolve(request, parentFilename = this.toVirtualPath("package.json")) {
    if (builtins.has(request)) return request;

    const parentArchivePath =
      this.toArchivePath(parentFilename) ?? normalizeArchivePath(parentFilename);
    const parentDirectory = path.posix.dirname(parentArchivePath);

    if (request.startsWith(this.virtualRoot)) {
      return this.resolveFile(this.toArchivePath(request));
    }
    if (request.startsWith(".")) {
      return this.resolveFile(path.posix.join(parentDirectory, request));
    }
    if (path.isAbsolute(request)) return null;

    const { packageName, subpath } = packageParts(request);
    let directory = parentDirectory;
    for (;;) {
      const packageRoot = path.posix.join(
        directory,
        "node_modules",
        packageName,
      );
      const candidate = subpath
        ? path.posix.join(packageRoot, subpath)
        : packageRoot;
      const resolved = this.resolveFile(candidate);
      if (resolved) return resolved;
      if (!directory || directory === ".") break;
      const next = path.posix.dirname(directory);
      if (next === directory) break;
      directory = next;
    }
    return null;
  }

  loadResolved(archivePath, parent, isMain = false) {
    if (builtins.has(archivePath)) return this.loadBuiltin(archivePath);
    const normalized = normalizeArchivePath(archivePath);
    if (this.cache.has(normalized)) return this.cache.get(normalized).exports;

    const entry = this.entry(normalized);
    if (!entry) throw new Error(`Cannot find ASAR module: ${normalized}`);
    if (normalized.endsWith(".node")) {
      if (!entry.unpacked) {
        throw new Error(`Native ASAR module is not unpacked: ${normalized}`);
      }
      return this.originalLoad(
        path.join(this.unpackedRoot, normalized),
        parent,
        isMain,
      );
    }
    if (normalized.endsWith(".json")) {
      const value = JSON.parse(this.readFile(normalized).toString("utf8"));
      this.cache.set(normalized, { exports: value });
      return value;
    }

    const filename = this.toVirtualPath(normalized);
    const module = new Module(filename, parent);
    module.filename = filename;
    module.paths = [];
    this.cache.set(normalized, module);
    Module._cache[filename] = module;
    try {
      module._compile(this.readFile(normalized).toString("utf8"), filename);
      module.loaded = true;
      return module.exports;
    } catch (error) {
      this.cache.delete(normalized);
      delete Module._cache[filename];
      throw error;
    }
  }

  install() {
    if (this.originalLoad) return;
    this.originalLoad = Module._load;
    this.originalResolve = Module._resolveFilename;
    const archive = this;

    this.installedResolve = function louderResolve(
      request,
      parent,
      isMain,
      options,
    ) {
      if (builtins.has(request)) {
        return archive.originalResolve.call(
          this,
          request,
          parent,
          isMain,
          options,
        );
      }
      const resolved = archive.resolve(request, parent?.filename);
      if (resolved) return archive.toVirtualPath(resolved);
      return archive.originalResolve.call(
        this,
        request,
        parent,
        isMain,
        options,
      );
    };
    Module._resolveFilename = this.installedResolve;

    this.installedLoad = function louderLoad(request, parent, isMain) {
      if (builtins.has(request)) {
        if (parent?.filename?.startsWith(archive.virtualRoot)) {
          return archive.loadBuiltin(request);
        }
        return archive.originalLoad.call(this, request, parent, isMain);
      }
      const resolved = archive.resolve(request, parent?.filename);
      if (resolved) return archive.loadResolved(resolved, parent, isMain);
      return archive.originalLoad.call(this, request, parent, isMain);
    };
    Module._load = this.installedLoad;
  }

  require(request) {
    this.install();
    const resolved = this.resolve(request);
    if (!resolved) throw new Error(`Cannot resolve ${request} in ${this.archivePath}`);
    return this.loadResolved(resolved, null, false);
  }

  close() {
    if (Module._load === this.installedLoad) Module._load = this.originalLoad;
    if (Module._resolveFilename === this.installedResolve) {
      Module._resolveFilename = this.originalResolve;
    }
    for (const archivePath of this.cache.keys()) {
      delete Module._cache[this.toVirtualPath(archivePath)];
    }
    this.cache.clear();
    this.originalLoad = null;
    this.originalResolve = null;
    this.installedLoad = null;
    this.installedResolve = null;
    if (this.descriptor !== null) fs.closeSync(this.descriptor);
    this.descriptor = null;
    this.header = null;
  }
}
