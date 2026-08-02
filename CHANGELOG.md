# Changelog

This project follows [Semantic Versioning](https://semver.org/). Changes that
have not shipped appear under "Unreleased."

## Unreleased

### Added

- A self-contained per-user macOS application bundle with an embedded Node.js
  runtime.
- Automatic Claude Desktop detection, Micro connection, and device release.
- Claude Code lifecycle hooks, six stable session slots, lighting states, and
  Agent Key session navigation.
- Authenticated loopback HTTP endpoints, private rotating logs, diagnostics,
  transactional setup, and rollback.
- Automated tests, security and release checks, a Node compatibility matrix,
  and a physical-hardware acceptance checklist.
- Native Input Monitoring onboarding with automatic agent recovery after
  permission changes.
- Device and Claude navigation adapters that report whether their interfaces
  are experimental or supported.
- Versioned health diagnostics with permission state, runtime provenance, and
  recent hook and device timestamps.
- GitHub Actions workflows for native arm64 testing, signed releases,
  notarization, checksums, and SPDX SBOM files.
- Repository checks for automated authorship credit.
- Micro push-to-talk that starts Claude's own dictation on press and stops it
  on release.
- Accessibility permission onboarding and voice-adapter diagnostics.
- CLI help and version commands, strict release metadata checks, and clearer
  local port-conflict errors.
- Embedded Node version and accurate last-hook timing in authenticated
  diagnostics.
- A bundled native IOKit driver for USB-C and Bluetooth Codex Micro
  communication, with a verified device-status handshake and strict command
  allowlist.

### Changed

- Logs no longer include project names or session identifiers.
- Empty Agent Key presses now produce a diagnostic log entry.
- Stable v1 release checks now reject experimental device or navigation
  adapters and the experimental Claude voice interface.
- The login agent now starts through the signed app executable.
- GitHub release automation now creates a draft for hardware qualification and
  maintainer review instead of publishing immediately.
- ChatGPT is no longer required for Codex Micro access.
- Source setup now hands permission checks to the installed app instead of
  trusting permission state inherited from a terminal.
- Source setup sanitizes older logs before permission onboarding starts.
- Claude settings updates preserve symlinks and existing file permissions.
- Release automation uses reviewed notes supplied by the maintainer instead of
  generated release copy.
- Ended Claude sessions now release their Agent Key slot and in-memory session
  details.
- First-run instructions now grant macOS permissions before checking the
  background agent.
- Hook configuration now rejects non-loopback destinations before it edits
  Claude settings, and IPv6 loopback URLs are formatted correctly.
- Status now distinguishes permission onboarding from a stopped background
  agent.
- Setup, activation, and uninstall rollback only their own Claude hooks. They
  preserve unrelated settings written while the operation is running.

### Security

- Loopback requests now require a random bearer token stored in a mode-0600
  file.
- The bridge refuses non-loopback bind addresses.
- Hook payloads exclude prompts, responses, transcripts, and tool contents.
- The embedded Node.js runtime keeps library validation enabled.
- Source-installed test builds now use the same hardened runtime and Node.js
  entitlements as release builds.
- SPDX SBOMs now identify the embedded Node.js runtime and the exact licensed
  protocol reference. The runtime entry includes the SHA-256 of the binary in
  the release archive.
- Native release builds fail on compiler warnings.
- Release tags must point to commits on the protected default branch, and CI
  audits production dependencies before packaging.
