# Louder Bridge

Use a Work Louder **Codex Micro** with local Claude Code sessions in Claude
Desktop on macOS.

Each session keeps the same Agent Key while the bridge is running. The key
shows whether Claude is working, finished, waiting for input, or stopped by an
error. Press the key to open its session in Claude Desktop.

Hold the Micro's MIC control to dictate into the active Claude Code composer.
Release it to stop, or double-tap MIC to keep recording without holding it.
Press MIC again to stop a latched recording. Louder Bridge uses Claude's own
composer control when one is available and macOS Dictation in Code views that
do not expose one. Press the key to the right of MIC to send the composer or
accept the focused approval.

Louder Bridge reads Claude Code lifecycle hooks and sends the resulting state
to the Micro. The bridge itself runs on your Mac and does not modify either
desktop app. It does not collect audio, transcripts, or conversation content.
Claude or macOS handles dictation, depending on which route is available.

## Install

Download the macOS archive from this repository's Releases page:

1. Move **Louder Bridge.app** into **Applications**.
2. Open it once.
3. If macOS blocks it, open **System Settings → Privacy & Security** and choose
   **Open Anyway** for Louder Bridge.
4. Approve Input Monitoring and Accessibility when macOS asks.
5. Approve microphone access if macOS asks when you first use dictation.
6. Open Claude Desktop and turn on the Micro.

Louder Bridge checks its location before requesting permissions. If you open it
from Downloads, it asks you to move the app and exits without changing Claude.
Permission setup waits up to five minutes for each approval. If a permission
stays off, the app tells you which setting needs attention and exits. Enable
that permission, then open Louder Bridge again.

Louder Bridge starts at login and connects whenever Claude Desktop is open.
Node.js and a source checkout are not required after installation.

## Install from source

If this is your first time using Louder Bridge, follow the
[step-by-step tutorial](docs/tutorial.md).

To get started:

```bash
npm test
npm run doctor
npm run setup
```

Setup creates a self-contained app in your per-user Applications directory,
installs the Claude hooks and background agent, and stores a private local
authentication token. After that, open Claude Desktop and turn on the Micro.
Louder Bridge connects automatically and releases the device when Claude
quits.

## Documentation

The documentation follows the [Diátaxis](https://diataxis.fr/) framework:

| Goal | Documentation |
|---|---|
| Get the Micro working with Claude for the first time | [Tutorial](docs/tutorial.md) |
| Fix a problem or complete a specific task | [How-to guides](docs/how-to.md) |
| Look up commands, settings, states, or limits | [Reference](docs/reference.md) |
| Understand the architecture and design choices | [Explanation](docs/explanation.md) |
| Check tested versions | [Compatibility](docs/compatibility.md) |
| Qualify a release on physical hardware | [Hardware testing](docs/testing.md) |

## Supported scope

The tested target is macOS 15 or newer on Apple Silicon, Claude Desktop, and a
Codex Micro connected over USB-C or Bluetooth. Source setup needs Node.js 22 or
newer.

The bridge tracks local Claude Code sessions. It cannot track cloud or SSH
sessions because their hooks run on another machine.

ChatGPT is not required. Louder Bridge talks to the Micro through a bundled
native macOS driver. If Codex and Claude are open when the Micro connects,
Louder Bridge shows a warning and releases its device connection. Quit
Codex and the bridge reconnects automatically. Quit Claude Desktop before
returning to Codex so the bridge releases the Micro.

## Project status

This is a pre-1.0 project. On the current Bluetooth test build, a physical
Codex Micro started and stopped dictation in Claude Code, inserted spoken text,
sent it with the adjacent key, and displayed fresh lifecycle states. The
same core MIC and send controls also passed over USB-C. The visible Cowork
composer route, double-tap latching, approval prompts, wired restart and
power-cycle cases, and the complete recovery matrix still need
release-candidate testing.

The preview still relies on three unsupported integration points: the
independently documented Codex Micro protocol, Claude's local resume URL, and
Claude's Accessibility surface for dictation. Each sits behind a small adapter.
A stable v1 requires vendor-supported interfaces, so releases remain marked as
prereleases until those are available and verified.

Run the tests and local compatibility check with:

```bash
npm test
npm run doctor
npm run security:check
npm run release:check
```

See the [current limits](docs/reference.md#current-limits) for platform and
integration boundaries.
