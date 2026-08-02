# Changelog

This project follows [Semantic Versioning](https://semver.org/). Changes that
have not shipped appear under "Unreleased."

## Unreleased

### Added

- A self-contained per-user macOS application bundle with an embedded Node.js
  runtime.
- Automatic Claude Desktop detection, Micro connection, and device release.
- Idempotent shutdown that closes the hook server and releases voice input even
  when device cleanup reports an error.
- MIC now clicks toggle-style Claude composer controls once to start and once
  to stop.
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
- Source setup keeps the previous app backup until permission onboarding
  finishes and the replacement background agent is running.
- Interrupting source setup with SIGINT or SIGTERM now cancels permission
  onboarding and rolls back the app, hooks, agent, and token changes.
- Failed or interrupted source setup now stops the replacement onboarding app
  before restoring the previous application bundle.
- Command failures no longer print stack traces or source checkout paths, and
  `status` exits unsuccessfully when the background service is unavailable.
- The loopback API returns fixed error envelopes and uses 405 for unsupported
  methods on known routes.
- Incomplete loopback requests close after five seconds. The server accepts at
  most 64 connections and closes each one after 100 requests.
- A native driver that stops accepting commands is treated as disconnected
  after one second. The bridge closes that process, then the device service
  reconnects through its normal retry loop.
- Concurrent driver shutdowns now wait for the same cleanup operation. A new
  driver process does not start until the previous process has exited.
- Desktop process and permission checks stop after two seconds. Overlapping
  timer ticks now share one pending refresh instead of building an unbounded
  queue.
- Launch-agent and onboarding process commands now have deadlines, so setup,
  rollback, and uninstall do not wait forever on a stuck macOS command.
- Setup rejects symlinked launch-agent files and log directories. Rollback
  restores the previous launch-agent file mode.
- Setup and uninstall verify the app's bundle identity before replacing or
  removing it. Rollback and backup cleanup leave a path alone if it no longer
  points to the bundle recorded at the start of the transaction.
- Token removal records the exact token file before staging it. Rollback does
  not overwrite a token created by another setup process, and cleanup does not
  delete a backup path that now points to another file.
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
- Status now reports the installed app version and both macOS permission states
  while the hook server is unavailable.
- New and existing logs now redact UUID-shaped session identifiers and
  64-character authentication tokens.
- Permission onboarding now checks TCC state through a fresh LaunchServices app
  probe instead of inheriting a stale decision from the requesting process.
- The source compatibility check now verifies the compiler and macOS SDK before
  setup. Installed-app checks still verify the bundled driver itself.
- Setup, activation, and uninstall rollback only their own Claude hooks. They
  preserve unrelated settings written while the operation is running.
- Hook upgrades and removal now work when the installation path contains an
  apostrophe.
- Voice cleanup now waits for the native dictation helper to exit and escalates
  termination if it remains stuck.

### Security

- Loopback requests now require a random bearer token stored in a mode-0600
  file.
- Authentication tokens are now created atomically, validated without
  following links, and permissioned through open file descriptors.
- Log reads and writes now reject symbolic links and multiply linked files.
  The logger changes log and directory permissions through open file
  descriptors.
- The bridge refuses non-loopback bind addresses.
- Hook payloads contain only the session ID, lifecycle event, and notification
  type. Health diagnostics omit session IDs and working directories.
- Invalid hook requests return fixed errors without echoing request content.
- The health endpoint returns a fixed error if an adapter fails.
- The embedded Node.js runtime keeps library validation enabled.
- Source-installed test builds now use the same hardened runtime and Node.js
  entitlements as release builds.
- SPDX SBOMs now identify the embedded Node.js runtime and the exact licensed
  protocol reference. The runtime entry includes the SHA-256 of the binary in
  the release archive.
- SPDX SBOMs now identify the exact Git revision and mark development builds
  made from a dirty checkout. Developer ID builds require clean source.
- Notarized release verification now requires the app, launcher, and embedded
  runtime to share one Developer ID team and secure signing timestamps.
- Release verification now rejects unsafe ZIP paths, links, special files,
  group- or world-writable entries, and executables that are not arm64-only.
- Release verification now checks the project and protocol licenses against
  reviewed source files and rejects a missing or incomplete Node.js license.
- Native release builds fail on compiler warnings.
- Native builds now use strong stack protection and fortified library calls.
  Release verification checks the resulting launcher binary.
- Release tags must point to commits on the protected default branch, and CI
  audits production dependencies before packaging.
