---
name: demo-help
description: Prints the demo cheat sheet for the person demonstrating emerald, the demo skills, their arguments and what the audience sees for each. Use when the user types /demo-help or asks what demos there are, what the demo skills do, or what an argument means.
---

# demo-help

Print the text below exactly as it is, in a code block so its layout holds, and nothing else: no preamble, no summary after it, no tool calls. It is a cheat sheet for the person at the keyboard, not a task.

```
emerald demo cheat sheet
======================

Open a Claude session in this folder from emerald and type a skill.
Every demo reads CLAUDE.md here: fake features for a made-up tool
called orchard, one new file per commit, a pacer that prints a line
a second so the work is slow enough to watch.

/demo-solo [count] [ask] [nobuild] [quiet] [pace N]
  count    features to add one after the other, three commits each
           (default 1)
  ask      end on a question, so the row goes to needs input and
           the chime sounds; leave it unanswered and the activity
           view's "waiting on you" grows, the debt the agents run up
           while they wait on the person
  nobuild  skip the background build at the end
  quiet    go silent for eleven minutes after the first commit, so
           the row reads quiet 10m, the alarm sounds, and a watchdog
           in another session (emmer wait <id> --for stale) fires
  pace N   seconds per pacer run (default 5)
  What the audience sees: one lane on the Commits graph, a checklist
  count on the row, the checkpoint changing (todo, in-progress,
  in-review, done), three paced commits per feature, then a 30 s
  background build that leaves the row at waiting with a ❯1 mark
  until it ends. With quiet: the row's working mark stops, the
  badge reads quiet 10m in grey and pulses, then the turn carries on.

----------------------------------------------------------------

/demo-batch [agents] [pace]
  agents   subagents to fork, one worktree and branch each
           (default 3, at most the free features left)
  pace     seconds per pacer run inside each agent, so how long
           the batch lasts (default 6; 2 is quick, 15 is slow)
  What the audience sees: your row with an amber ✳N while the
  agents are out, N lanes curving off your line and back in at the
  --no-ff merges, the peak on the activity strip reading N+1, and a
  changelog commit of your own on your straight line at the top.
  Hover a commit row for its card: under the hairline, what the
  stretch of work up to that commit cost, its tokens and the
  agent's time; the three commits of a feature differ in size, so
  the prices spread, and a merge prices the merge alone with the
  branch's run named in the note. Takes about four minutes at pace
  2 with two agents.

----------------------------------------------------------------

/demo-supervise [workers]
  workers  sessions to start (default 1, at most 4)
  What the audience sees: new rows appearing in the sidebar as this
  session runs emmer new, each worker running the solo demo in a
  pane of its own, this row at working while it waits with emerald
  wait, then one line per worker with its commits. The workers stay
  open for you to look at and close.

----------------------------------------------------------------

/collide
  What the audience sees: two worktree branches that rewrite the
  same paragraph of README.md, a shell row for each, two agents out
  and back, then a minute held open with nothing merged: a dashed
  run of chevrons between the two branches' newest commits on the
  Commits graph with a dotted ring on each, the chevron mark and a 1
  at the end of both shell rows' agent lines, `conflicts with
  collide-b on README.md` on each lane's card, and the same reading
  from emmer conflicts. The branches stay for you to merge or drop.

----------------------------------------------------------------

/burn [seconds]
  seconds  how long to burn (default 60)
  What the audience sees: the load sparkline at the right of this
  row's agent line climbs as three workers spin, turns amber past
  200% of one core with its figure, and falls back when they stop;
  hover it for the memory, the peak and the process names.

----------------------------------------------------------------

Between audiences: npm run demo in the emerald repository puts this
folder back to one commit (worktrees and branches gone). Rows of
finished demo sessions stay in the sidebar until you remove them.
Feature names, used in order: prune, graft, harvest, irrigate,
mulch, pollinate, thin, stake, net, fertilise, scout, weed.
```
