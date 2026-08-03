#!/usr/bin/env node

import { createPrivateKey } from "node:crypto";

const required = [
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_NOTARY_KEY_ID",
  "APPLE_NOTARY_ISSUER_ID",
  "APPLE_NOTARY_PRIVATE_KEY",
];

function decodeBase64(value) {
  const normalized = value.replace(/\s/g, "");
  if (
    normalized.length < 4 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    return null;
  }
  const decoded = Buffer.from(normalized, "base64");
  return decoded.toString("base64") === normalized ? decoded : null;
}

function isDerSequence(value) {
  const bytes = decodeBase64(value);
  if (!bytes || bytes.length < 64 || bytes[0] !== 0x30) return false;
  const firstLength = bytes[1];
  if (firstLength < 0x80) return firstLength + 2 === bytes.length;
  const lengthBytes = firstLength & 0x7f;
  if (
    lengthBytes < 1 ||
    lengthBytes > 6 ||
    bytes.length < 2 + lengthBytes ||
    bytes[2] === 0
  ) {
    return false;
  }
  let contentLength = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    contentLength = contentLength * 256 + bytes[index + 2];
  }
  return (
    Number.isSafeInteger(contentLength) &&
    contentLength + 2 + lengthBytes === bytes.length
  );
}

function isAppStoreConnectPrivateKey(value) {
  try {
    const key = createPrivateKey(value);
    return (
      key.asymmetricKeyType === "ec" &&
      key.asymmetricKeyDetails?.namedCurve === "prime256v1"
    );
  } catch {
    return false;
  }
}

const problems = required
  .filter((name) => !process.env[name]?.trim())
  .map((name) => `${name} is missing.`);

if (
  process.env.MACOS_CERTIFICATE?.trim() &&
  !isDerSequence(process.env.MACOS_CERTIFICATE)
) {
  problems.push(
    "MACOS_CERTIFICATE must contain base64-encoded PKCS#12 data.",
  );
}
if (
  process.env.APPLE_SIGNING_IDENTITY?.trim() &&
  !/^Developer ID Application: [^\r\n]+ \([A-Z0-9]{10}\)$/.test(
    process.env.APPLE_SIGNING_IDENTITY,
  )
) {
  problems.push(
    "APPLE_SIGNING_IDENTITY must be a full Developer ID Application identity.",
  );
}
if (
  process.env.APPLE_NOTARY_KEY_ID?.trim() &&
  !/^[A-Z0-9]{10}$/.test(process.env.APPLE_NOTARY_KEY_ID)
) {
  problems.push("APPLE_NOTARY_KEY_ID must be a 10-character key ID.");
}
if (
  process.env.APPLE_NOTARY_ISSUER_ID?.trim() &&
  !/^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/i.test(
    process.env.APPLE_NOTARY_ISSUER_ID,
  )
) {
  problems.push("APPLE_NOTARY_ISSUER_ID must be a UUID.");
}
if (
  process.env.APPLE_NOTARY_PRIVATE_KEY?.trim() &&
  !isAppStoreConnectPrivateKey(process.env.APPLE_NOTARY_PRIVATE_KEY)
) {
  problems.push(
    "APPLE_NOTARY_PRIVATE_KEY must contain a P-256 private key in PEM format.",
  );
}

if (problems.length) {
  console.error("Release credential check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("Release credentials are available.");
}
