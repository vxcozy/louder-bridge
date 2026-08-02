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
The logger rejects symbolic links and multiply linked files during startup and
while the agent is running. It changes file and directory permissions through
open file descriptors.

The hook server requires a random bearer token. Setup stores it in the current
user's Application Support directory with mode `0600`. The token is never
written into Claude settings or the launch-agent property list. Creation is
atomic, so concurrent setup attempts agree on one token. Reads and permission
changes do not follow symbolic links.

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
- Micro input and RGB writes can reach both Louder Bridge and Codex while both
  desktop apps are open. Keep only the target app open for predictable control.
- Claude's resume URL is not part of Anthropic's public interface. Stable v1
  requires a supported navigation route.
- Claude's Accessibility surface for dictation is not a published Anthropic
  interface. Stable v1 requires a supported voice route.
- Bluetooth MIC hold and release, transcript insertion, send, and lifecycle
  response passed a focused physical test. The full USB-C and Bluetooth
  acceptance matrix has not passed yet.
