import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic-file.mjs";

const APP_NAME = "Louder Bridge.app";

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
  prepare = () => {},
} = {}) {
  if (process.platform !== "darwin") {
    throw new Error("The application bundle currently requires macOS.");
  }
  const paths = applicationBundlePaths(homeDirectory);
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
  const parent = path.dirname(paths.app);
  const staging = path.join(parent, `.${APP_NAME}.${randomUUID()}.tmp`);
  const backup = path.join(parent, `.${APP_NAME}.${randomUUID()}.previous`);
  fs.mkdirSync(parent, { recursive: true });

  try {
    const staged = applicationBundlePathsForApp(staging);

    fs.mkdirSync(path.dirname(staged.node), { recursive: true });
    fs.mkdirSync(staged.resources, { recursive: true });
    fs.copyFileSync(nodePath, staged.node);
    fs.chmodSync(staged.node, 0o755);
    fs.cpSync(sourceDirectory, path.join(staged.resources, "src"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    fs.copyFileSync(projectLicense, path.join(staged.resources, "LICENSE"));
    fs.copyFileSync(packageFile, path.join(staged.resources, "package.json"));
    const thirdPartyLicenses = path.join(
      staged.resources,
      "THIRD_PARTY_LICENSES",
    );
    fs.mkdirSync(thirdPartyLicenses, { recursive: true });
    fs.copyFileSync(
      nodeLicense,
      path.join(thirdPartyLicenses, "Node.js-LICENSE"),
    );
    writeFileAtomic(staged.infoPlist, applicationInfoPlist(metadata), {
      mode: 0o644,
    });
    writeFileAtomic(staged.launcher, launcherScript(), { mode: 0o755 });
    prepare(staged);

    if (fs.existsSync(paths.app)) fs.renameSync(paths.app, backup);
    try {
      fs.renameSync(staging, paths.app);
    } catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, paths.app);
      throw error;
    }
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
    throw error;
  }

  return {
    ...paths,
    backup: fs.existsSync(backup) ? backup : null,
  };
}

export function commitApplicationBundle(transaction) {
  if (transaction.backup && fs.existsSync(transaction.backup)) {
    fs.rmSync(transaction.backup, { recursive: true });
  }
}

export function rollbackApplicationBundle(transaction) {
  if (fs.existsSync(transaction.app)) {
    fs.rmSync(transaction.app, { recursive: true });
  }
  if (transaction.backup && fs.existsSync(transaction.backup)) {
    fs.renameSync(transaction.backup, transaction.app);
  }
}

export function stageApplicationBundleRemoval({
  homeDirectory = os.homedir(),
  app = applicationBundlePaths(homeDirectory).app,
} = {}) {
  const paths = applicationBundlePathsForApp(app);
  if (!fs.existsSync(paths.app)) return { ...paths, backup: null };
  const backup = path.join(
    path.dirname(paths.app),
    `.${APP_NAME}.${randomUUID()}.removing`,
  );
  fs.renameSync(paths.app, backup);
  return { ...paths, backup };
}

export function removeApplicationBundle({
  homeDirectory = os.homedir(),
} = {}) {
  const paths = applicationBundlePaths(homeDirectory);
  if (fs.existsSync(paths.app)) fs.rmSync(paths.app, { recursive: true });
  return paths;
}
