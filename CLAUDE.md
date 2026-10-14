# CLAUDE.md

Notes for a Claude Code session working in this repository. `README.md` is the page for a person who installs Emerald; `docs/HANDBOOK.md` says what every part does, how it is built and how it is tested, and lists the acceptance scripts.

## Build and test

- Node 24 or newer, on Windows. `npm ci`, then `npm run build` (`tsc -b`) compiles shared, daemon and cli; `npm test` builds, then runs the `node:test` suites. The app builds separately with `npm run build -w @emerald/app`, after the root build (vite cannot resolve `@emerald/shared` until its `dist` exists) and before any `verify:*` script.
- `node --test` needs `--test-force-exit` once node-pty has spawned anything; its conout worker keeps the event loop alive.
- The `verify:*` scripts in `packages/app/scripts` and `packages/cli/scripts` are the acceptance tests (the handbook's Acceptance scripts section lists them). Run them one at a time.
- A change to what the daemon does on the pipe bumps `DAEMON_FEATURE_LEVEL` in `packages/shared/src/protocol.ts`, so an app on an older daemon shows the banner and offers a restart.

## Before running a verify script

Set `EMERALD_HOME` and `EMERALD_PIPE` to a private pair first whenever your own Emerald may be open:

    $env:EMERALD_HOME = "$env:TEMP\emerald-verify-home"; $env:EMERALD_PIPE = '\\.\pipe\emmerd-verify'

Without them a script's fresh-state step deletes `~/.emerald/daemon.json` and its clean-up stops your own daemon. The app, the daemon and the scripts all honour both variables. The harness window opens off screen and without focus; never bring it to the front.

## Style

No em dashes. Boring code over clever code. Comment the why, not the what. Commit messages and docs are plain prose in the same voice as the handbook.

A CSS animation that can run on more than one element at once, or on anything bigger than a glyph, animates `transform` or `opacity` only, and puts the moving part on a pseudo-element when the element itself must stay put. Those two properties run on the compositor thread at any count; every other property is a main-thread repaint of the element's whole box on every frame.
