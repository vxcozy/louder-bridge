import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const script = path.join(root, "scripts", "release-credentials-check.mjs");
const credentialNames = [
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_NOTARY_PRIVATE_KEY",
];

function run(values = {}) {
  const env = { ...process.env };
  for (const name of credentialNames) delete env[name];
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...env, ...values },
  });
}

test("reports every missing release credential", () => {
  const result = run();
  assert.equal(result.status, 1);
  for (const name of credentialNames) {
    assert.match(result.stderr, new RegExp(name));
  }
});

test("accepts a complete release credential environment", () => {
  const values = Object.fromEntries(
    credentialNames.map((name) => [name, "configured-for-test"]),
  );
  const result = run(values);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release credentials are available/);
});
