# Use a Codex Micro with Ghostty

This tutorial connects the Micro to a local Claude, Codex, or Hermes session
running in Ghostty. Once Louder Bridge is installed, you only need to start the
agent you normally use. The bridge runs in the background.

## What you need

- An Apple Silicon Mac running macOS 15 or newer
- Ghostty 1.3 or newer
- A Work Louder Codex Micro connected over USB-C or Bluetooth
- Claude Code, Codex CLI, or Hermes Agent installed locally
- macOS Dictation enabled if you use Codex CLI

## 1. Install Louder Bridge

Download the latest archive from GitHub Releases, move **Louder Bridge.app** to
**Applications**, and open it once. Approve Input Monitoring and Accessibility
when macOS asks.

If you install from source, run:

```bash
npm test
npm run setup
```

Setup adds lifecycle hooks for Claude Code and Codex CLI. If Hermes is
installed, it also enables the managed Louder Bridge plugin. Existing hooks and
settings are preserved.

## 2. Start one agent in Ghostty

Quit Claude Desktop, Hermes Desktop, and the Codex desktop app for this first
test. Open Ghostty and start one of these agents:

```bash
claude
codex
hermes
```

Codex CLI may ask whether you trust the new hook command. Approve the Louder
Bridge hook. Do not use Codex's bypass option.

Ghostty may also ask whether Louder Bridge can control it. Choose **Allow**.
This permission lets Agent Keys focus terminals. Accessibility lets MIC operate
the active voice route and lets the send key press Return.

Louder Bridge ignores an idle Ghostty window. It connects the Micro only while
Ghostty has at least one supported agent process attached to a real terminal.

## 3. Check lifecycle lighting

Send a short test prompt. The assigned Agent Key should move through these
states:

1. Soft white when the session starts.
2. Breathing blue while the agent works.
3. Solid green when the turn completes.
4. Breathing amber when the agent needs approval.
5. Breathing red if the turn fails.

The ambient lighting follows the session that changed most recently.

## 4. Check Agent Key navigation

Open a second Ghostty tab or split and start another local agent session. Send
one prompt in each terminal so Louder Bridge can associate the session with
Ghostty's stable terminal ID.

Press the Agent Key for the first session, then the key for the second. Ghostty
should select the matching tab or split each time.

Louder Bridge records a terminal association only when a session starts or you
submit a prompt from the focused terminal. A completion event arriving in the
background cannot move that association to another terminal.

## 5. Check MIC and send

Click the agent's prompt so the text cursor is active. Hold MIC and speak a
short sentence. Release MIC and confirm that the sentence appears without being
sent. Claude Code uses hold-Space push-to-talk. Hermes starts voice input with
`Control+B` when you press MIC and sends `Control+B` again when you release it.
Codex CLI uses macOS Dictation.

Press the key immediately to the right of MIC. It should send Return to the
focused Ghostty terminal once.

The bridge receives only button edges and lifecycle fields. The terminal agent
or macOS handles the microphone and transcript; Louder Bridge never receives
either one.

## 6. Check status

From the source checkout, run:

```bash
npm run status
```

A working terminal session reports:

```text
Ghostty: open
Terminal agent: open
Active app: Ghostty terminal
Codex Micro: connected
```

You can close the status terminal afterward. It is not needed for normal use.

## If something does not work

- If the Micro stays with Codex Desktop, quit the desktop app. Louder Bridge
  waits rather than letting two apps handle the same buttons.
- If lighting stays off in Codex CLI, restart Codex and approve the hook when
  it asks. Setup does not bypass Codex's hook trust check.
- If an Agent Key has no terminal association, focus that terminal and submit
  one prompt before pressing the key again.
- If MIC does nothing, focus the prompt and try the agent's shortcut on your
  keyboard first: hold Space in Claude Code or press `Control+B` twice in
  Hermes. In Codex CLI, enable macOS Dictation. Louder Bridge needs
  Accessibility permission for all three routes.
- If send fails, bring Ghostty forward and confirm Louder Bridge still has
  Accessibility permission.
- If Agent Key navigation fails, open **System Settings → Privacy & Security →
  Automation** and allow Louder Bridge to control Ghostty.

Only Ghostty has terminal-host integration in this release. Other terminal
apps do not expose the stable terminal IDs that Louder Bridge uses for exact
Agent Key navigation.
