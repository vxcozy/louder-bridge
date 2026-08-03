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
  finishes and the replacement background agent answers an authenticated
  health check.
- App activation checks the running service mode and version before reporting
  success. If the check fails, it restores the previous launch agent.
- First launch now checks the resolved bundle path before permission prompts or
  configuration changes. It accepts the system and per-user Applications
  directories and rejects Downloads or App Translocation.
- Release builds now run the packaged location preflight through the signed
  launcher before creating the ZIP.
- When Codex and Claude are already open together, the bridge now leaves the
  Micro disconnected instead of opening it briefly to confirm the conflict.
  If Codex opens later, the bridge releases the Micro before showing the
  warning. It reconnects after Codex quits.
- A failed Codex handoff now keeps the same Micro driver pending for cleanup
  and retries it on the next service check. The bridge will not open a
  replacement driver until that cleanup succeeds, even if Codex closes first.
- Failures to launch the Codex conflict notice now appear in the private error
  log.
- Permission onboarding now stops after a five-minute wait, names the missing
  permission, and opens the matching System Settings pane.
- Source setup no longer waits forever when macOS's app-opening command stays
  alive after the onboarding app exits. It follows the app itself and stops
  after eleven minutes so the setup transaction can roll back.
- Native test commands are now compiled only for automated test binaries.
  Package verification rejects a release launcher that exposes one.
- The standalone Input Monitoring request now reports a successful grant as
  granted instead of treating its Boolean result as an access-state enum.
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
- If the hook server cannot bind its local port after opening the Micro,
  startup now releases the device before returning the error.
- A native driver that stops accepting commands is treated as disconnected
  after one second. The bridge closes that process, then the device service
  reconnects through its normal retry loop.
- Concurrent driver shutdowns now wait for the same cleanup operation. A new
  driver process does not start until the previous process has exited.
- A native driver that fails before it can emit an exit event no longer blocks
  later connection attempts. Late events from an older driver cannot clear or
  notify the replacement connection.
- Desktop process and permission checks stop after two seconds. Overlapping
  timer ticks now share one pending refresh instead of building an unbounded
  queue.
- If a desktop process check fails, diagnostics mark that app as unknown and
  the service releases the Micro. It reconnects after process inspection
  recovers.
- Launch-agent and onboarding process commands now have deadlines, so setup,
  rollback, and uninstall do not wait forever on a stuck macOS command.
- Setup rejects symlinked launch-agent files and log directories. Rollback
  restores the previous launch-agent file mode and leaves newer edits alone.
- Launch-agent removal checks the plist again after stopping the service.
  Rollback will not overwrite a plist created by another process.
- If launchd reports an error while stopping the previous agent, rollback
  retries the stop and reloads the unchanged agent after a successful retry.
  The original launchd error is still reported.
- Setup and uninstall verify the app's bundle identity before replacing or
  removing it. Rollback and backup cleanup leave a path alone if it no longer
  points to the bundle recorded at the start of the transaction.
- Token removal records the exact token file before staging it. Rollback does
  not overwrite a token created by another setup process, and cleanup does not
  delete a backup path that now points to another file.
- Source setup sanitizes older logs before permission onboarding starts.
- Claude settings updates preserve symlinks and existing file permissions.
- Failed setup deletes a newly created Claude settings file only when the file
  and its bridge hooks still match that setup transaction. A replaced or
  cleared file is left untouched.
- Claude settings writes now check the target again immediately before
  replacement. If another process creates or edits the file, setup retries
  from the latest settings up to five times instead of overwriting them.
- Setup now rejects Claude settings files that are hard linked, owned by
  another user, or contain a JSON root other than an object.
- Hook removal no longer creates an empty Claude settings file or rewrites a
  file that has no Louder Bridge hooks.
- Settings creation now resolves symlinked configuration directories and
  checks the destination again immediately before creating the file.
- Setup now rejects Claude settings files larger than 16 MiB before reading or
  parsing them.
- Release automation uses reviewed notes supplied by the maintainer instead of
  generated release copy.
- Ended Claude sessions now release their Agent Key slot and in-memory session
  details.
- Agent Key navigation stops waiting after five seconds if macOS never reports
  whether the Claude URL opened. A later process error does not crash the
  service.
- Repeated press reports from the same Agent Key are ignored until its release
  arrives. Reconnecting clears held-key state, so the first press on the new
  connection still works.
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
- Voice startup reads at most 4 KiB from the dictation helper and stops reading
  once the helper is ready. This bounds memory use if the helper sends bad
  startup data during a recording.

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
- Notarization creates the stapled ZIP and checksum beside the current pair.
  Publication moves both current files into verified backups before installing
  either replacement. If creation or publication fails, rollback restores the
  old pair when those backups are intact. File-identity checks protect files
  changed by another process and preserve a published file if its backup has
  disappeared.
- Release verification now rejects unsafe ZIP paths, links, special files,
  group- or world-writable entries, and executables that are not arm64-only.
- Release verification now checks the project and protocol licenses against
  reviewed source files and rejects a missing or incomplete Node.js license.
- Native release builds fail on compiler warnings.
- Native builds now use strong stack protection and fortified library calls.
  Release verification checks the resulting launcher binary.
- Release tags must point to commits on the protected default branch, and CI
  audits production dependencies before packaging.
