const NODE_SPDX_ID = "SPDXRef-Package-Node-js-Runtime";
const PROTOCOL_SPDX_ID = "SPDXRef-Package-FreeMicro-Protocol-Reference";

function rootPackage(sbom, metadata) {
  return sbom.packages?.find(
    (entry) =>
      entry.name === metadata.name &&
      entry.versionInfo === metadata.version,
  );
}

export function addBundledComponents(
  sbom,
  { metadata, nodeVersion, nodeSha256 },
) {
  const root = rootPackage(sbom, metadata);
  if (!root?.SPDXID) {
    throw new Error("The generated SBOM does not contain the project package.");
  }
  const protocol =
    metadata.louderBridge?.deviceProvider?.protocolReference;
  if (
    !protocol ||
    !/^[a-f0-9]{40}$/.test(protocol.revision ?? "") ||
    protocol.license !== "MIT" ||
    !URL.canParse(protocol.url)
  ) {
    throw new Error("The Codex Micro protocol reference metadata is invalid.");
  }
  const normalizedNodeVersion = String(nodeVersion).replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalizedNodeVersion)) {
    throw new Error("The embedded Node.js version is invalid.");
  }
  if (!/^[a-f0-9]{64}$/.test(nodeSha256 ?? "")) {
    throw new Error("The embedded Node.js checksum is invalid.");
  }

  sbom.packages.push(
    {
      SPDXID: NODE_SPDX_ID,
      name: "Node.js runtime",
      versionInfo: normalizedNodeVersion,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      checksums: [
        {
          algorithm: "SHA256",
          checksumValue: nodeSha256,
        },
      ],
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:generic/node@${normalizedNodeVersion}`,
        },
      ],
    },
    {
      SPDXID: PROTOCOL_SPDX_ID,
      name: `${protocol.name} protocol reference`,
      versionInfo: protocol.revision,
      downloadLocation: `${protocol.url}/tree/${protocol.revision}`,
      filesAnalyzed: false,
      licenseConcluded: protocol.license,
      licenseDeclared: protocol.license,
      copyrightText: "Copyright (c) 2026 Eli Benveniste",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator:
            `pkg:github/eliBenven/freemicro@${protocol.revision}`,
        },
      ],
    },
  );
  sbom.relationships ??= [];
  sbom.relationships.push(
    {
      spdxElementId: root.SPDXID,
      relationshipType: "CONTAINS",
      relatedSpdxElement: NODE_SPDX_ID,
    },
    {
      spdxElementId: root.SPDXID,
      relationshipType: "OTHER",
      relatedSpdxElement: PROTOCOL_SPDX_ID,
      comment: "Used as the licensed Codex Micro protocol reference.",
    },
  );
  return sbom;
}

export const bundledComponentIds = {
  node: NODE_SPDX_ID,
  protocol: PROTOCOL_SPDX_ID,
};
