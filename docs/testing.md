# Hardware acceptance testing

Use this checklist before publishing a release or marking new Codex Micro
firmware or a Claude Desktop version as compatible. Run it on a Mac that
matches the [supported baseline](compatibility.md).

## Prepare the Mac

1. Download the release candidate from its draft GitHub release. Do not reuse
   a local build. Verify the attached checksum.
2. Open the extracted app from Downloads before moving it. Confirm Louder
   Bridge asks to be moved and does not request permission, add hooks, or
   install a login agent.
3. Move the app into Applications and try to open it. If macOS blocks the
   first launch, use **System Settings → Privacy & Security → Open Anyway**.
   Approve Input Monitoring and Accessibility. If macOS quits the app after
   either change, confirm onboarding reopens it and the background agent starts
   without a manual restart.
4. In a clean test account, leave Input Monitoring off for five minutes.
   Confirm the dialog identifies the missing permission, opens the matching
   setting, and exits without installing hooks or a login agent. Confirm source
   setup does not open the app a second time and rolls back. Enable the
   permission, reopen the app, and confirm setup can finish.
5. After both onboarding runs, confirm source setup finishes within fifteen
   seconds of Louder Bridge closing. In Activity Monitor, check that no
   `open -W` process was created.
6. Start source setup again and interrupt it with Ctrl-C while the app is
   waiting. Confirm it restores the previous app and leaves no setup worker or
   new application backup behind.
7. Run `npm run doctor`, `npm test`, and `npm run status`.
8. Confirm the background agent and hook server are ready.

Record macOS, Node.js, Codex Micro firmware, connection type, device driver,
the active desktop app, and Louder Bridge versions in the release notes.

## Check automatic ownership

1. Quit Claude Desktop.
2. Confirm `npm run status` reports Claude Desktop as closed and the Micro as
   inactive.
3. Open Claude Desktop.
4. Within ten seconds, confirm the status reports the Micro as connected.
5. Turn the Micro off, wait for the status to change to waiting, then turn it
   on and confirm it reconnects without restarting the service.
6. Quit and reopen Claude Desktop once more. Confirm the Micro is released and
   reclaimed each time.
7. Disable and re-enable Input Monitoring. Confirm launchd restarts the agent
   and the Micro reconnects without reopening Louder Bridge.
8. Disable and re-enable Accessibility. Confirm the service reports the change
   and voice input recovers without reinstalling.

## Check Claude lifecycle states

Start a local Claude Code session and verify the assigned Agent Key:

1. Before any session starts, all six Agent Keys and the ambient ring are dim
   white.
2. `SessionStart` keeps its assigned key white.
3. Submitting a prompt produces breathing blue on the key and ambient ring.
4. A permission request produces breathing amber on both.
5. A successful stop produces solid green on both.
6. A failed stop produces breathing red on both.
7. Ending the session returns its key and the ambient ring to dim white.

Repeat with six simultaneous sessions. Confirm each session keeps its Agent Key
and a seventh inactive session replaces the oldest inactive slot.

## Check session navigation

1. Create two local Code sessions in different project directories.
2. Press each illuminated Agent Key.
3. Confirm Claude Desktop comes forward and opens the matching session.
4. Quit Claude Desktop and press a previously assigned key. Confirm the bridge
   logs the launch result without exiting.

## Check Micro push-to-talk

Use a distinctive sentence that is easy to recognize and contains no private
information. Quit Codex before starting this test. Codex has its own Micro
integration and can consume the same MIC and send events while Louder Bridge is
testing Claude.

1. Open an existing local Code session and focus its composer.
2. Hold MIC. Confirm Claude's listening indicator appears in that composer.
3. Speak the test sentence, then release MIC.
4. Confirm the listening indicator closes and the sentence appears in the same
   composer.
5. Confirm the bridge did not submit the prompt, open another session, place
   text in Codex, or create a quick-entry window.
6. Repeat the hold-and-release cycle ten times. Each hold should start one
   recording and each release should stop it.
7. Tap MIC once. Confirm dictation returns to idle after the short
   double-press window without becoming stuck.
8. Double-tap MIC within 350 ms. Confirm dictation stays active after the
   second release, then press MIC once and confirm it stops.
9. Confirm a latched recording still writes to the same composer and does not
   submit the prompt.
10. Disconnect or power off the Micro while MIC is held or latched. Confirm
   dictation stops.
11. Press the key to the right of MIC. Confirm it sends the current composer
    exactly once.
12. Open a Claude approval prompt, focus its default approval action, and press
    the same key. Confirm the action is accepted exactly once.
13. Restart Claude, restart the bridge, and power-cycle the Micro. Repeat the
   test after each restart.
14. Run the complete test once over USB-C and once over Bluetooth.

## Check the Codex conflict handoff

1. Start with Claude Desktop open, Codex closed, and the Micro connected.
2. Open Codex. Confirm Louder Bridge shows one conflict notice and clears its
   Agent Key lighting.
3. Leave both apps open for ten seconds. Confirm the notice does not repeat and
   Louder Bridge does not reconnect to the Micro.
4. Quit Codex. Confirm the bridge reconnects, restores the Claude session
   lighting, and handles MIC and send without an app or agent restart.

Do not infer transcript success from bridge logs. The logs prove only that MIC
edges arrived and Claude's dictation control changed state. A tester must
confirm that the spoken sentence appears in the correct composer.

Record the voice route reported by `npm run status`. For `Claude composer`,
also record the Claude account type and whether an organization policy applies.
For `macOS Dictation`, record the selected Dictation language and processing
setting.

## Check Hermes Desktop

1. Quit Codex and Claude Desktop, then open Hermes Desktop.
2. Start a local Hermes session and send a prompt. Confirm its Agent Key and
   exterior lighting show running, needs-input, complete, and error states when
   those events occur.
3. Create a second recent session. Press each assigned Agent Key and confirm
   Hermes opens the matching session.
4. Restart Hermes. On the first MIC press, hold the key, speak a distinctive
   sentence, and release it. Confirm the transcript appears in the focused
   composer without being sent.
5. Repeat MIC hold and release three times. Each press must start one recording
   and each release must stop it.
6. Press the key to the right of MIC. Confirm Hermes sends the draft once.
7. Quit Hermes and open Codex. Confirm Louder Bridge releases the Micro before
   Codex takes ownership.

Hermes lifecycle events use the managed plugin. MIC, send, and session
navigation use separate desktop controls, so test all three paths.

## Check Ghostty terminal agents

1. Quit Claude Desktop, Hermes Desktop, and Codex Desktop. Leave Ghostty open
   without an agent and confirm the Micro remains inactive.
2. Start Claude Code, Codex CLI, or Hermes in Ghostty. Confirm the status output
   reports Ghostty and a terminal agent as open, then confirm the Micro connects.
3. If Codex asks whether to trust the hook, approve it. Confirm a session start,
   prompt, approval, completion, and end produce the expected lighting states.
4. Open two tabs or splits and run one session in each. Submit a prompt in each
   terminal, then use their Agent Keys to move between them. Confirm each key
   focuses the correct tab or split.
5. Allow Louder Bridge to control Ghostty if macOS displays an Automation
   prompt. Confirm denying permission produces a clear navigation error without
   stopping the background agent.
6. Focus an agent prompt, hold MIC, speak a distinctive sentence, and release
   MIC. For Claude Code, confirm hold-Space push-to-talk inserts the transcript.
   For Hermes, confirm the first `Control+B` starts recording and the second
   stops it. For Codex CLI, confirm macOS Dictation inserts the transcript.
   None of these routes should send the draft.
7. In Hermes, hold MIC and move to another pane before releasing it. Confirm
   Ghostty returns to the original Hermes pane and stops recording there.
8. Press the key to the right of MIC. Confirm Ghostty sends the draft once.
9. Stop the last terminal agent while leaving Ghostty open. Confirm Louder
   Bridge releases the Micro.
10. Repeat the focused test once with each installed agent: Claude, Codex, and
   Hermes.

Record the Ghostty version, agent version, connection type, voice route, and
whether macOS requested Automation permission. Do not mark terminal support as
physically verified from AppleScript checks alone; the lifecycle and Micro
paths must pass together.

## Latest Ghostty candidate result

A locally built v0.3.1 candidate passed a mixed-pane USB test on August 8,
2026:

| Component | Version or result |
|---|---|
| macOS | 26.5.2 (25F84) |
| Ghostty | 1.3.1 |
| Claude Code | 2.1.226 |
| Codex CLI | 0.147.0 |
| Louder Bridge | 0.3.1 candidate |
| Embedded Node.js | 22.23.1 |
| Codex Micro firmware | v0.4.1 |
| Connection | USB |
| Claude Code MIC | Hold-Space push-to-talk passed |
| Codex CLI MIC | macOS Dictation passed |
| Send key | Passed in both panes |
| Agent Keys | Switched to the correct pane |
| Lifecycle response | Key and exterior lighting followed both sessions |

Hermes-in-Ghostty controls passed a physical test with build `809cde7` on
August 8, 2026. The bridge recorded a matching voice start and stop, Hermes
voice input worked, the Agent Key focused the correct pane, and the session
lighting behaved as expected.

Follow-up build `b00c76a` passed the pane-switch check. Releasing MIC after
moving focus returned to the original Hermes pane and stopped recording there.

## Latest Hermes candidate result

A locally built v0.2.0 candidate archive passed the focused Hermes test on
August 4, 2026:

| Component | Version or result |
|---|---|
| macOS | 26.5.2 (25F84) |
| Hermes Desktop | 0.17.0 |
| Hermes Agent | 0.19.0 (2026.7.20), upstream `a4973c3f` |
| Louder Bridge | 0.2.0 candidate archive |
| Embedded Node.js | 22.23.1 |
| Codex Micro firmware | v0.4.1 |
| Connection | Bluetooth Low Energy |
| MIC hold and release | Passed in the Hermes composer |
| Transcript insertion | Passed and did not submit automatically |
| Send key | Passed; one Return event reached Hermes |
| Agent Keys | Session navigation passed |
| Lifecycle response | Lighting, exterior effects, and sound feedback passed |
| Installation | Fresh app and background-agent upgrade passed after permission approval |
| App handoff | Codex released the Micro to Hermes and regained it afterward |

The tester confirmed the transcript in Hermes and reported no missed controls
or rough transitions. Bridge diagnostics recorded dictation, send, and
lifecycle events without audio or transcript content.

## Latest downloaded-release hardware result

The v0.1.2 archive downloaded from its GitHub release passed a focused physical
test on August 4, 2026:

| Component | Version or result |
|---|---|
| macOS | 26.5.2 (25F84) |
| Claude Desktop | 1.24012.9 |
| Louder Bridge | 0.1.2, revision `5b579d203e325cd75be5de214879b89dc93db671` |
| Embedded Node.js | 22.23.1 |
| Codex Micro firmware | v0.4.1 |
| Connection | Bluetooth |
| Installation | Upgraded the existing app and background agent without rollback |
| Permissions | Input Monitoring and Accessibility recovered after approval |
| Voice and send | MIC hold and release inserted spoken text; the adjacent key sent Return |
| Lighting | Six-key standby, lifecycle colors, exterior effects, and pulsing passed |
| App handoff | Closing Claude released the Micro for Codex |

The tester confirmed the lighting visually. Authenticated diagnostics also
recorded fresh voice, send, lifecycle, connection, and release events from the
installed v0.1.2 service. No new errors appeared during the run. The same core
MIC and send controls passed over USB-C on the same hardware.

This focused qualification does not cover every item in this document. The
visible Cowork composer route, double-tap latching, approval prompts, wired
restart and power-cycle cases, and the remaining recovery checks remain open.

## Earlier development-build results

The following focused test passed over Bluetooth on August 2, 2026:

| Component | Version or result |
|---|---|
| macOS | 26.5.2 (25F84) |
| Claude Desktop | 1.24012.9 |
| Louder Bridge | 0.1.0 development build |
| Embedded Node.js | 22.23.1 |
| Codex Micro firmware | v0.4.1 |
| Connection | Bluetooth |
| MIC hold and release | Passed in Claude Code |
| Transcript insertion | Passed with a distinctive spoken phrase |
| Send key | Passed; one Return event reached Claude |
| Lifecycle response | Passed; running and complete hooks reached the bridge |

Codex was closed for the August 2 run. With Codex open, the same voice input
was also delivered to Codex, which made the Claude result appear to fail.

On August 3, an installed development build passed the Codex-to-Claude
transition over Bluetooth. The bridge stayed healthy and left the Micro with
Codex while Codex was open. After Codex quit and Claude Code opened, the bridge
connected without an app or agent restart. MIC hold and release inserted
dictated text in Claude, and the adjacent key submitted it once. After the
tester returned to Codex, authenticated status showed Codex open, Claude
closed, and the Micro released by the bridge.

The tester also confirmed MIC hold and release, dictated text, and the adjacent
send key in Claude Code over USB-C. That check did not cover every restart,
approval, or power-cycle case in this checklist.

The source installation completed after stale privacy records from earlier ad
hoc builds were reset. That run did not qualify a clean packaged-release
installation; the later v0.1.2 test above qualified the downloaded package on
the same Mac.
The conflict notice with both apps kept open, double-tap latching, the visible
Cowork composer route, approval prompts, USB-C restart and power-cycle cases,
and the rest of this checklist remain open.

## Check failure recovery

1. Disconnect the Micro while a session is active. Claude hooks must continue
   to succeed.
2. Reconnect the Micro. Its lighting should recover without restarting Claude.
3. Replace the native driver with a deliberately invalid test fixture and
   restart the service. Confirm `npm run status` reports the driver name and
   error. Do this only in a disposable test bundle.
4. Restore the original bundle and confirm the next clean agent start
   succeeds.
5. Send a hook request without the private bearer token and confirm the local
   server returns HTTP 401.
6. Grow each log past 1 MiB and confirm no more than three rotated backups are
   retained.
7. Confirm standard logs contain no project names, prompts, or session IDs.
8. Confirm voice logs contain control state only, with no audio or transcript
   text.

## Check upgrade and removal

1. Run setup over an existing installation and confirm unrelated Claude
   settings and hooks remain unchanged.
2. Confirm the launch agent runs from the installed Louder Bridge bundle rather
   than the source checkout.
3. Move or remove the source checkout and reopen Claude Desktop. The bridge
   should still start.
4. Run `npm run uninstall`.
5. Confirm the agent, application bundle, authentication token, and Louder
   Bridge hooks are gone. Unrelated Claude settings and log files should remain.

Do not publish the release if any required check fails. Record the failure and
the exact component versions, fix or document the compatibility boundary, then
run the checklist from the beginning.
