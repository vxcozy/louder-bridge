# Louder Bridge

Use a Work Louder **Codex Micro** with local Claude Code sessions in Claude
Desktop on macOS.

Each session keeps the same Agent Key while the bridge is running. The key
shows whether Claude is working, finished, waiting for input, or stopped by an
error. Press the key to open its session in Claude Desktop.

Hold the Micro's MIC control to dictate into the active Claude Code composer.
Release it to stop, or double-tap MIC to keep recording without holding it.
Press MIC again to stop a latched recording. Louder Bridge uses Claude's own
dictation control, so the transcript stays in the session you are already
using.

Louder Bridge reads Claude Code lifecycle hooks and sends the resulting state
to the Micro. The bridge itself runs on your Mac and does not modify either
desktop app. It does not collect audio, transcripts, or conversation content.
Claude handles dictation under Anthropic's own data policy.

## Install

Download the signed macOS archive from this repository's Releases page:

1. Move **Louder Bridge.app** into **Applications**.
2. Open it once.
3. Approve Input Monitoring and Accessibility when macOS asks.
4. Give Claude Desktop microphone access when you first use dictation.
5. Open Claude Desktop and turn on the Micro.

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

ChatGPT and Louder Bridge can both connect to the Micro, but their RGB writes
are not coordinated. Quit Claude Desktop before returning to active Codex work.
The background agent will release the device.

## Project status

This is a pre-1.0 project. The hardware, hooks, background agent, lighting, and
session navigation have passed a physical test on a Codex Micro. Micro-triggered
dictation is implemented and covered by automated tests, but it is not part of
the physical baseline until the USB-C and Bluetooth checklist passes.

The current preview uses three private integration points: the Work Louder
runtime installed with ChatGPT, Claude's local resume URL, and Claude's
Accessibility surface for dictation. They sit behind adapters, but neither
vendor documents them as public interfaces. A stable v1 will require supported
replacements. Until then, signed builds must be published as prereleases.

Run the tests and local compatibility check with:

```bash
npm test
npm run doctor
npm run security:check
npm run release:check
```

See the [current limits](docs/reference.md#current-limits) for platform and
integration boundaries.
