import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
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
const { privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const certificate = Buffer.concat([
  Buffer.from([0x30, 0x7e]),
  Buffer.alloc(126, 1),
]).toString("base64");
const validCredentials = {
  MACOS_CERTIFICATE: certificate,
  MACOS_CERTIFICATE_PASSWORD: "certificate-password",
  KEYCHAIN_PASSWORD: "keychain-password",
  APPLE_SIGNING_IDENTITY:
    "Developer ID Application: Louder Bridge Test (ABC1234567)",
  APPLE_NOTARY_KEY_ID: "A1B2C3D4E5",
  APPLE_NOTARY_ISSUER_ID: "12345678-1234-1234-1234-1234567890ab",
  APPLE_NOTARY_PRIVATE_KEY: privateKey.export({
    format: "pem",
    type: "pkcs8",
  }),
};

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
  const result = run(validCredentials);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release credentials are available/);
});

test("rejects malformed release credentials without printing their values", () => {
  const invalid = {
    ...validCredentials,
    MACOS_CERTIFICATE: "not-base64",
    APPLE_SIGNING_IDENTITY: "Apple Development: wrong identity",
    APPLE_NOTARY_KEY_ID: "short-key",
    APPLE_NOTARY_ISSUER_ID: "not-a-uuid",
    APPLE_NOTARY_PRIVATE_KEY: "not-a-private-key",
  };
  const result = run(invalid);

  assert.equal(result.status, 1);
  for (const name of [
    "MACOS_CERTIFICATE",
    "APPLE_SIGNING_IDENTITY",
    "APPLE_NOTARY_KEY_ID",
    "APPLE_NOTARY_ISSUER_ID",
    "APPLE_NOTARY_PRIVATE_KEY",
  ]) {
    assert.match(result.stderr, new RegExp(name));
  }
  for (const value of Object.values(invalid)) {
    assert.doesNotMatch(result.stderr, new RegExp(String(value).slice(0, 20)));
  }
});
