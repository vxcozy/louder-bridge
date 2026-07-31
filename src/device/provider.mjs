import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { legacyChatGptAsar } from "../config.mjs";
import { AsarRequire } from "../runtime/asar-require.mjs";

const DEVICE_PACKAGE = "@worklouder/device-kit-oai";
const nativeRequire = createRequire(import.meta.url);

function packageVersion(archive) {
  const packagePath = `node_modules/${DEVICE_PACKAGE}/package.json`;
  if (!archive.isFile(packagePath)) {
    throw new Error("The Codex Micro device library was not found.");
  }
  return JSON.parse(archive.readFile(packagePath).toString("utf8")).version;
}

export class LegacyChatGptProvider {
  constructor({ archivePath = legacyChatGptAsar() } = {}) {
    this.archivePath = archivePath;
    this.archive = null;
    this.version = null;
  }

  metadata() {
    return {
      id: "chatgpt-asar",
      support: "experimental",
      version: this.version,
    };
  }

  inspect() {
    if (!this.archivePath || !fs.existsSync(this.archivePath)) {
      return {
        ...this.metadata(),
        available: false,
        error: "The experimental ChatGPT device runtime was not found.",
      };
    }
    const archive = new AsarRequire(this.archivePath);
    try {
      this.version = packageVersion(archive);
      return { ...this.metadata(), available: true, error: null };
    } catch (error) {
      return {
        ...this.metadata(),
        available: false,
        error: error?.message ?? String(error),
      };
    } finally {
      archive.close();
    }
  }

  load() {
    if (!this.archivePath || !fs.existsSync(this.archivePath)) {
      throw new Error(
        "The experimental ChatGPT device runtime was not found. Louder Bridge v1 requires an approved Work Louder SDK.",
      );
    }
    this.archive = new AsarRequire(this.archivePath);
    try {
      this.version = packageVersion(this.archive);
      return this.archive.require(DEVICE_PACKAGE);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    this.archive?.close();
    this.archive = null;
  }
}

export class ExternalWorkLouderProvider {
  constructor({
    moduleSpecifier,
    support = "experimental",
    requireModule = nativeRequire,
  }) {
    if (!moduleSpecifier) {
      throw new Error("A Work Louder SDK module is required.");
    }
    this.moduleSpecifier = moduleSpecifier;
    this.support = support === "official" ? "official" : "experimental";
    this.requireModule = requireModule;
    this.version = null;
  }

  metadata() {
    return {
      id: "worklouder-sdk",
      support: this.support,
      version: this.version,
    };
  }

  inspect() {
    try {
      const resolved = this.requireModule.resolve(this.moduleSpecifier);
      const packageFile = findPackageFile(resolved);
      if (packageFile) {
        this.version = JSON.parse(fs.readFileSync(packageFile, "utf8")).version;
      }
      return { ...this.metadata(), available: true, error: null };
    } catch (error) {
      return {
        ...this.metadata(),
        available: false,
        error: error?.message ?? String(error),
      };
    }
  }

  load() {
    const kit = this.requireModule(this.moduleSpecifier);
    this.inspect();
    return kit.default ?? kit;
  }

  close() {}
}

function findPackageFile(moduleFile) {
  let directory = path.dirname(moduleFile);
  for (;;) {
    const candidate = path.join(directory, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function createDeviceProvider(environment = process.env) {
  if (environment.LOUDER_WORKLOUDER_SDK) {
    return new ExternalWorkLouderProvider({
      moduleSpecifier: environment.LOUDER_WORKLOUDER_SDK,
      support: environment.LOUDER_WORKLOUDER_SDK_SUPPORT,
    });
  }
  return new LegacyChatGptProvider();
}
