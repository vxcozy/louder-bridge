export function codeSignatureMetadata(detail) {
  const authorities = [];
  let teamIdentifier = null;
  let timestamp = null;
  for (const line of String(detail).split(/\r?\n/)) {
    if (line.startsWith("Authority=")) {
      authorities.push(line.slice("Authority=".length));
    } else if (line.startsWith("TeamIdentifier=")) {
      teamIdentifier = line.slice("TeamIdentifier=".length);
    } else if (line.startsWith("Timestamp=")) {
      timestamp = line.slice("Timestamp=".length);
    }
  }
  return {
    authorities,
    teamIdentifier,
    timestamp,
    hardenedRuntime: /\bflags=.*\bruntime\b/.test(String(detail)),
  };
}

export function requireHardenedRuntime(detail, label) {
  const metadata = codeSignatureMetadata(detail);
  if (!metadata.hardenedRuntime) {
    throw new Error(`${label} is missing the hardened runtime.`);
  }
  return metadata;
}

export function requireDeveloperIdSignature(
  detail,
  {
    expectedTeamIdentifier,
    label,
    requireTimestamp = true,
  },
) {
  const metadata = requireHardenedRuntime(detail, label);
  if (!metadata.authorities[0]?.startsWith("Developer ID Application:")) {
    throw new Error(`${label} is not signed with Developer ID Application.`);
  }
  if (
    !metadata.teamIdentifier ||
    metadata.teamIdentifier.toLowerCase() === "not set"
  ) {
    throw new Error(`${label} does not identify its Developer ID team.`);
  }
  if (
    expectedTeamIdentifier &&
    metadata.teamIdentifier !== expectedTeamIdentifier
  ) {
    throw new Error(`${label} is signed by a different Developer ID team.`);
  }
  if (
    requireTimestamp &&
    (!metadata.timestamp || metadata.timestamp.toLowerCase() === "none")
  ) {
    throw new Error(`${label} does not have a secure signing timestamp.`);
  }
  return metadata;
}
