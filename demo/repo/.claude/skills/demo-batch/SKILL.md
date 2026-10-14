---
name: demo-batch
description: The subagent emerald demo, a fake batch. The session plans N features, cuts a worktree and branch for each, forks N subagents that commit on their branches in parallel, then merges them back one by one with a changelog commit on main. Use when the user types /demo-batch or asks for the batch demo, the subagent demo, the fork demo, or parallel agents making commits and merging.
argument-hint: "[agents] [pace]"
---

# demo-batch

You are the tech lead of a fake batch. The person watching wants to see, in the Emerald app, your row grow an amber `✳N` while the agents are out, N lanes curve off your line on the Commits graph and curve back in at the merges, the peak on the activity strip read N+1, and your checkpoints change as the phases go by. Read `CLAUDE.md` for the shape of a module, its doc page and its test, the commit subjects and the feature list.

## Arguments

`$ARGUMENTS`: the first number is how many agents to fork (default 3, at most the free features left), the second is the pacer's seconds (default 6).

## Steps

1. Checkpoint: `emmer set --comment "batch demo: planning N features" --phase todo`. `TodoWrite` the phases (plan, worktrees, agents out, merge, changelog).
2. List `src/orchard` and take the first N free names from the list in `CLAUDE.md`.
3. Worktrees, one per feature, beside the repository in a folder named after it with `-wt` (for `C:\x\emerald-demo` that is `C:\x\emerald-demo-wt\<name>`), from the repository root:

   ```
   git worktree add ../<repo>-wt/<name> -b <name> main
   ```

4. Checkpoint in-progress: `batch demo: N agents out`. Fork all N agents in one message (`Agent` with `subagent_type: "fork"` when it is offered, else the default type; never pass `isolation`, the worktrees are the ones you cut in step 3 and the Agent tool's own would land under `.claude/worktrees` on branches of its own naming), each with this brief, filled in:

   ```
   You are the developer for the <name> feature of the orchard demo. Work only
   in the worktree <absolute worktree path> on branch <name>; prefix every
   command with `cd <absolute worktree path> &&` so it runs there, never in the
   repository itself. CLAUDE.md there has the shape of a module, a doc page and
   a test and the commit subjects. Three commits, in this order, each preceded
   by the pacer, and each a different size of work so the commit cards' prices
   spread: the first small, `node tools/work.mjs <pace> "compiling the <name>
   module"`, then write src/orchard/<name>.js straight off CLAUDE.md's shape,
   run node tools/check.mjs and commit `orchard: add <name>`; the second
   larger, `node tools/work.mjs <pace> "drafting the <name> page"`, then read
   src/orchard/index.js and two other modules' doc pages for the voice before
   writing docs/features/<name>.md, run node tools/check.mjs and commit
   `docs: describe <name>`; the third the largest, `node tools/work.mjs
   <pace> "running the orchard suite"`, then read two existing tests, write
   tests/<name>.test.mjs, run node --test "tests/*.test.mjs" and read its
   output whole, run node tools/check.mjs and commit `test: cover <name>`.
   git add each file by name, never -A. Touch no other file. Report the three
   hashes and subjects, oldest first, and nothing else.
   ```

5. When every agent has reported, checkpoint in-review: `batch demo: merging N branches`. Merge in the order the features were picked, from the repository root, one at a time:

   ```
   git merge --no-ff <name> -m "merge <name>"
   ```

   `--no-ff` is what gives the graph its merge commit and the lane its curve back in. After each merge remove its worktree and branch: `git worktree remove ../<repo>-wt/<name>` then `git branch -d <name>`.
6. Run `node tools/check.mjs` and `node --test "tests/*.test.mjs"` on main. Add one line to the top of the list in `docs/CHANGELOG.md` naming the features and commit it: `docs: changelog for <name>, <name> and <name>`. This is your own commit on your own straight line, above the merges.
7. Checkpoint done: `batch demo: N features merged`. End the turn with a short reply: the features, each agent's three hashes, the merge hashes and the changelog hash.

## Keep in mind

- One message forks them all; forking one at a time shows one agent at a time.
- Do not do any agent's work yourself, and do not commit in a worktree; the lanes belong to the agents.
- If an agent reports fewer than three commits, merge what it made; the demo is the shape, not the count.
