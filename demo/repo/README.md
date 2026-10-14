# orchard

A small, made-up command line tool for tending an orchard. It exists so emerald has something to show: the skills under `.claude/skills` make Claude sessions do believable work here (modules, docs, tests, branches, forks and merges) so the sidebar, the Commits graph and the activity strip have something to draw for whoever is watching.

Nothing here is real. Every module under `src/orchard` is a stub of the same shape, `tools/check.mjs` is the "test suite" and `tools/work.mjs` prints a few lines and waits, which is what passes for compiling.

## The demo skills

Open a Claude session in this folder from emerald and type one of these.

| Skill | Shows | Arguments |
| --- | --- | --- |
| `/demo-solo` | one session working in a straight line: a checklist, checkpoints, three commits per feature, a background build that leaves the row `waiting`, optionally a question that leaves it at needs input, and optionally an eleven-minute silence that trips the stall alarm | `[count] [ask] [nobuild] [quiet]` |
| `/demo-batch` | a fake batch: worktrees, N forked subagents each committing on a branch of its own, merged back one by one, a changelog commit on `main` | `[agents] [pace]` |
| `/demo-supervise` | one session starting others with the `emmer` CLI, briefing them and waiting on them | `[workers]` |
| `/collide` | the conflict forecast: two branches that rewrite one paragraph of this file, a shell on each, held open with nothing merged so the Commits graph, the rows and the cards say the two will conflict | |
| `/demo-help` | prints this table as a cheat sheet, arguments explained, for the person at the keyboard | |

Run `npm run demo` in the emerald repository to put this folder back to one commit before the next audience.

## Layout

- `src/orchard/index.js` loads every module beside it; a module exports `name` and `run`.
- `docs/features/<name>.md` one page per module.
- `tests/<name>.test.mjs` a `node:test` file per module.
- `tools/check.mjs` loads every module and reports; `tools/work.mjs <seconds> <label>` is the pacer.

```
node tools/check.mjs
node --test "tests/*.test.mjs"
node tools/work.mjs 5 "warming up"
```
