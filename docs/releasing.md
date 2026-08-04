# Release Louder Bridge

This guide is for maintainers preparing a macOS release.

## Qualify the source

Choose a semantic version and update `package.json` and `CHANGELOG.md`. Write
the public notes in `release-notes/v<version>.md`, then run `/humanizer` on the
complete file. The release workflow uses that file as written.

Run the source checks:

```bash
npm test
npm run authorship:check
npm run security:check
npm run release:check
```

The release check compares a release tag with the package version. It also
keeps stable versions from being published while the device, navigation, or
voice interface is experimental.

## Build and verify

Run:

```bash
npm run release:build
npm run release:verify
```

The build compiles the native permission helper, assembles the app, applies an
ad-hoc signature, and tests the packaged launcher. It creates an Apple Silicon
ZIP, a SHA-256 checksum, and an SPDX SBOM in `dist/`.

An ad-hoc signature lets macOS verify that the bundle has not changed after it
was built. It is not a Developer ID signature and does not identify the
publisher to Apple. Louder Bridge does not require an Apple Developer account
for its normal release process.

Verification checks the checksum, SBOM, Git revision, archive layout,
licenses, hardened runtime, entitlements, and arm64 architecture. It also
rejects unsafe archive paths, links, special files, writable executables, and
unexpected files.

## Create the draft release

Push the version tag. The release workflow builds the same package on GitHub's
native arm64 macOS runner, verifies it, and creates a draft release containing
the ZIP, checksum, and SBOM. It does not publish the release.

Release jobs for the same tag run one at a time. A rerun updates the existing
draft and replaces the three expected files. The publisher checks the digest,
size, and upload state of every file.

## Test the downloaded app

Download the ZIP from the draft release instead of reusing a local build.
Verify its checksum, then run the full [hardware acceptance
checklist](testing.md) against that download.

Move **Louder Bridge.app** into **Applications** and try to open it. Because
the app is not notarized, macOS may block the first launch. Open **System
Settings → Privacy & Security**, find the Louder Bridge message, and choose
**Open Anyway**. Only make this exception for an archive downloaded from this
repository's Releases page. Apple documents the same process in [Open a Mac
app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).

Test first launch, permissions, login startup, Micro power cycling, Claude
lifecycle states, Agent Key navigation, push-to-talk, sending, upgrades, and
removal. Record the tested macOS, Claude Desktop, bridge, firmware, and
connection versions in the draft notes.

If qualification changes the notes, run `/humanizer` again. Read every piece
of public text as it appears on GitHub before publishing.

## Publish

Publish the draft only when the hardware checklist passes:

```bash
gh release edit "v<version>" --draft=false
```

Keep the ZIP, checksum, SBOM, and previous release available for rollback.
Tags below v1 are marked as prereleases.

Release commits and public text must contain no automated authorship credit or
authorship trailers.

## Optional Developer ID distribution

The repository still contains scripts for Developer ID signing and Apple
notarization. They are optional and are not part of the default GitHub release
workflow. If a future maintainer chooses that route, set a Developer ID
identity for `npm run release:build`, run `npm run release:notarize`, then run
`LOUDER_REQUIRE_NOTARIZED=1 npm run release:verify`.

Never commit certificates, private keys, keychains, or notary credentials.
