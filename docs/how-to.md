# How-to guides

For a first-time setup, start with the [tutorial](tutorial.md).

## Grant macOS permissions

Louder Bridge needs macOS Input Monitoring permission to open the Micro in
non-exclusive HID mode. It needs Accessibility permission to operate Claude's
dictation control.

1. Open **System Settings → Privacy & Security → Input Monitoring**.
2. Add or enable **Louder Bridge**.
3. Open **Privacy & Security → Accessibility** and enable **Louder Bridge**
   there too.
4. Return to Claude Desktop. The background agent starts as soon as both
   permissions are available.

For a manual development run with `npm start`, grant permission to the terminal
application instead.

A source build does not have a stable Developer ID signature. Reinstalling it
can make macOS ask for permission again. Signed release builds keep the same
identity across upgrades.

Permission status from `npm run status` is authoritative because it comes from
the background app. A permission check run directly from a terminal can belong
to the terminal instead.

## Troubleshoot startup

Start with the compatibility check:

```bash
npm run doctor
```

Then check the background agent:

```bash
npm run status
```

## Troubleshoot the background agent

`npm run status` reports the launch agent, authenticated hook server, Claude
Desktop, and the Micro. If the agent or server is unavailable, reinstall and
restart it:

```bash
npm run setup
```

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
4. Quit and reopen Claude Desktop.

### MIC does not start Claude dictation

Start with `npm run status`. Input Monitoring and Accessibility must both
report `granted`, and the voice adapter must not report an error.

Then check the following:

1. Open a local session in Claude Desktop's Code tab and focus its composer.
2. Allow Claude Desktop to use the microphone when macOS asks.
3. Hold MIC long enough for Claude's listening indicator to appear.
4. Release MIC and confirm the indicator closes.

Louder Bridge finds Claude's dictation control through Accessibility. It does
not use fixed screen coordinates, read the composer, receive microphone audio,
or inspect the transcript. The integration is experimental because Anthropic
does not publish this Accessibility interface.

Claude's voice service requires a Claude.ai account and may be disabled by an
organization's policy. Anthropic says transcription does not consume Claude
messages or tokens. See [Voice dictation in Claude
Code](https://code.claude.com/docs/en/voice-dictation) for its account, data,
language, and microphone requirements.

### The local port is already in use

Choose another loopback port and reinstall:

```bash
LOUDER_BRIDGE_PORT=47832 npm run setup
```

Setup records the same port in the hook command and background agent.
Non-loopback addresses are rejected.

## Verify state changes without waiting for Claude

Open Claude Desktop and turn on the Micro, then simulate states:

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

ChatGPT and Louder Bridge can overwrite each other's RGB updates while both
Claude and ChatGPT are open.

To return full lighting ownership to Codex:

1. Quit Claude Desktop.
2. Bring ChatGPT or Codex to the foreground.
3. Trigger a Codex session update if the lighting does not refresh
   immediately.

The background agent notices that Claude has closed and releases the Micro.

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
`~/.claude/settings.json`. It also removes the installed app and private
authentication token. Logs remain in `~/Library/Logs/LouderBridge`; you can
delete them separately.
