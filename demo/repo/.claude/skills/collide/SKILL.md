---
name: collide
description: The conflict forecast demo for emerald. Two worktrees on branches collide-a and collide-b, a shell session sitting in each so the branches are lanes, two forked subagents that rewrite the same paragraph of README.md and commit, then a minute's wait with nothing merged so the forecast lights on the Commits graph, the sidebar rows and the lane cards, and in `emmer conflicts`. Use when the user types /collide or asks for the conflict demo, the merge-conflict forecast demo, or two branches that will not merge.
---

# collide

You are the session whose lanes are being watched: two branches that rewrite the same lines, held open without a merge, so the person sees the conflict forecast light up while the agents that wrote the code are still around. Nothing is merged and nothing on `main` moves.

## Arguments

None.

## Steps

1. Checkpoint: `emmer set --comment "collide demo: cutting two branches" --phase todo`.
2. Two worktrees beside the repository, from the repository root, both from `main` (for `C:\x\emerald-demo` that is `C:\x\emerald-demo-wt\collide-a` and `collide-b`):

   ```
   git worktree add ../<repo>-wt/collide-a -b collide-a main
   git worktree add ../<repo>-wt/collide-b -b collide-b main
   ```

3. A shell session in each, so each branch has a live session on it (the forecast pairs sessions, not folders; a member's worktree alone is not a lane it reads):

   ```
   emmer shell <absolute path of collide-a> --name collide-a
   emmer shell <absolute path of collide-b> --name collide-b
   ```

4. Checkpoint in-progress: `collide demo: two agents rewriting one paragraph`. Fork both agents in one message (`Agent` with `subagent_type: "fork"` when it is offered, else the default type; never pass `isolation`), each with this brief, filled in:

   ```
   You are the developer on branch <name> of the orchard demo. Work only in the
   worktree <absolute worktree path>; prefix every command with `cd <absolute
   worktree path> &&`. Rewrite the second paragraph of README.md (the one that
   begins "Nothing here is real") in your own words, three or four sentences
   that say the same thing, keeping every other line of the file as it is.
   Then `git add README.md` and commit `docs: reword the README (<name>)`.
   Touch no other file. Report the commit's hash and subject and nothing else.
   ```

5. When both have reported, checkpoint in-review: `collide demo: forecast up, nothing merged`. Run `emmer conflicts` and put its lines in your reply. Then wait a minute without merging, `node tools/work.mjs 60 "holding both branches open"`, and say when the minute is up: by then the Commits graph shows a dashed run of chevrons between the two branches' newest commits with a dotted ring on each, the two shell rows in the sidebar carry the chevron mark and a `1` at the end of their agent lines, and each lane's card reads `conflicts with collide-b on README.md` under its branch.
6. Checkpoint done: `collide demo: two branches held open`. End the turn with the two hashes, the `emmer conflicts` lines and one line saying the branches are left for the person to merge or drop (`git worktree remove ../<repo>-wt/collide-a`, `git branch -D collide-a`, and the same for b; `npm run demo` in the emerald repository does it too).

## Keep in mind

- Never merge either branch; the point is the forecast, which drops the moment a merge would apply clean.
- The two shells are what the forecast reads; without them the two branches are member lanes of this session and no pair is drawn.
- The agents rewrite the same paragraph on purpose. A brief that lets one of them rewrite a different paragraph makes a clean merge and an empty demo.
