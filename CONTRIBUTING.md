# Contributing

Thanks for helping make Louder Bridge more reliable. Bug reports are especially
useful when they include the exact macOS, Claude Desktop, Node.js, Codex Micro
firmware, and connection type.

## Before opening a change

For a bug or compatibility issue, describe:

- what you expected;
- what happened instead;
- whether the Micro used USB-C or Bluetooth;
- the output of `npm run doctor` and `npm run status`; and
- the smallest sequence that reproduces the problem.

Remove usernames, project names, session IDs, tokens, and other private data
from logs before sharing them.

For a larger change, open an issue first so the design and compatibility impact
can be discussed before implementation.

## Develop locally

Use macOS on Apple Silicon with Node.js 22 or newer:

```bash
npm test
npm run authorship:check
npm run security:check
npm run release:check
```

Keep changes focused. Add a regression test for behavior changes and update the
relevant Diátaxis page when commands, setup, architecture, or limitations
change.

Hardware changes also need the checklist in
[docs/testing.md](docs/testing.md). Automated mocks are useful, but they do not
replace a physical Codex Micro test. Changes to MIC handling must be tested in
an active Claude Code composer over both USB-C and Bluetooth.

## Submit a pull request

In the pull request:

- explain what changes for users;
- list the checks you ran;
- call out private API assumptions or untested hardware paths;
- avoid unrelated formatting; and
- remove private paths, tokens, session IDs, and project names from examples.

Run `/humanizer` on every outward-facing change before asking for review. This
includes documentation, app dialogs, CLI output, errors, release notes, issue
templates, and pull request text. A maintainer must review these files before
merge.

Do not add automated authorship credit to commits, pull requests, source
comments, documentation, or release notes. Do not add authorship trailers for
automated tools. `npm run authorship:check` checks the working tree and commit
history for these markers.

By contributing, you agree that your contribution is licensed under the MIT
License.
