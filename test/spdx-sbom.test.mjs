import test from "node:test";
import assert from "node:assert/strict";
import {
  addBundledComponents,
  bundledComponentIds,
} from "../scripts/spdx-sbom.mjs";

function fixture() {
  return {
    sbom: {
      spdxVersion: "SPDX-2.3",
      packages: [
        {
          SPDXID: "SPDXRef-Package-louder-bridge",
          name: "louder-bridge",
          versionInfo: "0.1.0",
        },
      ],
      relationships: [],
    },
    metadata: {
      name: "louder-bridge",
      version: "0.1.0",
      louderBridge: {
        deviceProvider: {
          protocolReference: {
            name: "FreeMicro",
            revision: "64258eb6cc3312a43f9f9f86d87e55e0b609ccc5",
            license: "MIT",
            url: "https://github.com/eliBenven/freemicro",
          },
        },
      },
    },
  };
}

const nodeSha256 = "a".repeat(64);

test("adds the embedded runtime and protocol reference to SPDX", () => {
  const { sbom, metadata } = fixture();
  const result = addBundledComponents(sbom, {
    metadata,
    nodeVersion: "v22.23.1",
    nodeSha256,
  });

  const node = result.packages.find(
    (entry) => entry.SPDXID === bundledComponentIds.node,
  );
  const protocol = result.packages.find(
    (entry) => entry.SPDXID === bundledComponentIds.protocol,
  );
  assert.equal(node.versionInfo, "22.23.1");
  assert.deepEqual(node.checksums, [
    { algorithm: "SHA256", checksumValue: nodeSha256 },
  ]);
  assert.equal(protocol.licenseDeclared, "MIT");
  assert.equal(
    protocol.versionInfo,
    "64258eb6cc3312a43f9f9f86d87e55e0b609ccc5",
  );
  assert.deepEqual(
    result.relationships.map((entry) => entry.relationshipType),
    ["CONTAINS", "OTHER"],
  );
});

test("rejects incomplete protocol provenance", () => {
  const { sbom, metadata } = fixture();
  metadata.louderBridge.deviceProvider.protocolReference.revision = "main";
  assert.throws(
    () =>
      addBundledComponents(sbom, {
        metadata,
        nodeVersion: "v22.23.1",
        nodeSha256,
      }),
    /protocol reference metadata is invalid/,
  );
});

test("rejects a missing embedded runtime checksum", () => {
  const { sbom, metadata } = fixture();
  assert.throws(
    () =>
      addBundledComponents(sbom, {
        metadata,
        nodeVersion: "v22.23.1",
      }),
    /Node\.js checksum is invalid/,
  );
});
