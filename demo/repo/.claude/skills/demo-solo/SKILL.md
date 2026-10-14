---
name: demo-solo
description: The single-session emerald demo. One Claude session adds one or more orchard features in a straight line, three commits each, with a checklist, checkpoints, paced fake work, a background build that leaves the row waiting, optionally a closing question that leaves it at needs input, and optionally a long silence mid-turn that trips the stall alarm. Use when the user types /demo-solo or asks for the solo demo, the straight-line demo, or a session that just makes commits.
argument-hint: "[count] [ask] [nobuild] [quiet] [pace N]"
---

# demo-solo

You are the whole show: one session, one lane on the Commits graph, commits landing one after another while someone watches the sidebar. Read `CLAUDE.md` for the shape of a module, its doc page and its test, the commit subjects and the feature list.

## Arguments

`$ARGUMENTS` is a few words, any order, all optional:

- a number: how many features to add, one after the other (default 1; each is three commits)
- `ask`: end the turn with a question through `AskUserQuestion` (which feature next, two or three options), so the sidebar row goes to needs input and the chime sounds; the person answers it or presses Escape
- `nobuild`: skip the background build at the end
- `quiet`: go silent mid-turn for eleven minutes (one long `Bash` sleep in the foreground, after the first feature's module commit), so the row goes to `quiet 10m` in the sidebar, the alarm sounds and a watchdog (`emmer wait --for stale`) has something to catch; the turn carries on afterwards
- `pace N`: seconds per pacer run (default 5)

## Steps

1. Checkpoint: `emmer set --comment "solo demo: picking a feature" --phase todo`.
2. `TodoWrite` the steps below for the first feature (pick, module, check and commit, doc and commit, test and commit, build) so the row shows a checklist count; keep it current as you go.
3. List `src/orchard` and pick the first free name from the list in `CLAUDE.md`.
4. Checkpoint in-progress: `solo demo: adding <name>`.
5. `node tools/work.mjs <pace> "reading the orchard modules"`, then write `src/orchard/<name>.js`, run `node tools/check.mjs`, commit `orchard: add <name>` (add the one file by name).
   With `quiet`, once, after this commit: checkpoint `solo demo: going quiet for 11 minutes`, then run `node -e "setTimeout(() => {}, 660000)"` as one plain `Bash` call in the foreground with `timeout` 720000 (not in the background: the point is that nothing posts a hook while it runs; the call's own `PreToolUse` is the last line the daemon sees until it ends). Then carry on with step 6 as if nothing happened.
6. `node tools/work.mjs <pace> "drafting the <name> page"`, then write `docs/features/<name>.md`, commit `docs: describe <name>`.
7. `node tools/work.mjs <pace> "running the orchard suite"`, then write `tests/<name>.test.mjs`, run `node --test "tests/*.test.mjs"`, commit `test: cover <name>`.
8. More features asked for: checkpoint `solo demo: adding <next>` and repeat from step 5 with the next free name.
9. Unless `nobuild`: start `node tools/work.mjs 30 "long build of the orchard"` with `run_in_background: true` and go straight to step 10 without waiting for it. That leaves the row at `waiting` with a `❯1` mark after your turn ends; when its task notification lands, reply with one line saying the build finished and set the phase to `done`.
10. Checkpoint: `solo demo: <count> feature(s) in, <n> commits` with `--phase in-review` (or `done` under `nobuild`).
11. Unless `ask`: end the turn with a short reply, the commit hashes and subjects one per line. With `ask`: end the turn with the question instead, and after the answer reply with one line and set the phase to `done`.

## Keep in mind

- Commit from the repository root; you have no worktree.
- Never wait on the background build with a loop or a sleep; ending the turn is the point.
- Three commits per feature, no more, so the graph stays readable beside the other demos.
