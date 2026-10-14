---
name: emmer-cli
description: Use the `emmer` CLI to see, start, drive and wait on the other Claude Code and shell sessions in the emerald desktop app, and to write a checkpoint on your own session so the person watching the sidebar knows where you are. Use when the user says "emerald", "the other session", "hand this to another session", "wait for that session to finish", "what is the other Claude doing", "set a checkpoint", or when you are running inside emerald (EMERALD_SESSION_ID is set) and reach a phase change worth reporting.
---

# emmer CLI

emerald is a desktop app that runs several Claude Code and shell sessions side by side and keeps them running in a daemon (`emmerd`) that survives the window. `emmer` is its command line. Every session in the app has an id; a command takes the id, the name, or a unique prefix of the id.

You are inside emerald when `EMERALD_SESSION_ID` is set; that is your own session's id. Use `emmer` when the app's sessions are the thing that matters: another session in the app, a handoff, waiting on a session. Plain shell tools are right for everything else.

`emmer help <command>` prints a command's synopsis; `emmer help` lists them all. Exit codes: 0 done, 1 failure, 2 `wait` or `prompt` timed out, 3 `prompt` sent the text and the session never started working, 64 bad usage.

## See what is there

```
emmer ls --json
```

The sidebar's rows: grouped by folder, most urgent first, exited last. Each row has `id`, `name`, `kind` (`claude` or `shell`), `cwd`, `branch`, `state` (`starting`, `idle`, `working`, `needs-input`, `done`, `errored`, `exited`), `label` (the badge words, such as `needs input: permission`, or `quiet 12m` on a working session that has stalled), `stale` (true when the daemon has flagged that stall), `inStateMs`, `lastPrompt`, `lastReply`, `model`, `contextPercent`, `comment` and `phase`. Prefer `--json`; the text form is for people.

## Start a session

```
emmer new <dir> [--name x] [--json] [-- --model opus]
emmer shell <dir> [--name x] [--json]
```

A Claude session or a plain shell in a folder, listed in the sidebar at once. Arguments after `--` go to `claude` (or to PowerShell). The reply carries the new id.

## Type into a session

```
emmer send <session> <text...> --enter
emmer send <session> --interrupt
```

`--enter` presses Enter after the text; a Claude session gets a short pause first so the text is not taken for a paste. `--interrupt` sends Ctrl+C. Send a prompt to a Claude session only when it is `idle` or `done`; a `working` session queues it.

## Read what a session wrote

```
emmer read <session> --screen
emmer read <session> --cursor <n> --json
emmer read <session> --lines 40
```

Two views. `--screen` is what is on the terminal right now, as a person sees it; use it whenever the session runs a TUI (Claude Code is one), since the stream form of a TUI comes back as stacked repaints. The stream form (no `--screen`) is what was written over time, escapes stripped, last N lines with `--lines`; use `--cursor <n>` with the `nextCursor` from an earlier `--json` read to get only what came after it. Read before you send, then read with the cursor after you wait, so you get just the reply.

## Send a prompt and wait for the reply

```
emmer prompt <session> "the prompt" --timeout 900000
emmer prompt <session> "the prompt" --json
emmer prompt <session> tests --saved
```

`send --enter` and `wait` in one: types the text, presses Enter, waits for the session to go `working` and then for the turn to end, and prints the first line of the reply (`--json` has the whole session, its `state` and the `reply`). Two gates. A session that `needs-input` is refused (exit 1) since the text would land as the answer to whatever it is asking; read the screen, answer it with `send`, or pass `--force` to send anyway. A session that does not go `working` within five seconds is `stalled` (exit 3): the text is most likely sitting in its input box, or it is not a Claude session; `read --screen` shows which. A turn that ends in a question prints `needs input: ...` with exit 0; `--timeout` (milliseconds) is exit 2 as `wait`'s. Prefer it over `send` plus `wait` whenever you want the answer. `--saved` takes the text from a saved prompt by name: `emmer prompts ls` lists them, `emmer prompts add <name> <text>` and `emmer prompts rm <name>` keep the list, which is the daemon's, so the app's prompt box (Send a prompt on a row's menu) cycles the same ones.

## Wait for a session

```
emmer wait <session> --for done --timeout 600000
emmer wait <session> --for needs-input --timeout 60000
emmer wait <session> --for tui-idle --timeout 30000
emmer wait <session> --for stale --timeout 3600000
emmer wait <session> --for exit
```

Blocks until the session reaches the state, exit 2 on timeout (milliseconds). `done` is a Claude session that finished a turn; `needs-input` is one waiting for a person (a permission prompt, a question); `tui-idle` is any session whose output has been quiet for a moment, which works on a plain shell too; `stale` is a working session that has stopped posting hooks for longer than its own turn's pace allows (three times the median gap between its tool calls, never under ten minutes), the row reading `quiet 12m`; `exit` is the process ending. Wait, then read, then decide; do not poll with `read` in a loop.

## Watch a session for a stall

A session you started or were asked to supervise can stop making progress while its row still says working: an agent that finished its edit and never reported, a tool call that hangs, a process that died under it. The daemon flags it `quiet` after the wait above; you are the first to act, before the app's own alarm reaches a person. Run this as a watchdog, in order, and stop at the first step that moves it:

```
emmer wait <session> --for stale --timeout 3600000
emmer explain <session>
emmer read <session> --screen
emmer send <session> "Are you still working on this? Reply with where you are." --enter
emmer wait <session> --for done --timeout 300000
emmer kill <session>
```

1. `wait --for stale` is the trigger, with a `--timeout` for however long the work should take at most; exit 2 means the session never stalled in that time and is still working, which is fine. Do not poll `ls` in a loop for it.
2. `explain` says how long the silence is and which threshold it tripped, and its last hook events show what the session was doing when it went quiet (a `PreToolUse` with no `PostToolUse` after it is a tool call still running, or one that hung).
3. `read --screen` shows what the session has on its terminal: a permission prompt the hooks missed, an error, a shell prompt where Claude used to be, or a long command still printing (which is not a stall; leave it).
4. Nudge it with `send --enter` and give it a few minutes with `wait --for done`; a session at a prompt answers, a session mid-turn takes the line as its next prompt when the turn ends.
5. A session that does not answer is stuck: `kill` it if you started it, else say so to the person and leave it. Its work so far is in its folder and its record can be resumed.

Say what you found in your reply or in a checkpoint (`emmer set`), so the person sees why a row went from quiet to gone.

## When a state looks wrong

```
emmer explain <session>
emmer explain <session> --lines 50 --json
```

Why the row says what it says: the state and since when, the sentence behind the badge, the last prompt and reply, then the session's last hook events from `~/.emerald/logs/hooks.jsonl`, oldest first, each with the time, the event, whether it was applied (`ignored-agent` is a subagent's, `ignored-foreign` a nested `claude`'s, `unknown-session` a hook from a session emmerd does not know) and the state change it made. Run it before deciding a session is stuck, and when `wait` returns something you did not expect: a `working` that never ends with no events after the prompt means the hooks are not posting (`emmer hooks status`, with `--test` to send one event through the installed hook); a `done` right after a prompt with a foreign `Stop` between means a nested `claude -p` answered, not the session. It reads the log directly, so it works with emmerd down.

## Hand work to another session

Start a Claude session in the right folder, wait for it to be ready, then either `send` the brief and stop (a handoff) or `prompt` it and get the reply back (supervising).

```
emmer new C:\path\to\repo --name fix-login --json
emmer wait fix-login --for idle --timeout 60000
emmer prompt fix-login "Fix the login redirect loop; the failing test is in auth.test.ts" --timeout 900000
emmer read fix-login --screen
```

`prompt` exits 1 if the session is asking something, 3 if the text never took, 2 on the timeout; `emmer explain fix-login` says why in each case.

`emmer focus <session>` shows a session in the focused pane for the person watching, or switches to the layout tab and pane already showing it (`ls --json` names that tab as `tab`). `emmer kill|resume|rm <session>` end a session, start it again under the same id (a Claude session resumes its conversation), or forget an exited one.

`emmer open <path>` opens a file in the window as a pinned tab for the person watching (`--pane` puts it in a pane beside the focused one), so a report or a diff you wrote can be put in front of them without a paste; `emmer open localhost:3000` (or any http or https URL) puts that page in a browser pane beside the focused one, so a dev server you started can sit in front of the person; exit 69 means no window is open, the same for `emmer update`; exit 75 means the window is there and did not answer within 3 s (a reload, say), and the open may still land.

`emmer conflicts` is the conflict forecast: which live sessions' branches would conflict on a merge and on which files, and how far each branch is ahead of and behind the default. Read it before setting a merge order or handing a file's ownership to one lane; `--json` gives `{ conflicts, base }`, `--folder <path>` one repository's block.

## Checkpoints: say where you are

With no session named, `emmer set --comment "..."` writes on the session it runs in, off `EMERALD_SESSION_ID`, the same in every shell; outside emerald it says so and asks for a session. Name one to set another session's row instead, as in the last line below. A comment is at most 2000 characters; the daemon refuses a longer one.

```
emmer set --comment "reproduced the bug; testing a fix" --phase in-progress
emmer set --comment "blocked: needs the staging credentials"
emmer set --comment "fix is in, suite green" --phase in-review
emmer set --clear-comment --clear-phase
emmer set beta --comment "handed off; watching for pickup" --phase in-review
```

The comment shows on your sidebar row in place of the last turn, with a pin, until you replace or clear it; the phase (`todo`, `in-progress`, `in-review`, `done`) sits beside the kind. It is for the person glancing at the sidebar, so write the action first: what happened, where, what is next. Set one when you confirm or refute a hypothesis, when you hit a blocker, when you move from investigating to fixing to verifying, and when you finish. Keep it to one line. `emmer ls --json` shows the current one, so read before you write if someone else may have set it.

## Install a newer build

```
emmer update
emmer update --check
emmer update --download
emmer update --install
```

The app checks its update feed at launch and every four hours and shows a badge in its title row when a newer build is there; `emmer update` prints where that stands (`0.1.240 installed, 0.1.258 available`), and the flags click the badge from here: `--check` asks the feed now, `--download` fetches the build and stops at `ready`, `--install` does both and then the restart. The restart closes the window and stops the daemon, so every session in the app, this one included, ends with it; the screens are kept and every pane comes back through Resume once the new build opens, and this conversation can be resumed on its row. Say so before you run `--install`, and only run it when asked. A box with no window open answers `no window open; open the Emerald app`, exit 69.

## Rules

- `--json` for anything you parse; the text forms may change.
- Read the screen for a TUI, the stream for a shell command's output.
- Wait on a state, do not poll.
- Never `kill` a session you did not start unless asked.
- If `emmer` says emmerd is not running, the app is closed; `emmer daemon start` starts the daemon on its own, but say so rather than doing it silently.
