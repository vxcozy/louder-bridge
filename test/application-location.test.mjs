import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  APPLICATION_LOCATION_ERROR,
  applicationLocationStatus,
  requireSupportedApplicationLocation,
} from "../src/setup/application-location.mjs";

function fixture(context) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "louder-bridge-app-location-"),
  );
  context.after(() => fs.rmSync(root, { recursive: true }));
  const systemApplications = path.join(root, "system", "Applications");
  const homeDirectory = path.join(root, "user");
  const userApplications = path.join(homeDirectory, "Applications");
  const downloads = path.join(homeDirectory, "Downloads");
  const translocation = path.join(
    root,
    "AppTranslocation",
    "random",
    "d",
  );
  for (const directory of [
    systemApplications,
    userApplications,
    downloads,
    translocation,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return { systemApplications, homeDirectory, downloads, translocation };
}

function app(directory, name = "Louder Bridge.app") {
  const bundle = path.join(directory, name);
  fs.mkdirSync(bundle, { recursive: true });
  return bundle;
}

test("accepts app bundles in system and per-user Applications", (context) => {
  const locations = fixture(context);
  const systemApp = app(locations.systemApplications);
  const userApp = app(
    path.join(locations.homeDirectory, "Applications", "Utilities"),
  );
  const options = {
    homeDirectory: locations.homeDirectory,
    systemApplications: locations.systemApplications,
  };

  assert.equal(applicationLocationStatus(systemApp, options).supported, true);
  assert.equal(applicationLocationStatus(userApp, options).supported, true);
  assert.equal(
    requireSupportedApplicationLocation(userApp, options),
    fs.realpathSync.native(userApp),
  );
});

test("rejects Downloads and App Translocation locations", (context) => {
  const locations = fixture(context);
  const options = {
    homeDirectory: locations.homeDirectory,
    systemApplications: locations.systemApplications,
  };

  for (const candidate of [
    app(locations.downloads),
    app(locations.translocation),
  ]) {
    assert.equal(
      applicationLocationStatus(candidate, options).supported,
      false,
    );
    assert.throws(
      () => requireSupportedApplicationLocation(candidate, options),
      (error) => {
        assert.equal(error.message, APPLICATION_LOCATION_ERROR);
        assert.doesNotMatch(error.message, new RegExp(locations.homeDirectory));
        return true;
      },
    );
  }
});

test("uses the resolved bundle location when an app path is a symlink", (context) => {
  const locations = fixture(context);
  const options = {
    homeDirectory: locations.homeDirectory,
    systemApplications: locations.systemApplications,
  };
  const installed = app(locations.systemApplications, "Installed.app");
  const downloaded = app(locations.downloads, "Downloaded.app");
  const aliasToInstalled = path.join(locations.downloads, "Installed.app");
  const aliasToDownload = path.join(
    locations.systemApplications,
    "Downloaded.app",
  );
  fs.symlinkSync(installed, aliasToInstalled);
  fs.symlinkSync(downloaded, aliasToDownload);

  assert.equal(
    applicationLocationStatus(aliasToInstalled, options).supported,
    true,
  );
  assert.equal(
    applicationLocationStatus(aliasToDownload, options).supported,
    false,
  );
});

test("rejects missing paths, files, and directories without an app suffix", (context) => {
  const locations = fixture(context);
  const options = {
    homeDirectory: locations.homeDirectory,
    systemApplications: locations.systemApplications,
  };
  const file = path.join(locations.systemApplications, "Not a bundle.app");
  const directory = path.join(locations.systemApplications, "Not a bundle");
  fs.writeFileSync(file, "not an app");
  fs.mkdirSync(directory);

  for (const candidate of [file, directory, `${directory}.missing`]) {
    assert.deepEqual(applicationLocationStatus(candidate, options), {
      supported: false,
      resolvedApp: fs.existsSync(candidate)
        ? fs.realpathSync.native(candidate)
        : null,
    });
  }
});
