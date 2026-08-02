import test from "node:test";
import assert from "node:assert/strict";
import {
  codeSignatureMetadata,
  requireDeveloperIdSignature,
  requireHardenedRuntime,
} from "../scripts/code-signature.mjs";

const developerIdDetail = [
  "Executable=/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge",
  "Identifier=app.louder-bridge",
  "Format=Mach-O thin (arm64)",
  "CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+7 location=embedded",
  "Authority=Developer ID Application: Example Developer (ABC1234567)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "Timestamp=Aug 2, 2026 at 12:00:00 PM",
  "TeamIdentifier=ABC1234567",
].join("\n");

test("reads Developer ID signature metadata", () => {
  assert.deepEqual(codeSignatureMetadata(developerIdDetail), {
    authorities: [
      "Developer ID Application: Example Developer (ABC1234567)",
      "Developer ID Certification Authority",
      "Apple Root CA",
    ],
    teamIdentifier: "ABC1234567",
    timestamp: "Aug 2, 2026 at 12:00:00 PM",
    hardenedRuntime: true,
  });
  assert.equal(
    requireDeveloperIdSignature(developerIdDetail, {
      expectedTeamIdentifier: "ABC1234567",
      label: "Louder Bridge launcher",
    }).teamIdentifier,
    "ABC1234567",
  );
});

test("rejects incomplete or mismatched release signatures", () => {
  assert.throws(
    () => requireHardenedRuntime("flags=0x0(none)", "Louder Bridge app"),
    /missing the hardened runtime/,
  );
  assert.throws(
    () => requireDeveloperIdSignature(
      developerIdDetail.replace(/^Timestamp=.*$/m, "Timestamp=none"),
      { label: "Embedded Node.js runtime" },
    ),
    /secure signing timestamp/,
  );
  assert.throws(
    () => requireDeveloperIdSignature(developerIdDetail, {
      expectedTeamIdentifier: "OTHERTEAM1",
      label: "Louder Bridge launcher",
    }),
    /different Developer ID team/,
  );
});
