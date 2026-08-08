# How Louder Bridge works

## The problem the bridge solves

The Codex Micro has two kinds of integration.

Ordinary controls can behave like a standard keyboard. Work Louder Input can
map those keys, the encoder, and joystick to shortcuts that work in many
applications.

The six Agent Keys are different. Their live colors depend on agent state, and
pressing one is meant to navigate to the agent it represents. Keyboard
remapping cannot tell whether an agent is working, waiting for approval,
finished, or stopped by an error. Louder Bridge reads that session state and
sends it to the Micro.

MIC is also application-aware. A press must begin listening in the active
composer, and a release must stop it without sending the prompt or
moving to another session.

## Data flow

```text
Claude Desktop, Hermes Desktop, or a supported agent in Ghostty
  ├─ Claude/Codex command hooks or Hermes plugin hooks
  │    └─ POST 127.0.0.1:47831/hook
  │         └─ six-slot session store
  │              ├─ status → Work Louder lighting RPC
  │              └─ Agent Key → active navigation adapter
  └─ Accessibility or Ghostty control
       └─ MIC press/release ← background service ← Micro HID events
```

Claude Code and Codex CLI run small command hooks for session events. Hermes
loads a managed plugin that observes its lifecycle hooks. Each adapter builds a
minimal payload and sends it to the bridge over loopback HTTP.

The bridge updates its session store and sends color data for all six slots.
The device reports Agent Key presses back to the bridge. A press selects the
assigned session and asks Claude Desktop to resume it.

MIC reports separate press and release events. The bridge applies the same
350 ms gesture window as Codex. Holding MIC starts Claude's dictation and
releasing it stops. A quick double-tap latches dictation until the next press.
The bridge also stops dictation if the Micro disconnects while MIC is held or
latched.

## Why run a background agent

Requiring a terminal command every time would make the Micro feel like a
development tool rather than part of Claude Desktop. Setup therefore installs
a self-contained app and a per-user macOS launch agent. The app includes its
own Node.js runtime, so the agent does not depend on a source checkout or the
user's shell configuration. The agent starts at login and keeps the local hook
server available.

The service checks Claude Desktop, Hermes Desktop, Ghostty, and TTY-backed agent
processes. An idle Ghostty window does not claim the Micro. Ghostty becomes a
supported surface only while Claude, Codex, or Hermes is attached to a real
terminal. If more than one surface is available, the bridge waits. This keeps
one Micro press from reaching two agent apps.

macOS can cache a privacy decision in the process that requested it. A child
process may also inherit the parent's privacy identity, which makes a direct
status check misleading. During onboarding, Louder Bridge launches a short app
probe through LaunchServices. The probe writes only the two permission states
to a private temporary file, then exits. The onboarding process deletes that
file and starts the background agent as soon as both permissions are granted.

## Why use lifecycle hooks

Claude and Codex command hooks plus Hermes plugin hooks report lifecycle events
directly: session start, prompt submission, approval, completion, failure, and
session end. Codex does not currently expose a separate failure hook.

Unlike interface scraping, hooks do not depend on either app's rendering or
layout. They also avoid watching private session files.

If the bridge is not running, the hook's request times out after 400
milliseconds and exits successfully. A disconnected Micro does not interrupt
Claude.

## Why there are six stable slots

The Micro has six physical Agent Keys, while Claude Desktop can have more than
six sessions. Louder Bridge therefore maintains a small working set:

1. New sessions fill unused slots from left to right.
2. Existing sessions keep their physical position until they end.
3. When the set is full, an inactive session is replaced before a session that
   is running or waiting for input.
4. Among equally active candidates, the least recently updated session is
   replaced.

Stable positions make the keys easier to remember. A session does not jump to
another key merely because a different session produced a newer event. A
`SessionEnd` hook turns off the light, removes the in-memory session details,
and frees the key for another session.

Assignments live only in memory. Restarting the bridge clears them, so old
Claude session IDs are not kept on disk.

## How lighting represents state

Each state has its own color or animation:

- Soft white means the key is unused or its session is idle.
- Breathing blue means work is in progress.
- Green means the latest turn completed.
- Breathing amber demands attention.
- Breathing red reports failure.

Running, needs-input, and error states breathe. Idle and complete states stay
solid.

The ambient ring follows the session whose state changed most recently. It
uses the same color and animation as that session. Pressing an assigned Agent
Key makes its session the ambient state until another Claude lifecycle event
arrives. The other five Agent Keys keep their own colors.

When the bridge releases the Micro, it turns its lighting off so Codex can take
over cleanly.

## Device driver boundary

Device access runs in a small native child process. The Node service sees a
narrow transport with four jobs: report availability, send lighting, receive
Agent Key and MIC events, and close the connection.

The child process opens the Micro non-exclusively through IOKit. It frames JSON
messages for USB-C or Bluetooth, requests `device.status`, and waits for a real
reply before reporting a connection. The Node service can send only
`v.oai.thstatus`. The child checks every lighting field, rejects duplicate or
out-of-range slots, and accepts no more than six lights. It creates the fixed
status request itself, so Node cannot send status, configuration, firmware,
filesystem, or bootloader methods.

The framing and message names come from an independently documented,
MIT-licensed implementation. The bridge includes that license notice and does
not depend on ChatGPT or copy code from its application bundle. The protocol is
still experimental because Work Louder does not support it as a public
interface. Stable v1 remains blocked until that changes.

## Claude session navigation

Claude Desktop accepts a local resume URL containing a Claude Code session ID.
When you press an Agent Key, the bridge opens that URL so Claude Desktop can
activate or import the corresponding local session.

The installed Claude application supports this route, but Anthropic does not
document it as a public interface. The navigation adapter keeps that private
route out of device and session logic. The release check also blocks stable v1
until a supported navigator replaces it.

## Hermes session navigation

Hermes Desktop provides shortcuts for its nine most recent sessions. The
bridge asks the Hermes CLI for the current order, finds the session assigned to
the pressed Agent Key, brings Hermes forward, and sends the matching `Ctrl+1`
through `Ctrl+9` shortcut.

The adapter depends on the default shortcut bindings. If the session has fallen
outside the first nine or the shortcut has been remapped, navigation fails
without changing the selected Micro slot.

## Ghostty terminal navigation

Ghostty 1.3 exposes stable terminal IDs through its AppleScript API. When a
terminal session starts or submits a prompt, the bridge associates that session
with the currently focused Ghostty terminal. Completion and approval events do
not change the association because they may arrive while another tab is open.

Pressing an Agent Key asks Ghostty to focus the terminal with the stored ID.
This works across windows, tabs, and splits without reading terminal text,
shell history, working directories, or process arguments. Session identifiers
are hashed before they enter the shared terminal-session store.

The focused terminal normally determines which agent owns MIC. When an Agent
Key selects a session, the bridge also remembers that session's agent type as a
fallback. This keeps voice routing correct when Ghostty cannot return the
focused terminal quickly enough after a pane change.

Ghostty describes the AppleScript API as a preview. The bridge keeps terminal
navigation behind its own adapter in case that API changes.

## Claude voice input

Codex treats MIC as push-to-talk, so Louder Bridge preserves that interaction
in Claude. The native adapter uses one of two routes, depending on what the
frontmost Claude window exposes through macOS Accessibility.

When a visible Claude composer button is available, the adapter holds that
button for as long as MIC is held. It sends a real pointer-down event, waits at
least as long as Claude's hold threshold, and sends pointer-up on release. This
matches the button's own press-and-hold behavior instead of toggling it with a
click.

Some Claude Code views have voice support but no accessible composer button.
There, the adapter starts macOS Dictation through the Edit menu and stops it
with Escape, Apple's documented stop gesture. This is the route that passed
the August 2 Bluetooth hardware test.

A quick double-tap keeps recording active, and the next press stops it. The
bridge sees only device edges and native control state. It never receives
audio, reads the transcript, or inspects the composer. Claude or macOS owns the
microphone path, depending on the route used.

That distinction also determines the applicable voice service and privacy
terms. The composer-button route uses Claude's service. The fallback uses the
Mac's Dictation configuration, whose processing behavior can vary by language
and system settings. Louder Bridge does not choose or proxy either service.

Neither route is a supported Anthropic Desktop integration. The adapter is
experimental, and the release check blocks stable v1 until Anthropic provides
a supported interface.

## Hermes voice input

Hermes Desktop exposes a Voice dictation button in its composer. MIC presses
operate that button through macOS Accessibility. The native helper reports
ready only after Hermes starts recording, then stops dictation when MIC is
released. The adjacent Micro key sends Return to the frontmost Hermes window.

Hermes owns microphone access and transcription. The bridge does not receive
audio or read the resulting draft.

## Ghostty voice input

Claude Code and Hermes use their own hold-Space push-to-talk control. While you
hold MIC, the Ghostty adapter holds Space; releasing MIC releases it. Codex CLI
uses macOS Dictation instead because its terminal voice control has different
keyboard behavior. The adjacent Micro key sends Return to the frontmost
Ghostty terminal.

The terminal agent or macOS handles the microphone and transcript. Louder
Bridge sees the MIC press and release, but it does not receive audio or text.

## Privacy boundary

The hook receives more data than the lighting system needs, so it builds a new
allowlisted payload before making the local request.

The allowlist contains only the surface, optional terminal host, session ID,
event name, and optional notification type.
It excludes the working directory, model name, stop reason, prompt text,
responses, transcripts, and tool data. The server keeps session IDs in memory
for Agent Key navigation but omits them from diagnostics. The voice path does
not carry audio or transcript text. Normal logs record slot numbers, states,
and MIC edges, not session IDs or project names.

The server accepts only loopback bind addresses. Every request also needs a
random bearer token stored in a user-only file. A client cannot forge Claude
events merely because it can reach the port; it must also present that token.
The file permissions separate macOS user accounts, but they are not a security
boundary between processes running as the same account. There is no cloud
service in the bridge and no account credential is required.

## Coexisting with Codex

The native driver opens the device in non-exclusive mode. This lets Codex and
Louder Bridge connect at the same time, but the apps do not coordinate input
events or lighting writes. A MIC or send press can reach both apps, and the
last lighting write wins.

When the bridge finds a connected Micro while Codex and a supported app are
open, it shows one conflict notice and releases the device. It reconnects after
Codex quits without restarting the agent app.

For predictable controls and lighting, keep one surface active at a time:

- Open only Claude Desktop or Hermes Desktop while using the bridge.
- Close those desktop apps before using a terminal agent in Ghostty.
- Quit Codex while using the Micro with either app.
- Quit both supported apps before returning to Codex.

The background agent clears its lighting and disconnects when no supported app
is open. The next Codex update can then restore Codex's state.

## Related projects and documentation

- [Work Louder Codex Micro](https://worklouder.cc/codex-micro)
- [FreeMicro protocol implementation](https://github.com/eliBenven/freemicro)
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code voice dictation](https://code.claude.com/docs/en/voice-dictation)
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [Dictate messages and documents on Mac](https://support.apple.com/guide/mac-help/use-dictation-mh40584/mac)
