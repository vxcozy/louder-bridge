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
| Device provider | Experimental ChatGPT adapter for preview builds |

Louder Bridge embeds the Node.js executable used during setup, so Node does not
need to remain on the user's shell path after installation.

## Physical baseline

The following combination passed the end-to-end acceptance test on July 31,
2026:

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
baseline did not include MIC-triggered dictation. The final release candidate
must repeat the checklist in [Hardware acceptance testing](testing.md),
including push-to-talk over USB-C and Bluetooth, after signing and
notarization.

## Compatibility policy

The preview device provider, Claude resume URL, and Claude Accessibility
surface for dictation are private integration points. A desktop update can
break any of them without notice. Stable v1 is blocked until supported
replacements exist.

Preview releases run the Node matrix and record one physical baseline. A new
ChatGPT or Claude version is listed as compatible only after `npm run doctor`,
the automated suite, and the hardware checklist pass.

Node.js 20 is not supported because it reached end of life in 2026 and no
longer receives security fixes.
