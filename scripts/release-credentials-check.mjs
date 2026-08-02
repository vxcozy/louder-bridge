#!/usr/bin/env node

const required = [
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_NOTARY_PRIVATE_KEY",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error("Release credentials are missing:");
  for (const name of missing) console.error(`- ${name}`);
  process.exitCode = 1;
} else {
  console.log("Release credentials are available.");
}
