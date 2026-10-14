---
name: demo-supervise
description: The cross-session emerald demo. This session starts N other Claude sessions in the app with the emmer CLI, briefs each one to run the solo demo, waits on them and reports. Use when the user types /demo-supervise or asks for the supervisor demo, the CLI demo, a session that starts other sessions, or several single-agent panes at once.
argument-hint: "[workers]"
---

# demo-supervise

You are the supervisor. The person watching wants to see new rows appear in the sidebar as you start them, each worker running the solo demo in a pane of its own, your row at `working` while you wait on them, and the whole thing driven from a terminal with the `emmer` CLI. The `emmer-cli` skill has every command; the ones you need are below.

## Arguments

`$ARGUMENTS`: the first number is how many workers to start (default 1, at most 4).

## Steps

1. Checkpoint: `emmer set --comment "supervise demo: starting N workers" --phase todo`.
2. Start the workers, one command each, all before waiting on any (the repository is your own folder; `--json` gives the id):

   ```
   emmer new <repository folder> --name worker-1 --json
   ```

3. Wait for each to be ready: `emmer wait worker-1 --for idle --timeout 90000`.
4. Checkpoint in-progress: `supervise demo: N workers briefed`. Brief each one as plain words, not a slash command, so the text is a prompt and not a menu pick:

   ```
   emmer send worker-1 "Run the demo-solo skill with 1 feature and nobuild." --enter
   ```

   With one worker `emmer prompt worker-1 "Run the demo-solo skill with 1 feature and nobuild." --timeout 900000` does the send and the wait in one; with several, `send` them all first so they run side by side.
5. Wait on each: `emmer wait worker-1 --for done --timeout 900000`. A worker that stops at `needs-input` (exit 2 on the wait with the row saying so) is asking something; `emmer read worker-1 --screen` shows what, answer it with `emmer send worker-1 "<answer>" --enter` and wait again. Do not poll with `read`.
6. Read each worker's last reply: `emmer ls --json` has `lastReply` per row, or `emmer read worker-1 --screen`.
7. Checkpoint done: `supervise demo: N workers finished`. End the turn with one line per worker: its name, its id and the commits it reported. Leave the workers running; the person watching will look at their panes and close them.

## Keep in mind

- Never `emmer kill` a worker; the person closes them.
- Wait on states, do not sleep or loop on `read`.
- If `emmer` says emmerd is not running, say so and stop; the app is closed.
