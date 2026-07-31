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

MIC reports separate press and release events. The bridge serializes those
events, starts Claude's own dictation on press, and stops it on release. It also
stops dictation if the Micro disconnects while MIC is held.

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
2. Existing sessions keep their physical position.
3. When the set is full, an inactive session is replaced before a session that
   is running or waiting for input.
4. Among equally active candidates, the least recently updated session is
   replaced.

Stable positions make the keys easier to remember. A session does not jump to
another key merely because a different session produced a newer event.

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

## Device provider boundary

Device access goes through a small provider interface. The provider reports its
name, version, availability, and support level. The rest of the bridge only
depends on the operations it needs: discovery, lighting, Agent Key events, and
disconnect.

The preview provider reads Work Louder's Codex Micro library from the installed
ChatGPT application. It does not copy or extract the package. The ASAR loader
reads JavaScript in place and sends native-addon paths to ChatGPT's adjacent
unpacked directory. ChatGPT stays signed and unmodified, and this repository
does not redistribute Work Louder's code.

That provider is experimental. A ChatGPT update can break it, so the release
check will not allow a stable v1 while it remains selected. An official or
explicitly licensed Work Louder SDK can replace it without changing session or
lighting code.

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
in Claude. It does not replace Claude's speech recognition or send audio to a
separate service. Instead, a small native adapter finds the dictation control
inside the frontmost Claude Code window through macOS Accessibility.

On press, the adapter activates Claude and clicks the discovered dictation
control. On release, it invokes the stop action on that same control. The
adapter checks the control's role and surrounding structure rather than using
screen coordinates. Press and release are idempotent, which prevents repeated
device events from toggling dictation in the wrong direction.

The bridge observes only the Micro control edge and whether Claude's dictation
control entered or left its recording state. Claude owns microphone access
and the resulting transcript. Anthropic's [voice dictation
documentation](https://code.claude.com/docs/en/voice-dictation) says Claude
streams recorded audio to its transcription service and does not count that
work against messages or tokens. Louder Bridge never receives the audio and
does not read the composer.

Anthropic does not document this Accessibility surface as a supported
Desktop integration. The voice adapter is therefore experimental, and the
release check blocks stable v1 until a supported interface replaces it.

## Privacy boundary

The hook receives more data than the lighting system needs, so it builds a new
allowlisted payload before making the local request.

The allowlist contains the session ID, working directory, event name,
notification type, model, stop reason, and a few other lifecycle fields. It
excludes prompt text, responses, transcripts, tool arguments, and tool results.
The voice path does not carry audio or transcript text. Normal logs record slot
numbers, states, and MIC edges, not session IDs or project names.

The server accepts only loopback bind addresses. Every request also needs a
random bearer token stored in a user-only file. This prevents another local
process from forging Claude events merely because it can reach the port. There
is no cloud service in the bridge and no account credential is required.

## Coexisting with Codex

The Work Louder library opens the device in non-exclusive mode. This lets
ChatGPT and Louder Bridge both connect, but it does not coordinate their
lighting writes. If Codex and Claude update at the same time, the last write
wins.

To avoid conflicting RGB updates, keep one desktop app active at a time:

- Open Claude Desktop while working in Claude.
- Quit Claude Desktop when returning to Codex.

The background agent clears its Agent Key lighting and disconnects when Claude
quits. The next Codex update can then restore Codex's state.

## Related projects and documentation

- [Work Louder Codex Micro](https://worklouder.cc/codex-micro)
- [Claude Code Desktop](https://code.claude.com/docs/en/desktop)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code voice dictation](https://code.claude.com/docs/en/voice-dictation)
