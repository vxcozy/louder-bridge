import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";

const APP_NAME = "Louder Bridge.app";
const MAX_INFO_PLIST_BYTES = 1024 * 1024;
const BUNDLE_IDENTIFIER_PATTERN =
  /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*app\.louder-bridge\s*<\/string>/;
const BUNDLE_EXECUTABLE_PATTERN =
  /<key>\s*CFBundleExecutable\s*<\/key>\s*<string>\s*LouderBridge\s*<\/string>/;

function pathEntry(filename) {
  try {
    return fs.lstatSync(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function bundleIdentity(entry) {
  return { device: entry.dev, inode: entry.ino };
}

function sameBundle(expected, actual) {
  return Boolean(
    expected &&
      actual &&
      expected.device === actual.device &&
      expected.inode === actual.inode,
  );
}

function invalidBundleError() {
  return new Error(
    "Setup found an app at the Louder Bridge install location, but its bundle identifier or executable does not match Louder Bridge.",
  );
}

function inspectApplicationBundle(app) {
  const entry = pathEntry(app);
  if (!entry || !entry.isDirectory() || entry.isSymbolicLink()) {
    throw invalidBundleError();
  }

  const contents = pathEntry(path.join(app, "Contents"));
  if (!contents || !contents.isDirectory() || contents.isSymbolicLink()) {
    throw invalidBundleError();
  }

  const infoPlist = path.join(app, "Contents", "Info.plist");
  let descriptor;
  try {
    descriptor = fs.openSync(
      infoPlist,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    const metadata = fs.fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > MAX_INFO_PLIST_BYTES
    ) {
      throw invalidBundleError();
    }
    const plist = fs.readFileSync(descriptor, "utf8");
    const current = pathEntry(app);
    if (
      !current ||
      !sameBundle(bundleIdentity(entry), bundleIdentity(current)) ||
      !BUNDLE_IDENTIFIER_PATTERN.test(plist) ||
      !BUNDLE_EXECUTABLE_PATTERN.test(plist)
    ) {
      throw invalidBundleError();
    }
  } catch (error) {
    if (error?.message?.includes("does not match Louder Bridge")) {
      throw error;
    }
    throw invalidBundleError();
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  return bundleIdentity(entry);
}

function requireBundle(app, identity, message) {
  let current;
  try {
    current = inspectApplicationBundle(app);
  } catch {
    throw new Error(message);
  }
  if (!sameBundle(identity, current)) throw new Error(message);
  return current;
}

function requireInstallPathState(app, identity) {
  const current = pathEntry(app);
  if (!identity && !current) return;
  if (!identity || !current) {
    throw new Error("The application path changed during setup.");
  }
  requireBundle(
    app,
    identity,
    "The application path changed during setup.",
  );
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function applicationBundlePaths(homeDirectory = os.homedir()) {
  return applicationBundlePathsForApp(
    path.join(homeDirectory, "Applications", APP_NAME),
  );
}

export function applicationBundlePathsForApp(app) {
  const contents = path.join(app, "Contents");
  const resources = path.join(contents, "Resources", "app");
  return {
    app,
    contents,
    infoPlist: path.join(contents, "Info.plist"),
    launcher: path.join(contents, "MacOS", "LouderBridge"),
    node: path.join(contents, "MacOS", "node"),
    resources,
    cli: path.join(resources, "src", "cli.mjs"),
    hook: path.join(resources, "src", "hook.mjs"),
    workingDirectory: resources,
  };
}

export function applicationBundlePathsForCli(cliPath) {
  const app = path.resolve(path.dirname(cliPath), "../../../..");
  if (path.extname(app) !== ".app") {
    throw new Error("This command must run from an installed Louder Bridge app.");
  }
  return applicationBundlePathsForApp(app);
}

export function applicationInfoPlist({ version = "0.1.0" } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDisplayName</key>
    <string>Louder Bridge</string>
    <key>CFBundleExecutable</key>
    <string>LouderBridge</string>
    <key>CFBundleIdentifier</key>
    <string>app.louder-bridge</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Louder Bridge</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${xmlEscape(version)}</string>
    <key>CFBundleVersion</key>
    <string>${xmlEscape(version)}</string>
    <key>LSBackgroundOnly</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>15.0</string>
    <key>NSAccessibilityUsageDescription</key>
    <string>Louder Bridge uses Accessibility to control Claude dictation while you hold the Micro's MIC key.</string>
  </dict>
</plist>
`;
}

function launcherScript() {
  return `#!/bin/sh
CONTENTS_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec "$CONTENTS_DIR/MacOS/node" "$CONTENTS_DIR/Resources/app/src/cli.mjs" activate
`;
}

function sourceRootFromModule() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function installApplicationBundle({
  homeDirectory = os.homedir(),
  sourceRoot = sourceRootFromModule(),
  nodePath = process.execPath,
  buildRevision = null,
  prepare = () => {},
  beforeReplace = () => {},
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The application bundle currently requires macOS.");
  }
  const paths = applicationBundlePaths(homeDirectory);
  const existingEntry = pathEntry(paths.app);
  const existingIdentity = existingEntry
    ? inspectApplicationBundle(paths.app)
    : null;
  const sourceDirectory = path.join(sourceRoot, "src");
  const packageFile = path.join(sourceRoot, "package.json");
  const projectLicense = path.join(sourceRoot, "LICENSE");
  const nodeLicense = [
    path.resolve(path.dirname(nodePath), "../LICENSE"),
    path.join(path.dirname(nodePath), "LICENSE"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!fs.statSync(nodePath).isFile()) {
    throw new Error(`Node executable not found at ${nodePath}.`);
  }
  if (!fs.statSync(sourceDirectory).isDirectory()) {
    throw new Error(`Louder Bridge source not found at ${sourceDirectory}.`);
  }
  if (!fs.existsSync(projectLicense)) {
    throw new Error(`Louder Bridge license not found at ${projectLicense}.`);
  }
  if (!nodeLicense) {
    throw new Error("Node.js license was not found beside its executable.");
  }
  const metadata = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  if (
    buildRevision !== null &&
    !/^[a-f0-9]{40}(?:\+dirty)?$/.test(buildRevision)
  ) {
    throw new Error("The application build revision is invalid.");
  }
  const projectThirdPartyLicenses = path.join(
    sourceRoot,
    "THIRD_PARTY_LICENSES",
  );
  const parent = path.dirname(paths.app);
  const staging = path.join(parent, `.${APP_NAME}.${randomUUID()}.tmp`);
  const backup = path.join(parent, `.${APP_NAME}.${randomUUID()}.previous`);
  fs.mkdirSync(parent, { recursive: true });
  let stagingDirectoryIdentity;
  let stagedIdentity;
  let backupIdentity;

  try {
    const staged = applicationBundlePathsForApp(staging);

    fs.mkdirSync(path.dirname(staged.node), { recursive: true });
    stagingDirectoryIdentity = bundleIdentity(fs.lstatSync(staging));
    fs.mkdirSync(staged.resources, { recursive: true });
    fs.copyFileSync(nodePath, staged.node);
    fs.chmodSync(staged.node, 0o755);
    fs.cpSync(sourceDirectory, path.join(staged.resources, "src"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.copyFileSync(projectLicense, path.join(staged.resources, "LICENSE"));
    const bundledPackage = path.join(staged.resources, "package.json");
    if (buildRevision) {
      metadata.louderBridge = {
        ...metadata.louderBridge,
        buildRevision,
      };
      writeFileAtomic(
        bundledPackage,
        `${JSON.stringify(metadata, null, 2)}\n`,
        { mode: 0o644 },
      );
    } else {
      fs.copyFileSync(packageFile, bundledPackage);
    }
    const thirdPartyLicenses = path.join(
      staged.resources,
      "THIRD_PARTY_LICENSES",
    );
    if (fs.existsSync(projectThirdPartyLicenses)) {
      fs.cpSync(projectThirdPartyLicenses, thirdPartyLicenses, {
        recursive: true,
      });
    } else {
      fs.mkdirSync(thirdPartyLicenses, { recursive: true });
    }
    fs.copyFileSync(
      nodeLicense,
      path.join(thirdPartyLicenses, "Node.js-LICENSE"),
    );
    writeFileAtomic(staged.infoPlist, applicationInfoPlist(metadata), {
      mode: 0o644,
    });
    writeFileAtomic(staged.launcher, launcherScript(), { mode: 0o755 });
    prepare(staged);
    stagedIdentity = inspectApplicationBundle(staging);
    requireInstallPathState(paths.app, existingIdentity);
    beforeReplace(staged);
    requireInstallPathState(paths.app, existingIdentity);

    if (existingIdentity) {
      requireBundle(
        paths.app,
        existingIdentity,
        "The installed application changed before it could be replaced.",
      );
      fs.renameSync(paths.app, backup);
      backupIdentity = requireBundle(
        backup,
        existingIdentity,
        "The previous application changed while setup was moving it into backup.",
      );
    }
    try {
      fs.renameSync(staging, paths.app);
      requireBundle(
        paths.app,
        stagedIdentity,
        "The installed application changed before setup could finish.",
      );
    } catch (error) {
      if (backupIdentity && pathEntry(backup)) {
        requireBundle(
          backup,
          backupIdentity,
          "The previous application backup changed before setup could restore it.",
        );
        if (pathEntry(paths.app)) {
          throw new Error(
            "Setup could not install Louder Bridge. The previous app remains in backup because the application path is occupied.",
            { cause: error },
          );
        }
        fs.renameSync(backup, paths.app);
      }
      throw error;
    }
  } catch (error) {
    const stagingEntry = pathEntry(staging);
    if (stagingEntry) {
      if (
        !sameBundle(stagingDirectoryIdentity, bundleIdentity(stagingEntry))
      ) {
        throw new Error(
          "Setup left its staging path untouched because it changed unexpectedly.",
          { cause: error },
        );
      }
      fs.rmSync(staging, { recursive: true });
    }
    throw error;
  }

  return {
    ...paths,
    kind: "install",
    installedIdentity: stagedIdentity,
    backup: pathEntry(backup) ? backup : null,
    backupIdentity,
  };
}

export function commitApplicationBundle(transaction) {
  if (transaction.backup && pathEntry(transaction.backup)) {
    requireBundle(
      transaction.backup,
      transaction.backupIdentity,
      "The application backup changed before setup could remove it. It was left untouched.",
    );
    fs.rmSync(transaction.backup, { recursive: true });
  }
}

export function rollbackApplicationBundle(transaction) {
  if (transaction.backup && pathEntry(transaction.backup)) {
    requireBundle(
      transaction.backup,
      transaction.backupIdentity,
      "The application backup changed during rollback. It was left untouched.",
    );
  } else if (transaction.backup) {
    throw new Error(
      "The application backup is missing, so rollback left the installed app untouched.",
    );
  }

  if (pathEntry(transaction.app)) {
    if (transaction.kind !== "install") {
      throw new Error(
        "The application path became occupied during rollback. The new item was left untouched.",
      );
    }
    requireBundle(
      transaction.app,
      transaction.installedIdentity,
      "The installed application changed during rollback. It was left untouched.",
    );
    fs.rmSync(transaction.app, { recursive: true });
  }
  if (transaction.backup) {
    requireBundle(
      transaction.backup,
      transaction.backupIdentity,
      "The application backup changed during rollback. It was left untouched.",
    );
    fs.renameSync(transaction.backup, transaction.app);
  }
}

export function stageApplicationBundleRemoval({
  homeDirectory = os.homedir(),
  app = applicationBundlePaths(homeDirectory).app,
} = {}) {
  const paths = applicationBundlePathsForApp(app);
  const entry = pathEntry(paths.app);
  if (!entry) {
    return {
      ...paths,
      kind: "removal",
      backup: null,
      backupIdentity: null,
    };
  }
  const identity = inspectApplicationBundle(paths.app);
  const backup = path.join(
    path.dirname(paths.app),
    `.${APP_NAME}.${randomUUID()}.removing`,
  );
  requireBundle(
    paths.app,
    identity,
    "The installed application changed before removal could begin.",
  );
  fs.renameSync(paths.app, backup);
  const backupIdentity = requireBundle(
    backup,
    identity,
    "The application changed while removal was moving it into backup.",
  );
  return { ...paths, kind: "removal", backup, backupIdentity };
}

export function removeApplicationBundle({
  homeDirectory = os.homedir(),
} = {}) {
  const paths = applicationBundlePaths(homeDirectory);
  if (pathEntry(paths.app)) {
    const identity = inspectApplicationBundle(paths.app);
    requireBundle(
      paths.app,
      identity,
      "The installed application changed before it could be removed.",
    );
    fs.rmSync(paths.app, { recursive: true });
  }
  return paths;
}
