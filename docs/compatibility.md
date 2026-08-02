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

Codex was closed during the passing run so its built-in Micro integration did
not receive the same controls. This focused test does not qualify the release
candidate. The visible Cowork composer route, double-tap latching, approval
prompts, USB-C controls, lighting matrix, recovery, and signed-package test
remain open. See the [hardware acceptance checklist](testing.md).

## Compatibility policy

The independently documented device protocol, Claude resume URL, and Claude
Accessibility surface for dictation are unsupported integration points. A
firmware or desktop update can break them without notice. Stable v1 is blocked
until supported replacements exist.

Preview releases run the Node matrix and record one physical baseline. A new
Codex Micro firmware or Claude version is listed as compatible only after
`npm run doctor`, the automated suite, and the hardware checklist pass.

Node.js 20 is not supported because it reached end of life in 2026 and no
longer receives security fixes.
