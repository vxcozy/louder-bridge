# Security policy

## Supported versions

Security fixes are made on the latest release line. Until the first stable
release, that means the current `main` branch.

## Report a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not open a public issue for a vulnerability that could expose Claude session
metadata, execute commands, disclose local files, bypass loopback
authentication, or alter the installed service.

Include the affected version, impact, reproduction steps, and any suggested
mitigation. Remove real tokens, session IDs, usernames, and project paths from
the report unless they are essential to reproduce the issue.

You can expect an initial response within seven days. A fix timeline depends on
severity and whether the issue is in Louder Bridge or in a private desktop-app
integration.

## Security boundaries

Louder Bridge:

- binds only to a loopback address;
- authenticates every HTTP request with a private local token;
- stores that token and its logs with user-only permissions;
- refuses foreign-owned or hard-linked Claude settings files;
- allowlists hook fields and omits conversation and tool content; and
- does not send data to a Louder Bridge cloud service.

Preview builds include a native IOKit driver for the independently documented
Codex Micro protocol. The driver accepts only the status, lighting, and HID
methods the bridge needs. It cannot issue filesystem, firmware, or bootloader
commands. Preview builds also open a Claude Desktop resume URL, use
Accessibility for desktop voice and send controls, and use Ghostty's preview
AppleScript API to focus terminal panes. These interfaces are experimental,
and stable release checks reject them. Treat them as part of the local trusted
computing base until supported vendor interfaces replace them.

Louder Bridge sees MIC press and release events, but it does not receive audio
or read dictated text. Claude Desktop and Hermes Desktop own their composer
voice paths. Some Claude Code desktop views use macOS Dictation instead. In
Ghostty, Claude Code and Hermes use their hold-Space voice controls, while Codex
CLI uses macOS Dictation. Audio and transcripts stay with the desktop app,
terminal agent, or macOS Dictation.
