# Release Louder Bridge

This guide is for maintainers preparing a macOS release.

## Qualify the source

Choose a semantic version, update `package.json` and `CHANGELOG.md`, then run:

```bash
npm test
npm run authorship:check
npm run security:check
npm run release:check
```

The release check compares a release tag with the package version. It also
refuses a stable version while the device driver, session navigator, or voice
interface is experimental.

## Build and sign

Set `APPLE_SIGNING_IDENTITY` to a Developer ID Application identity and run:

```bash
npm run release:build
```

The command compiles the native permission helper, builds the app, signs each
nested executable and the outer bundle, and verifies the result. It creates an
Apple Silicon ZIP, a SHA-256 checksum, and an SPDX SBOM.

The build rejects signing identities that are not Developer ID Application
certificates. An unset identity produces an ad hoc build for local testing
only. Do not publish it.

## Notarize

Create a `notarytool` keychain profile outside the repository and set
`APPLE_NOTARY_PROFILE` to its name. You can instead provide an App Store
Connect key through `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID`, and
`APPLE_NOTARY_KEY_PATH`.

Keep `APPLE_SIGNING_IDENTITY` set, then run:

```bash
npm run release:notarize
```

The command submits the ZIP, waits for Apple's result, staples and validates
the ticket, rebuilds the archive and checksum, and asks Gatekeeper to assess
the app.

Verify the final files:

```bash
LOUDER_REQUIRE_NOTARIZED=1 npm run release:verify
```

This follows Apple's [Developer ID and notarization
requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Never commit a certificate, private key, App Store Connect key, keychain, or
notary credential.

## Create and test the draft

Push the version tag. The release workflow creates a draft GitHub release and
attaches the notarized ZIP, checksum, and SBOM. It does not publish the release.

Download the ZIP from that draft rather than reusing a local build. Run the
full [hardware acceptance checklist](testing.md) against the download. Test a
clean install, an upgrade, both first-launch permissions, login startup, Micro
power cycling, Claude lifecycle states, Agent Key navigation, push-to-talk,
and removal.

Record the tested component versions in the draft notes. Run `/humanizer` on
the complete notes, then have another maintainer review them and the other
public text in the release.

Publish the draft only when the checklist passes. Keep the notarized ZIP, its
checksum, the SPDX SBOM, and the previous release available for rollback:

```bash
gh release edit "v<version>" --draft=false
```

The tag workflow runs on GitHub's native arm64 macOS runner. Tags below v1 are
marked as prereleases. The `production` environment must hold the Developer ID
certificate and App Store Connect secrets.

Run `/humanizer` on release notes and other public text before tagging. Release
commits and notes must contain no automated authorship credit or authorship
trailers.
