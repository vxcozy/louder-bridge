# How-to guides

For a first-time setup, start with the [tutorial](tutorial.md).

## Grant macOS permissions

Louder Bridge needs macOS Input Monitoring permission to open the Micro in
non-exclusive HID mode. It needs Accessibility permission to operate dictation
and composer controls in Claude or Hermes.

1. Open **System Settings → Privacy & Security → Input Monitoring**.
2. Add or enable **Louder Bridge**.
3. Open **Privacy & Security → Accessibility** and enable **Louder Bridge**
   there too.
4. Return to Claude Desktop or Hermes Desktop. The background agent starts as
   soon as both permissions are available.

The app waits up to five minutes for each permission. If that time expires, it
opens the missing setting and asks you to open Louder Bridge again after you
enable it. Source setup rolls back before it exits, so rerun `npm run setup`
after fixing the permission.

For a manual development run with `npm start`, grant permission to the terminal
application instead.

GitHub prereleases use an ad-hoc signature rather than a stable Developer ID
identity. macOS may ask for Input Monitoring or Accessibility again after an
upgrade.

With the hook server running, `npm run status` gets permission state from the
background app. If the server is down, it launches a fresh app probe through
LaunchServices. A direct check from a terminal can report the terminal's
permission instead.

## Troubleshoot startup

Start with the compatibility check:

```bash
npm run doctor
```

Then check the background agent:

```bash
npm run status
```

### Louder Bridge asks to be moved

Quit Louder Bridge, move the app into Applications with Finder, then open it
again. First launch stops in Downloads or a temporary Gatekeeper location. The
login agent needs a stable app path. If you use a symlink, its target must be
inside Applications.

### macOS blocks the first launch

Move Louder Bridge into Applications and try to open it once. Then open
**System Settings → Privacy & Security**, find the Louder Bridge message, and
choose **Open Anyway**.

Only make this exception for an archive downloaded from this repository's
Releases page. The checksum is attached to the same release.

## Troubleshoot the background agent

`npm run status` reports the launch agent, authenticated hook server, supported
desktop apps, and the Micro. When the server is down, it reads the installed app
version and asks a fresh app process for both macOS permission states. If the
agent or server is unavailable, reinstall and restart it:

```bash
npm run setup
```

Keep the command open until the app finishes permission onboarding. Setup
commits the upgrade after the replacement background agent starts. If that
step fails, it restores the previous installation.

The service writes logs to:

```text
~/Library/Logs/LouderBridge/bridge.log
~/Library/Logs/LouderBridge/bridge-error.log
```

Each file is limited to 1 MiB with three rotated backups. Log files are
readable only by the current user.

To inspect recent errors:

```bash
tail -n 50 ~/Library/Logs/LouderBridge/bridge-error.log
```

### The bundled Micro driver is unavailable

`npm run doctor` checks that the installed app contains its native Codex Micro
driver. If the check fails, reinstall the app with `npm run setup`. If it still
fails, save the full diagnostic output and open a bug report.

The bundled driver uses an independently documented, MIT-licensed protocol
implementation. It does not require ChatGPT. The interface remains
experimental until Work Louder supports it.

### The Micro is detected but cannot be opened

Grant Input Monitoring permission to Louder Bridge. If the error remains:

1. Confirm `npm run status` reports Input Monitoring as granted.
2. Quit any other app that is actively controlling the Micro.
3. Disconnect and reconnect the Micro.
4. Quit and reopen the app you want to use with the Micro.

### MIC does not start Claude dictation

Start with `npm run status`. Input Monitoring and Accessibility must both
report `granted`, and the voice adapter must not report an error.

Then check the following:

1. Open a local session in Claude Desktop's Code tab and focus its composer.
2. Quit Codex so its built-in Micro integration cannot receive the same input.
   If Louder Bridge reports the conflict, you do not need to restart anything;
   it reconnects after Codex quits.
3. Allow microphone access when macOS asks.
4. Hold MIC long enough for the listening indicator to appear.
5. Release MIC and confirm the indicator closes.

When Claude exposes a composer microphone button, Louder Bridge holds that
control through Accessibility. In Code views without the button, it uses
macOS Dictation. It does not use fixed screen coordinates, read the composer,
receive microphone audio, or inspect the transcript. Both routes are
experimental because Anthropic does not publish a supported Desktop voice
interface.

The visible composer route depends on Claude voice being available for the
account and organization. Anthropic documents its account, data, and language
requirements in [Voice dictation in Claude
Code](https://code.claude.com/docs/en/voice-dictation). The fallback depends on
[macOS Dictation](https://support.apple.com/guide/mac-help/use-dictation-mh40584/mac)
instead. Check the Mac's Dictation language and processing settings when that
route is active.

### MIC does not start Hermes dictation

Run `npm run status` first. Hermes Desktop must be the active app, and Input
Monitoring and Accessibility must both report `granted`.

Then check the following:

1. Quit Codex and Claude Desktop.
2. Focus the composer in a local Hermes session.
3. Confirm the composer shows a **Voice dictation** control.
4. Allow microphone access for Hermes when macOS asks.
5. Hold MIC until Hermes starts listening, then release it.

If lifecycle lighting works, the plugin is already loaded. MIC uses a separate
Accessibility route, so check the Voice dictation button and macOS permissions
instead. A new plugin installation needs a full Hermes restart before its hooks
load.

Agent Key navigation uses Hermes's default `Ctrl+1` through `Ctrl+9` recent
session shortcuts. Restore those bindings if session navigation fails.

### The local port is already in use

Choose another loopback port and reinstall:

```bash
LOUDER_BRIDGE_PORT=47832 npm run setup
```

Setup records the same port in the hook command and background agent.
Non-loopback addresses are rejected.

## Verify state changes without waiting for Claude

Open one supported desktop app and turn on the Micro, then simulate states:

```bash
node src/cli.mjs simulate running
node src/cli.mjs simulate needs_input
node src/cli.mjs simulate complete
node src/cli.mjs simulate error
```

The first Agent Key should change to blue, amber, green, and red in sequence.

## Test without a physical device

The installed background agent already owns the local port. Remove it before a
manual mock-device run:

```bash
npm run uninstall
node src/cli.mjs start --mock-device
```

Send simulated events from another terminal. The bridge prints the six slot
states instead of sending lighting records to hardware. Run `npm run setup`
again afterward to restore the normal background integration.

## Map the remaining Codex Micro controls

Louder Bridge owns the six Agent Keys, their status channel, and MIC
push-to-talk. Configure the Command Keys, encoder, and joystick as standard
shortcuts through Work Louder Input.

These Claude Desktop mappings work well:

| Action | macOS shortcut |
|---|---|
| New Code session | `Cmd+N` |
| Close session | `Cmd+W` |
| Next session | `Ctrl+Tab` |
| Previous session | `Ctrl+Shift+Tab` |
| Stop Claude | `Esc` |
| Toggle diff | `Cmd+Shift+D` |
| Toggle terminal | `Ctrl+\`` |
| Show all Code shortcuts | `Cmd+/` |

These are standard HID shortcuts, so they still work when Louder Bridge is not
running.

## Use a different Claude configuration directory

Set `CLAUDE_CONFIG_DIR` for both setup and removal:

```bash
CLAUDE_CONFIG_DIR="<claude-config-directory>" npm run setup
CLAUDE_CONFIG_DIR="<claude-config-directory>" npm run uninstall
```

The bridge reads or writes `settings.json` inside that directory.

## Return lighting control to Codex

Codex and Louder Bridge can overwrite each other's RGB updates while Codex and
a supported app are open.

To return full lighting ownership to Codex:

1. Quit Claude Desktop and Hermes Desktop.
2. Bring ChatGPT or Codex to the foreground.
3. Trigger a Codex session update if the lighting does not refresh
   immediately.

The background agent releases the Micro when neither supported app is open.

## Remove Louder Bridge from Claude Code

For a release installed in the system Applications folder, run:

```bash
"/Applications/Louder Bridge.app/Contents/MacOS/LouderBridge" --uninstall
```

For a source install, run:

```bash
npm run uninstall
```

The command stops the bridge and preserves unrelated settings and hooks in
`~/.claude/settings.json`. It removes only the managed Hermes plugin and its
configuration entries. It also removes the installed app and private
authentication token. Logs remain in `~/Library/Logs/LouderBridge`; you can
delete them separately.
