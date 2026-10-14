# CLAUDE.md

This is the emerald demo repository. `orchard` is a made-up tool and the work done here is for show: the person at the keyboard is demonstrating the Emerald app to someone else, and what they want to see is sessions, subagents, commits and merges appearing in the app while it happens. Do what the demo skill says, in order, and keep the pace it names.

Rules for every demo:

- Do not ask clarifying questions and do not improve the plan. The skill is the plan.
- Keep each reply short: what was done and the commit hashes. The app shows the rest.
- Write only new files of your own (a module, its doc page, its test). Never edit `index.js`, `check.mjs`, `work.mjs`, this file or the skills; parallel agents must never touch the same file, so the merges stay clean.
- A module is `src/orchard/<name>.js` exporting `name` (the string) and `run(trees, options)` returning `{ name, treated: trees.length }` with one or two lines of made-up logic. Its doc page is `docs/features/<name>.md` (a heading, two sentences, an example). Its test is `tests/<name>.test.mjs` on `node:test`, importing the module and checking `name` and `run([{}, {}]).treated === 2`.
- Before every commit run `node tools/check.mjs`. Commit with `git add` by name, never `-A`, subject in the form `orchard: add <name>`, `docs: describe <name>`, `test: cover <name>`.
- The pacer is `node tools/work.mjs <seconds> "<what you pretend to do>"`; the label shows on the sidebar row, so make it read like work (`compiling the graft module`, `running the orchard suite`).
- Set a checkpoint at each phase change with `emmer set` (the `emmer-cli` skill has the form). The comment is what the row shows, so write the action first. When `EMERALD_SESSION_ID` is not set you are outside the app (a dry run); skip the checkpoints and carry on.
- Free feature names, pick from the top and skip any that already has a module: prune, graft, harvest, irrigate, mulch, pollinate, thin, stake, net, fertilise, scout, weed.
