# Louder Bridge

Use a Work Louder **Codex Micro** with local sessions in Claude Desktop and
Hermes Desktop on macOS.

Each session keeps the same Agent Key while the bridge is running. The key
shows whether the agent is working, finished, waiting for input, or stopped by
an error. Press the key to open its session in the app that owns the Micro.

All six Agent Keys stay softly white while the bridge owns the Micro. A live
session changes its key to blue, green, amber, or red. The exterior lighting
follows the session that changed most recently, including its pulse effect.

Hold the Micro's MIC control to dictate into the active composer.
Release it to stop, or double-tap MIC to keep recording without holding it.
Press MIC again to stop a latched recording. Louder Bridge uses Claude's own
composer control when one is available and macOS Dictation in Code views that
do not expose one. In Hermes, it uses the Voice dictation control. Press the
key to the right of MIC to send the composer or accept the focused approval.

Louder Bridge reads Claude Code hooks or a small Hermes plugin and sends the
resulting state to the Micro. The bridge itself runs on your Mac. It does not
collect audio, transcripts, or conversation content. Claude, Hermes, or macOS
handles dictation, depending on the active app and composer.

## Install

Download the macOS archive from this repository's Releases page:

1. Move **Louder Bridge.app** into **Applications**.
2. Open it once.
3. If macOS blocks it, open **System Settings → Privacy & Security** and choose
   **Open Anyway** for Louder Bridge.
4. Approve Input Monitoring and Accessibility when macOS asks.
5. Approve microphone access if macOS asks when you first use dictation.
6. Open Claude Desktop or Hermes Desktop and turn on the Micro.

Louder Bridge checks its location before requesting permissions. If you open it
from Downloads, it asks you to move the app and exits without changing Claude.
Permission setup waits up to five minutes for each approval. If a permission
stays off, the app tells you which setting needs attention and exits. Enable
that permission, then open Louder Bridge again.

Louder Bridge starts at login and connects when either supported app is open.
Keep only one of them open while using the Micro. Node.js and a source checkout
are not required after installation.

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
installs the app integrations and background agent, and stores a private local
authentication token. If Hermes is installed, setup also enables the managed
Louder Bridge plugin. After that, open Claude Desktop or Hermes Desktop and
turn on the Micro.

## Documentation

The documentation follows the [Diátaxis](https://diataxis.fr/) framework:

| Goal | Documentation |
|---|---|
| Get the Micro working with Claude for the first time | [Tutorial](docs/tutorial.md) |
| Get the Micro working with Hermes for the first time | [Hermes tutorial](docs/hermes-tutorial.md) |
| Fix a problem or complete a specific task | [How-to guides](docs/how-to.md) |
| Look up commands, settings, states, or limits | [Reference](docs/reference.md) |
| Understand the architecture and design choices | [Explanation](docs/explanation.md) |
| Check tested versions | [Compatibility](docs/compatibility.md) |
| Qualify a release on physical hardware | [Hardware testing](docs/testing.md) |

## Supported scope

The tested target is macOS 15 or newer on Apple Silicon and a Codex Micro
connected over USB-C or Bluetooth. Louder Bridge supports local Code sessions
in Claude Desktop and local sessions in Hermes Desktop. Source setup needs
Node.js 22 or newer.

The bridge tracks local Claude Code sessions. It cannot track cloud or SSH
sessions because their hooks run on another machine.

ChatGPT is not required. Louder Bridge talks to the Micro through a bundled
native macOS driver. If Codex and a supported app are open together, Louder
Bridge shows a warning and releases its device connection. It reconnects after
Codex quits. The bridge also waits if Claude and Hermes are both open because
only one app can own the Micro at a time.

## Project status

This is a pre-1.0 project. The v0.1.2 archive downloaded from GitHub passed a
physical Claude Code test with a Codex Micro. A locally built v0.2.0 candidate
archive passed its Hermes Desktop test over Bluetooth after a fresh install and
permission approval. MIC push-to-talk, transcript insertion, send, Agent Key
navigation, lifecycle lighting, exterior effects, and sound feedback all worked
on hardware. Claude's core MIC and send controls have passed over Bluetooth and
USB-C.

The visible Cowork composer route, double-tap latching, approval prompts, wired
restart and power-cycle cases, and the remaining recovery checks still need
release-candidate testing.

The preview still relies on unsupported integration points: the
independently documented Codex Micro protocol, Claude's local resume URL, and
desktop Accessibility controls. Hermes voice and send use Accessibility, while
session navigation relies on its default recent-session shortcuts. Each route
sits behind a small adapter, and releases remain prereleases while these
interfaces are experimental.

Run the tests and local compatibility check with:

```bash
npm test
npm run doctor
npm run security:check
npm run release:check
```

See the [current limits](docs/reference.md#current-limits) for platform and
integration boundaries.
