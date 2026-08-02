# How Louder Bridge works

## The problem the bridge solves

The Codex Micro has two kinds of integration.

Ordinary controls can behave like a standard keyboard. Work Louder Input can
map those keys, the encoder, and joystick to shortcuts that work in many
applications.

The six Agent Keys are different. Their live colors depend on agent state, and
pressing one is meant to navigate to the agent it represents. Keyboard
remapping cannot tell whether Claude is working, waiting for approval,
finished, or stopped by an error. Louder Bridge reads that session state and
sends it to the Micro.

MIC is also application-aware. A press must begin listening in the active
Claude Code composer, and a release must stop it without sending the prompt or
moving to another session.

## Data flow

```text
Claude Code Desktop
  ├─ lifecycle command hooks
  │    └─ POST 127.0.0.1:47831/hook
  │         └─ six-slot session store
  │              ├─ status → Work Louder lighting RPC
  │              └─ Agent Key → Claude resume link
  └─ Accessibility dictation control
       └─ MIC press/release ← background service ← Micro HID events
```

Claude Code runs a small command hook for each session start, prompt
submission, attention request, completed turn, failure, and session end. The
hook removes prompt and tool content, then sends the event to the bridge over
loopback HTTP.

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

The service checks whether Claude Desktop is running. It connects to the Micro
when Claude opens and disconnects when Claude quits. This keeps startup
automatic without holding the device while the user works in Codex.

macOS can cache a privacy decision in the process that requested it. A child
process may also inherit the parent's privacy identity, which makes a direct
status check misleading. During onboarding, Louder Bridge launches a short app
probe through LaunchServices. The probe writes only the two permission states
to a private temporary file, then exits. The onboarding process deletes that
file and starts the background agent as soon as both permissions are granted.

## Why use Claude Code hooks

Claude Code hooks report lifecycle events directly: session start, prompt
submission, permission requests, notifications, completion, failure, and
session end.

Unlike interface scraping, hooks do not depend on Claude's rendering or layout.
They also avoid watching Claude's private files.

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

- White means available but inactive.
- Breathing blue means work is in progress.
- Green means the latest turn completed.
- Breathing amber demands attention.
- Breathing red reports failure.
- Off means no live assignment.

Running, needs-input, and error states breathe. Idle and complete states stay
solid.

When you select an Agent Key, the bridge also applies that slot's color to the
other keys and ambient ring. The other five status lights do not change.

## Device driver boundary

Device access runs in a small native child process. The Node service sees a
narrow transport with four jobs: report availability, send lighting, receive
Agent Key and MIC events, and close the connection.

The child process opens the Micro non-exclusively through IOKit. It frames JSON
messages for USB-C or Bluetooth, requests `device.status`, and waits for a real
reply before reporting a connection. Host commands are limited to status,
lighting configuration, and thread-status lighting. Firmware, filesystem, and
bootloader methods are rejected.

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

## Privacy boundary

The hook receives more data than the lighting system needs, so it builds a new
allowlisted payload before making the local request.

The allowlist contains only the session ID, event name, and notification type.
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

When the bridge finds a connected Micro while both desktop apps are open, it
shows one conflict notice and releases the device. It stays disconnected until
Codex quits, then reconnects to the Micro without restarting Claude.

For predictable controls and lighting, keep one desktop app open at a time:

- Open Claude Desktop while working in Claude.
- Quit Codex while using the Micro with Claude.
- Quit Claude Desktop before returning to Codex.

The background agent clears its Agent Key lighting and disconnects when Claude
quits. The next Codex update can then restore Codex's state.

## Related projects and documentation

- [Work Louder Codex Micro](https://worklouder.cc/codex-micro)
- [FreeMicro protocol implementation](https://github.com/eliBenven/freemicro)
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code voice dictation](https://code.claude.com/docs/en/voice-dictation)
- [Dictate messages and documents on Mac](https://support.apple.com/guide/mac-help/use-dictation-mh40584/mac)
