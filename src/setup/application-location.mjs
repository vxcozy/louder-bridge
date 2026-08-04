import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APPLICATION_LOCATION_ERROR =
  "Move Louder Bridge.app to the Applications folder, then open it again.";

function canonicalRoot(root, realpath) {
  try {
    return realpath(root);
  } catch (error) {
    if (error?.code === "ENOENT") return path.resolve(root);
    throw error;
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function applicationLocationStatus(
  app,
  {
    homeDirectory = os.homedir(),
    systemApplications = "/Applications",
    realpath = fs.realpathSync.native,
    stat = fs.statSync,
  } = {},
) {
  try {
    const resolvedApp = realpath(app);
    const roots = [
      canonicalRoot(systemApplications, realpath),
      canonicalRoot(path.join(homeDirectory, "Applications"), realpath),
    ];
    return {
      supported:
        path.extname(resolvedApp) === ".app" &&
        stat(resolvedApp).isDirectory() &&
        roots.some((root) => isInside(root, resolvedApp)),
      resolvedApp,
    };
  } catch {
    return { supported: false, resolvedApp: null };
  }
}

export function requireSupportedApplicationLocation(app, options = {}) {
  const status = applicationLocationStatus(app, options);
  if (!status.supported) throw new Error(APPLICATION_LOCATION_ERROR);
  return status.resolvedApp;
}
