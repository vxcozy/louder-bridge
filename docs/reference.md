# Reference

## System requirements

| Requirement | Supported value |
|---|---|
| Operating system | macOS on Apple Silicon |
| Node.js for source setup | 22 or newer |
| Hardware | Work Louder Codex Micro |
| Hardware connection | USB-C or Bluetooth |
| Agent surface | Local sessions in Claude Desktop's Code tab |
| Voice service | Claude voice when its composer control is available; otherwise macOS Dictation |
| Permissions | Input Monitoring and Accessibility for Louder Bridge; Microphone for Claude Desktop |
| Device driver | Bundled native IOKit driver; vendor-supported interface required for v1 |
| Protocol reference | FreeMicro revision `64258eb6cc3312a43f9f9f86d87e55e0b609ccc5` (MIT) |

Claude Desktop and Codex Micro firmware change over time. Run `npm run doctor`
to check the current installation.

## Package commands

| Command | Purpose |
|---|---|
| `npm test` | Run the automated test suite |
| `npm run doctor` | Check Node, macOS, permissions, and the bundled Micro driver |
| `npm run setup` | Install hooks and the macOS background agent |
| `npm run status` | Check the agent, hook server, installed version, and macOS permissions |
| `npm start` | Run the bridge manually for development |
| `npm run uninstall` | Remove the background agent and Louder Bridge hooks |
| `npm run authorship:check` | Reject automated authorship credit in files and commits |
| `npm run security:check` | Scan the repository for common credential leaks |
| `npm run release:check` | Run syntax and release-hygiene checks |
| `npm run release:credentials` | Check that release credentials are present without printing them |
| `npm run release:build` | Build an Apple Silicon release archive |
| `npm run release:notarize` | Submit a signed archive to Apple's notary service |
| `npm run release:verify` | Verify the archive, checksum, SBOM, architecture, and signature |

## CLI commands

```text
node src/cli.mjs start [--mock-device]
node src/cli.mjs service
node src/cli.mjs doctor
node src/cli.mjs setup
node src/cli.mjs activate
node src/cli.mjs status
node src/cli.mjs uninstall
node src/cli.mjs simulate <state> [session-id]
node src/cli.mjs help
node src/cli.mjs version
```

`service` is the internal entry point used by the macOS launch agent.
`activate` is the first-launch entry point used by the packaged app.
If the agent is offline while the app waits for a macOS privacy decision,
`status` reports that permission onboarding is still running.
It exits with status 1 whenever the authenticated hook server is unavailable.

Supported simulated states are `idle`, `running`, `needs_input`, `complete`,
`error`, and `off`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LOUDER_BRIDGE_HOST` | `127.0.0.1` | Loopback event-server address |
| `LOUDER_BRIDGE_PORT` | `47831` | Local event-server port |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Override the Claude configuration directory |

Setup records the selected host and port in the launch agent and hook commands.
Only `127.0.0.1`, `::1`, and `localhost` are accepted as host values.

## Claude settings

Setup adds Louder Bridge command hooks to `~/.claude/settings.json`. It keeps
unrelated settings and hooks, along with the existing file mode and any
symbolic link at the settings path.

Setup accepts only a regular settings file owned by the current macOS user.
Hard links and JSON roots other than an object are invalid. Files larger than
16 MiB are refused before they are read. A symbolic link at the standard
settings path remains supported when its target meets those checks. If any
check fails, setup leaves the file unchanged.

If hook removal finds no settings file or no Louder Bridge hooks, it changes
nothing. For a symlinked configuration directory, setup resolves the target
before creating settings and checks the link again immediately before
creation.

Before it replaces an existing settings file, setup checks the path,
filesystem identity, and contents again. If another process changed the file,
setup merges its hooks into the new version. When the file does not exist,
setup creates it without replacing anything that appears in the meantime.
Five consecutive conflicts stop setup with an error.

If failed setup needs to remove a settings file that it created, rollback
checks the file and its bridge hooks first. A file that was replaced, cleared,
or given other settings is left in place.

## Background agent

Setup creates a per-user launch agent with these properties:

| Property | Value |
|---|---|
| Label | `app.louder-bridge.agent` |
| Start policy | After permission approval, then at login with automatic restart |
| Device policy | Connect while Claude Desktop is open |
| Hook server | Always available on the configured loopback address |
| Standard log | `~/Library/Logs/LouderBridge/bridge.log` |
| Error log | `~/Library/Logs/LouderBridge/bridge-error.log` |

Source setup installs a self-contained application in the current user's
Applications directory. A packaged release can run from the system Applications
directory. The generated property list points to that installed bundle, not to
the source checkout. Each log is capped at 1 MiB and retains three backups.
Before first launch asks for permission or changes Claude settings, it resolves
the app bundle's real path. The path must be inside the system or current user's
Applications directory. The preflight rejects Downloads, App Translocation
mounts, and symlinks to other directories.
First launch waits up to five minutes for Input Monitoring, then five minutes
for Accessibility. Once you grant access, setup continues immediately. If
either wait expires, the app opens the matching System Settings pane and exits
before activation. Source setup then rolls back its transaction.
Source setup gives macOS's app-opening command five seconds, waits briefly for
the onboarding process to appear, then follows it once per second. If macOS
quits Louder Bridge after a permission change, setup can launch it up to five
times so onboarding continues without a manual restart. Each app wait has an
eleven-minute deadline. Source builds derive the launcher's Mach-O UUID from
its compiled contents, so an unchanged rebuild keeps the same local permission
identity.

Before setup replaces or removes the app, it checks the bundle identifier and
executable name. It also records the bundle's filesystem identity for rollback
and backup cleanup. If a path changes during the transaction, setup stops and
leaves the unexpected item untouched.
The logger rejects symbolic links and multiply linked files during startup and
while the agent is running. It changes file and directory permissions through
open file descriptors.

Desktop process and permission checks stop after two seconds. If one is still
running when the next timer fires, the service keeps one pending refresh
instead of adding another.

Launch-agent commands stop after ten seconds, and onboarding process checks
stop after five. Setup reads an existing launch-agent property list without
following links and accepts only a single-link file owned by the current user.
Rollback restores that file's previous mode. Setup also refuses to change log
directory permissions through a symbolic link.

After launchd starts a replacement agent, activation calls the authenticated
health endpoint and checks the service mode and exact app version. Each request
has a 500 ms deadline. Activation tries up to 150 times, with 100 ms between
attempts and a fifteen-second overall deadline. The longer wait covers launchd's
ten-second restart throttle after a short-lived agent run. If the service never
passes the check, installation restores the previous launch-agent file and load
state. Setup checks the file again before replacement and rollback. If another
process changed it, setup leaves the newer file alone.
If a later setup check fails after activation, rollback stops the replacement
agent before restoring the previous app and agent.

The native launcher is compiled with strong stack protection, fortified libc
calls, and fatal compiler and linker warnings. Package verification checks the
compiled binary for the required hardening symbols.

The native device process has a three-second startup deadline and a one-second
command-write deadline. If a write stalls, the bridge terminates that process.
It accepts only `v.oai.thstatus` commands from Node. Each command may contain up
to six unique slot IDs from 0 through 5, and every color, effect, brightness,
speed, and synchronization field is range-checked before it reaches the Micro.

Shutdown calls share one cleanup operation, and the next process waits for it
to finish. If cleanup fails during a Codex handoff, the server keeps the
original device connection pending and retries its cleanup on the next service
check. It does not open a replacement driver until cleanup succeeds. If Codex
closes between attempts, the service finishes cleanup before reconnecting
through its normal three-second retry loop.

The hook server requires a random bearer token. Setup stores it in the current
user's Application Support directory with mode `0600`. The token is never
written into Claude settings or the launch-agent property list. Creation is
atomic, so concurrent setup attempts agree on one token. Reads and permission
changes do not follow symbolic links or accept hard links. Uninstall records
the token file before staging it. If another process creates a token or
replaces the backup during the transaction, rollback and cleanup leave those
files alone.

## Lighting states

| Internal state | Claude condition | Agent Key |
|---|---|---|
| `idle` | Session ready | dim white |
| `running` | Prompt submitted; Claude is working | breathing blue |
| `complete` | Turn stopped normally | green |
| `needs_input` | Permission, elicitation, or idle prompt | breathing amber |
| `error` | Turn ended with a failure | breathing red |
| `off` | Session ended or slot unused | off |

## Claude hook events

Setup registers command hooks for:

| Hook event | Resulting state |
|---|---|
| `SessionStart` | `idle` |
| `UserPromptSubmit` | `running` |
| `PermissionRequest` | `needs_input` |
| `Notification` | `needs_input` for permission, idle, and elicitation prompts |
| `Stop` | `complete` |
| `StopFailure` | `error` |
| `SessionEnd` | `off` |

Each hook has a two-second Claude timeout. The hook's loopback request has a
400-millisecond timeout and exits successfully when the bridge is unavailable.

## Loopback HTTP interface

The event server listens only on the configured loopback address.

### `GET /health`

Returns bridge status and the six current slot states:

```json
{
  "ok": true,
  "service": {
    "mode": "service",
    "claudeDesktop": "open",
    "codexDesktop": "closed",
    "inputMonitoring": "granted",
    "accessibility": "granted",
    "version": "0.1.0",
    "nodeVersion": "v24.8.0",
    "navigator": {
      "id": "claude-resume-url",
      "support": "experimental"
    },
    "voice": {
      "id": "claude-accessibility-dictation",
      "support": "experimental",
      "state": "idle",
      "method": "macos-dictation",
      "error": null,
      "lastActionAt": "2026-07-31T05:20:18.204Z"
    },
    "lastHookAt": "2026-07-31T05:20:02.613Z",
    "device": {
      "state": "connected",
      "error": null,
      "runtime": {
        "id": "native-iokit-protocol",
        "support": "experimental",
        "version": "v0.4.1",
        "transport": "USB"
      },
      "lastEventAt": "2026-07-31T05:20:18.204Z",
      "lastEvent": {
        "type": "voice",
        "action": "release",
        "at": "2026-07-31T05:20:18.204Z"
      }
    }
  },
  "slots": [
    {
      "slot": 0,
      "state": "running",
      "selected": false
    }
  ]
}
```

All requests require `Authorization: Bearer <local-token>`. Use `npm run
status` instead of reading the token directly.

The service keeps the timestamp, type, and action from the last device event
after releasing the Micro. This makes post-handoff diagnostics useful without
retaining session or prompt content.

Errors use the same JSON shape: `{"ok":false,"error":"..."}`. Known routes
return 405 for the wrong method and include an `Allow` header.

| Status | Meaning |
|---|---|
| 400 | The request body is not valid JSON |
| 401 | The bearer token is missing or invalid |
| 404 | The route does not exist |
| 405 | The route does not accept that method |
| 413 | The request body exceeds 64 KiB |
| 415 | The hook request is not JSON |
| 500 | The bridge could not handle the request |

Headers and request bodies have a five-second deadline. The server accepts at
most 64 simultaneous connections and closes a reused connection after 100
requests.

### `POST /hook`

Accepts a Claude hook event as JSON. Request bodies are limited to 64 KiB.

Recognized fields are:

- `session_id`
- `hook_event_name`
- `notification_type`

The hook does not forward working directories, prompts, responses, model
names, tool data, or transcripts. The health response omits session IDs. The
logger redacts UUID-shaped identifiers and authentication tokens from new
entries and older log files.

## Slot behavior

- The bridge exposes six slots numbered 1–6 to users and 0–5 internally.
- A new session takes the first unused slot.
- A known session keeps its slot until Claude sends `SessionEnd`.
- An ended session releases its slot and is no longer available through its
  Agent Key.
- When all slots are occupied, the oldest inactive session is replaced first.
- Sessions in `running` or `needs_input` state are treated as active.
- Pressing an assigned Agent Key selects its slot and opens its Claude session.
- Holding MIC starts dictation in the active Claude Code composer.
- Releasing MIC stops dictation without submitting the composer.
- Double-tapping MIC within 350 ms latches dictation until the next press.
- A device disconnect while MIC is held or latched stops dictation.
- Pressing the key to the right of MIC sends Return to Claude once per press.

## Source layout

| Path | Responsibility |
|---|---|
| `src/cli.mjs` | CLI entry point |
| `src/server.mjs` | Loopback event server and orchestration |
| `src/service.mjs` | Claude-aware background lifecycle |
| `src/hook.mjs` | Claude hook client and payload filtering |
| `src/state/session-store.mjs` | Six-slot allocation and lifecycle state |
| `src/device/worklouder.mjs` | Device discovery, connection, and Agent Keys |
| `src/device/native-transport.mjs` | Native-driver process and protocol messages |
| `src/device/push-to-talk.mjs` | MIC hold and double-tap gesture state |
| `src/device/palette.mjs` | State-to-lighting mapping |
| `src/claude/navigator.mjs` | Claude navigation adapter |
| `src/claude/open-session.mjs` | Experimental Claude resume URL |
| `src/claude/voice.mjs` | Experimental Claude dictation adapter |
| `src/claude/submit.mjs` | Claude composer and approval submit adapter |
| `src/macos/input-monitoring.mjs` | Native permission status checks |
| `src/macos/accessibility.mjs` | Native Accessibility permission status checks |
| `src/macos/native-executable.mjs` | Mach-O validation shared by native helpers |
| `native/launcher.m` | App launcher, permission onboarding, and Claude dictation control |
| `native/micro_device.m` | IOKit device discovery, framing, and input reports |
| `src/setup/claude-hooks.mjs` | Settings merge and removal |
| `src/setup/launch-agent.mjs` | macOS launch agent installation |
| `src/setup/application-bundle.mjs` | Self-contained app installation and rollback |
| `src/setup/permission-onboarding.mjs` | Permission gate and first-launch handoff |
| `src/setup/installed-status.mjs` | Offline app version and permission diagnostics |
| `src/setup/transaction-signals.mjs` | Signal handling for interrupted source setup |
| `src/setup/auth-token.mjs` | Local authentication-token lifecycle |
| `src/logging.mjs` | Private bounded log files |

## Current limits

- Cloud and SSH sessions are not tracked because their hooks execute away from
  the local bridge.
- macOS on Apple Silicon is the tested target.
- Source builds do not have a stable Developer ID identity, so macOS may ask
  for Input Monitoring or Accessibility again after an upgrade.
- The native driver uses an independently documented, MIT-licensed protocol
  implementation. Stable v1 requires a vendor-supported Work Louder interface.
- The native driver cannot claim exclusive ownership of the Micro. If Codex and
  Claude are open together, Louder Bridge warns once and releases its device
  connection until Codex quits.
- Claude's resume URL is not part of Anthropic's public interface. Stable v1
  requires a supported navigation route.
- Claude's Accessibility surface for dictation is not a published Anthropic
  interface. Stable v1 requires a supported voice route.
- MIC hold and release, transcript insertion, and send passed focused physical
  tests over Bluetooth and USB-C. Bluetooth lifecycle response also passed.
  The full USB-C and Bluetooth acceptance matrix has not passed yet.
