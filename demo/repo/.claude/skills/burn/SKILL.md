---
name: burn
description: The load demo for emerald. This session runs a busy loop for a minute on three workers so its sidebar row's load sparkline climbs past the amber line and falls back. Use when the user types /burn or asks for the load demo, the burn demo, or a session that pegs the CPU for a while.
argument-hint: "[seconds]"
---

# burn

You are the session whose row is being watched: for the seconds given your process tree burns three cores' worth of cpu and the sparkline at the right of your row's agent line climbs, turns amber past 200% of one core and comes back down when the workers stop. Nothing is written and no commit is made.

## Arguments

`$ARGUMENTS` is one optional number: the seconds to burn (default 60, at most 600).

## Steps

1. Run `node tools/burn.mjs <seconds>` as one plain `Bash` call in the foreground with `timeout` set to `(seconds + 30) * 1000`, never in the background: the point is that the load is yours while the turn runs.
2. End the turn with one line saying how long it burned.

## Keep in mind

- The sparkline reads the last five minutes and wants three samples (twelve seconds) before it draws a line, so a burn under fifteen seconds shows a dash and then a bump; sixty is what the row is drawn for.
- Hover the sparkline for the card: the figure, the memory, the peak over five minutes and the process names, `node` among them while it burns.
