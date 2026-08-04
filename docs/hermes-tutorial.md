# Connect a Codex Micro to Hermes Desktop

After this tutorial, the Micro will show the state of a local Hermes session.
Holding MIC will dictate into the active composer, the key beside MIC will send
the draft, and an assigned Agent Key will reopen its session.

## What you need

- macOS 15 or newer on Apple Silicon
- Hermes Agent and Hermes Desktop
- a Codex Micro connected over USB-C or Bluetooth
- Louder Bridge in the Applications folder

If you are installing Louder Bridge from source, you also need Node.js 22 or
newer.

## 1. Install Hermes

Install Hermes Agent and open Hermes Desktop once. Confirm the `hermes` command
works in a terminal:

```bash
hermes --version
```

Louder Bridge uses the Hermes plugin system for lifecycle events, so the Hermes
command must be available when you open Louder Bridge.

## 2. Install Louder Bridge

Download Louder Bridge from this repository's Releases page, move the app into
Applications, and open it once. Approve Input Monitoring and Accessibility when
macOS asks.

For a source install, run:

```bash
npm test
npm run doctor
npm run setup
```

Setup adds a managed `louder-bridge` plugin to Hermes and enables it without
granting it tool access. It does not change unrelated Hermes plugins or
settings.

If you installed Hermes after Louder Bridge, open Louder Bridge again so it can
add the plugin.

## 3. Restart Hermes Desktop

Quit Hermes Desktop completely, then open it again. Hermes loads newly enabled
plugins when it starts.

Keep Claude Desktop and Codex closed during this test. Louder Bridge gives the
Micro to one app at a time.

## 4. Check the bridge

Run:

```bash
npm run status
```

The useful lines should look like this:

```text
Background agent: running
Hook server: ready
Hermes Desktop: open
Active app: Hermes Desktop
Codex Micro: connected
```

If a permission is denied, toggle Louder Bridge off and back on in both
**System Settings → Privacy & Security → Input Monitoring** and
**Accessibility**.

## 5. Test session lighting

Start a local Hermes session and send a prompt. Its Agent Key should move
through these states:

1. Dim white while the session is ready.
2. Breathing blue while Hermes works.
3. Green when the turn finishes.

An approval prompt uses breathing amber. A failed turn uses breathing red. The
exterior lighting follows the most recently changed session.

## 6. Test push-to-talk and send

Focus the Hermes composer. Hold MIC, wait for the Voice dictation indicator,
and speak a short sentence. Release MIC and wait for the transcript to appear
in the composer. Louder Bridge should not send it automatically.

Press the key to the right of MIC. Hermes should send the draft once.

Double-tap MIC quickly to leave dictation running. Press MIC once more to stop
the latched recording.

Hermes owns the microphone and transcription. Louder Bridge only operates the
visible Voice dictation control and never receives audio or transcript text.

## 7. Test an Agent Key

Create two recent Hermes sessions and send a prompt in each. Press the Agent Key
assigned to the first session. Hermes should come forward and open it.

Navigation uses Hermes Desktop's default `Ctrl+1` through `Ctrl+9` recent
session shortcuts. If you remapped those shortcuts, restore the defaults before
this test. A session outside the nine most recent entries cannot be opened from
an Agent Key yet.

## 8. Return to Codex

Quit Hermes Desktop. Louder Bridge turns off its lighting and releases the
Micro. Open Codex and trigger a session update if its lighting does not return
immediately.

See the [how-to guides](how-to.md) for troubleshooting and removal.
