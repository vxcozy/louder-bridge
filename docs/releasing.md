# Release Louder Bridge

This guide is for maintainers preparing a macOS release.

## Configure GitHub once

Create a `production` environment and add these environment secrets:

| Secret | Value |
|---|---|
| `MACOS_CERTIFICATE` | Base64-encoded Developer ID Application PKCS#12 file |
| `MACOS_CERTIFICATE_PASSWORD` | Password for the PKCS#12 file |
| `KEYCHAIN_PASSWORD` | Random password used only for the temporary CI keychain |
| `APPLE_SIGNING_IDENTITY` | Full Developer ID Application identity |
| `APPLE_NOTARY_KEY_ID` | App Store Connect API key ID |
| `APPLE_NOTARY_ISSUER_ID` | App Store Connect issuer ID |
| `APPLE_NOTARY_PRIVATE_KEY` | Contents of the App Store Connect `.p8` key |

The release workflow stops at its credential check if a value is missing or
malformed. The check validates the certificate encoding and Developer ID
identity. It also checks the App Store Connect identifiers and private-key
format. It never prints secret values. Apple verifies the certificate password
during import. Restrict the environment to maintainers who are allowed to
prepare releases.

Checkout does not save the GitHub token in git configuration. The workflow
runs its source gates before passing signing credentials to a repository
script. It passes a write-capable GitHub token only to the step that creates
the draft release.

## Qualify the source

Choose a semantic version and update `package.json` and `CHANGELOG.md`. Write
the public notes in `release-notes/v<version>.md`, then run `/humanizer` on the
complete file. The release workflow uses that file as written. It does not
generate public copy.

Run the source checks:

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
nested executable and the outer bundle, then starts the embedded runtime
through the signed launcher. The launcher also runs the packaged location
preflight from the staged Applications directory. The command creates an Apple
Silicon ZIP, a SHA-256 checksum, and an SPDX SBOM.

The build rejects signing identities that are not Developer ID Application
certificates. An unset identity produces an ad hoc build for local testing
only. Do not publish it.

In CI, the signing identity lives in a temporary keychain. The workflow adds
that keychain to the existing user search list, passes it directly to
`codesign`, restores the original list, and deletes the keychain even when a
later step fails.

The SBOM records the exact Git revision. Ad hoc builds add a `+dirty` marker
when the checkout has uncommitted changes. Developer ID builds require a clean
checkout, and verification compares the SBOM revision with the current source.

Final verification checks the app, launcher, and embedded Node.js runtime
separately. All three must use the same Developer ID team, carry hardened
runtime signatures, and include secure timestamps. The verifier also rejects
unsafe archive paths, links, special files, group- or world-writable entries,
and binaries that are not arm64-only. Before extraction, it limits the archive
to 512 entries, 256 MiB compressed, and 512 MiB uncompressed. The project and
protocol licenses must match their reviewed source files, and the Node.js
license must be present and complete.

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

GitHub serializes workflow runs for the same tag. If a run stops after creating
the draft, rerun the failed job. The next run updates that draft and replaces
the three expected assets. It then compares their names and byte sizes with the
local files. The job stops if the release has already been published or if the
draft contains another asset, so a maintainer can inspect it.

Download the ZIP from that draft rather than reusing a local build. Run the
full [hardware acceptance checklist](testing.md) against the download. Test a
clean install, an upgrade, both first-launch permissions, login startup, Micro
power cycling, Claude lifecycle states, Agent Key navigation, push-to-talk,
and removal.

Record the tested component versions in the draft notes. If qualification
changes the notes, run `/humanizer` again and update the draft with the reviewed
file. Another maintainer must review the notes and the other public text in the
release.

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
