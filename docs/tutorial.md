# Connect a Codex Micro to Claude Desktop

After this tutorial, one Agent Key will show the state of a local Claude Code
session and open that session when pressed. Holding MIC will start dictation in
the active Code composer; releasing it will stop. A quick double-tap keeps
dictation running until you press MIC again.

## What you need

- macOS on Apple Silicon
- Node.js 22 or newer
- Claude Desktop with the Code tab
- a Codex Micro connected over USB-C or Bluetooth

Run the commands below from the Louder Bridge directory.

## 1. Check the project

Run the automated tests:

```bash
npm test
```

The command should finish without failures.

## 2. Check local compatibility

Run:

```bash
npm run doctor
```

The diagnostic checks Node, the device adapter, and the supported platform. A
compatible preview system ends with:

```text
Result: ready.
```

If it does not, follow [Troubleshoot startup](how-to.md#troubleshoot-startup)
before continuing.

## 3. Install Louder Bridge

Run:

```bash
npm run setup
```

Keep the command open while macOS asks for Input Monitoring and Accessibility.
Setup finishes after the background agent starts. If the app closes early or
activation fails, setup restores the previous installation.

The command performs the one-time setup:

- It creates a self-contained **Louder Bridge.app** with an embedded Node.js
  runtime.
- It adds Louder Bridge hooks to `~/.claude/settings.json` without removing
  existing settings or hooks.
- It installs a macOS background agent after the required permissions are
  granted. The agent starts at login from then on.
- It creates a private authentication token for the local hook server.
- It opens the installed app for permission approval.

After setup finishes, you do not need to keep a terminal open or run
`npm start`.

## 4. Grant macOS permissions

Open **System Settings → Privacy & Security** and enable **Louder Bridge** under
both **Input Monitoring** and **Accessibility**. The installed app waits for
both approvals, then starts the agent. You do not need to reopen it.

Input Monitoring lets the bridge receive Micro controls. Accessibility lets
it operate Claude's composer control or macOS Dictation.

If either permission is missing, follow [Grant macOS
permissions](how-to.md#grant-macos-permissions).

## 5. Check the background agent

Run:

```bash
npm run status
```

The result should begin with:

```text
Background agent: running
Hook server: ready
Claude Desktop: closed
Codex Micro: inactive
```

If either check fails, see [Troubleshoot the background
agent](how-to.md#troubleshoot-the-background-agent).

## 6. Open Claude and turn on the Micro

Open Claude Desktop and turn on the Codex Micro. The background agent detects
Claude and connects without another terminal command.

## 7. Start a local Claude Code session

In Claude Desktop, select the Code tab. Start a local session, then send a
prompt.

The first Agent Key should move through these states:

1. Dim white when the session is ready.
2. Breathing blue while Claude works.
3. Green when the turn completes.

If Claude asks for approval or input, the key breathes amber. If the turn
fails, it breathes red.

The bridge tracks only local sessions. Cloud and SSH sessions execute their
hooks away from the local bridge.

## 8. Open the session from the Micro

Press the illuminated Agent Key. Claude Desktop should come forward and open
the session assigned to that slot.

The bridge copies the selected slot's color to the other keys and ambient ring.

## 9. Test push-to-talk

Quit Codex before this test so its built-in Micro integration does not receive
the same controls.

Keep the current Code session open and place the cursor in its composer. Hold
MIC, wait for Claude's listening indicator, and speak a short, distinctive
sentence. Release MIC.

The sentence should appear in the same composer. It should not be sent
automatically, open another session, or appear in Codex. Claude may ask for
microphone permission the first time.

Press the key to the right of MIC. The sentence should be sent once.

Double-tap MIC quickly. Claude should keep listening after the second release.
Speak another short sentence, then press MIC once to stop. The second sentence
should stay in the same composer without being sent.

## 10. Return to Codex

Quit Claude Desktop. The background agent turns off its Agent Key lights and
disconnects from the Micro. It stays loaded in the background, ready for the
next time Claude opens.

The [how-to guides](how-to.md) cover logs, troubleshooting, the remaining
controls, mock-device mode, and removal.
