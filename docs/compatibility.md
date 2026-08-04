# Compatibility

This page records the versions that have been exercised together. "Supported"
means the automated suite covers that runtime. "Physically verified" means the
full path from a Claude hook to the Codex Micro and back to Claude Desktop has
also been tested on hardware.

## Supported baseline

| Component | Supported |
|---|---|
| Mac | Apple Silicon |
| macOS | 15 or newer |
| Node.js for source setup | 22, 24, or 26 |
| Device | Work Louder Codex Micro |
| Claude | Local Code sessions in Claude Desktop |
| Device driver | Bundled native IOKit driver, experimental until vendor-supported |

Louder Bridge embeds the Node.js executable used during setup, so Node does not
need to remain on the user's shell path after installation.

## Latest release qualification

The v0.1.2 archive downloaded from GitHub passed a physical test on August 4,
2026:

| Component | Version or result |
|---|---|
| Mac architecture | Apple Silicon (`arm64`) |
| macOS | 26.5.2 (25F84) |
| Claude Desktop | 1.24012.9 |
| Louder Bridge | 0.1.2, revision `5b579d203e325cd75be5de214879b89dc93db671` |
| Embedded Node.js | 22.23.1 |
| Codex Micro firmware | v0.4.1 |
| Connection | Bluetooth |
| Voice and send | MIC hold and release inserted spoken text; the adjacent key sent it |
| Lighting | Six-key standby, lifecycle colors, exterior effects, and pulsing passed |
| App handoff | The bridge released the Micro for Codex after Claude closed |

The same core MIC and send controls passed over USB-C on the same hardware.
This qualification used the exact published package.

## Earlier end-to-end baseline

The following combination passed the end-to-end acceptance test on July 31,
2026, before the bundled native driver replaced the ChatGPT-hosted runtime:

| Component | Version |
|---|---|
| Mac architecture | Apple Silicon (`arm64`) |
| macOS | 26.5.2 (25F84) |
| Node.js | 22.23.1 |
| ChatGPT | 26.727.40816 |
| Work Louder runtime | 0.1.11 |
| Claude Desktop | 1.24012.9 |
| Louder Bridge | 0.1.0 development build |

The verified path included real Claude lifecycle hooks, Micro lighting, an
Agent Key press, and navigation to the matching Claude Desktop session. The
baseline did not include MIC-triggered dictation and does not qualify the new
driver.

## Direct-driver checks

The bundled driver completed a real USB `device.status` round trip on July 31,
2026:

| Component | Version |
|---|---|
| Connection | USB-C |
| Codex Micro firmware | v0.4.1 |
| Battery reported by device | 100% |
| Driver | `native-iokit-protocol` |

This result proves device discovery, report framing, and a two-way protocol
exchange over USB-C.

A later focused test passed over Bluetooth on August 2, 2026:

| Component | Version or result |
|---|---|
| Mac architecture | Apple Silicon (`arm64`) |
| macOS | 26.5.2 (25F84) |
| Node.js | 22.23.1 |
| Claude Desktop | 1.24012.9 |
| Louder Bridge | 0.1.0 development build |
| Codex Micro firmware | v0.4.1 |
| Driver | `native-iokit-protocol` over Bluetooth |
| Verified behavior | MIC hold and release, transcript insertion, send key, lifecycle hooks |

The tester later confirmed MIC hold and release, transcript insertion, and the
send key in Claude Code over USB-C. Wired restart, approval, and power-cycle
cases remain open.

Codex was closed during the passing run so its built-in Micro integration did
not receive the same controls. These development-build checks preceded the
v0.1.2 package qualification above. The visible Cowork composer route,
double-tap latching, approval prompts, wired restart and power-cycle cases, and
the rest of the recovery checklist remain open. See the [hardware acceptance
checklist](testing.md).

## Compatibility policy

The independently documented device protocol, Claude resume URL, and Claude
Accessibility surface for dictation are unsupported integration points. A
firmware or desktop update can break them without notice. Stable v1 is blocked
until supported replacements exist.

The current vendor documentation does not cover the adapters the bridge needs.
[Anthropic's desktop link guide](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)
documents starting a Code session, but not reopening an existing local Code
session by ID. Its [Claude Code voice guide](https://support.claude.com/en/articles/14554000-claude-code-power-user-tips)
tells users to press the desktop voice button and does not provide an external
control interface. [Work Louder's Codex Micro page](https://worklouder.cc/codex-micro)
lists Codex and Work Louder Input as its software integrations. During the
v0.1.2 review, that page had no link to a device SDK or protocol.

Preview releases run the Node matrix and record one physical baseline. A new
Codex Micro firmware or Claude version is listed as compatible only after
`npm run doctor`, the automated suite, and the hardware checklist pass.

Node.js 20 is not supported because it reached end of life in 2026 and no
longer receives security fixes.
