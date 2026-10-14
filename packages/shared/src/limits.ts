// Every throughput knob in one place so the daemon, app and tests agree on them.
// Chosen in docs/PLAN.md, resolved question 7.
export const Limits = {
  // How long output is batched before it is pushed to attached clients.
  flushIntervalMs: 16,
  // Pending bytes that trigger a flush before the tick fires, so a big paste or
  // a large `cat` does not sit in memory waiting on the timer.
  earlyFlushBytes: 64 * 1024,
  // Raw bytes of scrollback kept per session and replayed on attach.
  ringBufferBytes: 2 * 1024 * 1024,
  // When a client's pipe write buffer grows past this the PTY is paused, and
  // resumed once the socket drains. Protects the daemon from a slow renderer.
  backpressureHighWaterBytes: 4 * 1024 * 1024,
  // A client with this much unread in its pipe write buffer is dropped (M9
  // fix 497): the pty pause above covers a session's output alone, and
  // every other push (session.changed on every load tick, pty.rate, the
  // replies) went on growing the daemon's heap for as long as a client
  // that had stopped reading stayed connected. Eight times the pause mark,
  // so a renderer that is merely slow is paused long before it is dropped.
  clientDropBytes: 32 * 1024 * 1024,
  // A pty.input longer than this many characters goes to the daemon in
  // pieces of at most this many (M9 fix 498): the daemon's framing drops a
  // connection whose line passes 16 MB of characters, and a paste of 8 MB
  // full of backslashes (a build log of Windows paths) doubled past it in
  // JSON, taking every pane through a reconnect and the paste with it.
  // Characters, the decoder's unit; a megabyte escapes to at most six.
  inputChunkChars: 1024 * 1024,
  // While a PTY writes, its 'activity' event fires at most this often.
  activityIntervalMs: 500,
  // The output rate behind the state meter (M41): bytes are counted per
  // window of this length and the last rateSamples windows travel with
  // each pty.rate push, one bar of the meter per sample. Four windows of
  // 250 ms is a second of history, which is what a glance reads.
  rateWindowMs: 250,
  rateSamples: 4,
  // A session whose terminal title changes publishes the change at most
  // this often; Claude Code swaps a spinner glyph in its title about once
  // a second while it works (M33).
  titlePublishMs: 500,
  // How long a stop waits on one session's emulator for its last frame
  // (M9 fix 159) before giving that frame up; the emulator answers in
  // milliseconds, and a stop must not hang on it.
  keepScreenTimeoutMs: 1500,
  // How long a change to a session waits for the next before
  // sessions.json is written (M9 fix 459): a hook storm wrote the whole
  // file, 9 ms at 964 KB, on every hook; the stop flushes it.
  saveCoalesceMs: 250,
  // How long a stopping daemon gives its pipe and hook servers to close
  // before it exits anyway (M9 fix 164): a client that keeps a socket open
  // must cost a moment, never the process.
  stopExitGraceMs: 2000,
  // How often the transcript tail looks at the file while a turn runs
  // (M47): one fstat per tick, and half a second is as fast as the row's
  // line needs to move. The live text is published on the same hold as
  // the title.
  transcriptPollMs: 500,
  // The longest partial line the transcript tail holds while it waits for
  // the newline (M9 fix 503), in decoded characters; past it the line is
  // dropped and skipped to its end, so the row keeps its previous live
  // text until the Stop rather than rebuild a huge string every tick.
  transcriptPartialMaxChars: 64 * 1024,
  // A `working` session with no hook event for this long is flagged stale.
  staleAfterMs: 10 * 60 * 1000,
  // A resumed shell that hosted a conversation gets claude --resume typed
  // at its first prompt (M48); a shell whose prompt never reports (one
  // started with args has no prompt wrapper) gets nothing after this long,
  // since a line typed blind lands somewhere nobody can see.
  resumeTypeTimeoutMs: 10_000,
  // How many commits a session keeps (M49); the oldest go first. The
  // Commits tab shows 80 commits, so this covers a long day with room.
  commitsKept: 200,
  // A shell command that ran at least this long marks its row as wanting
  // when it ends (M9 fix 196), ok or failed, the way a Claude turn's done
  // does; a shorter one never does, since a two-second ls pulsing is
  // noise. A minute is where a person has looked away.
  shellDoneAfterMs: 60 * 1000,
  // How many touched files a session keeps (M9 fix 198), one entry per
  // path with the latest write last; the oldest go first.
  touchedKept: 200,
  // The largest pty a client may ask for (M9 fix 504): the headless
  // terminal costs about 12 bytes a cell, so an unbounded pty.resize of
  // 40,000 by 20,000 asked for 10 GB and took the daemon down with every
  // pty. A size past it is clamped, never refused.
  maxPtyCols: 1000,
  maxPtyRows: 1000,
  // How many conversation spans a session keeps (M9 fix 509), the same
  // as its commits, so any span a kept commit falls in is still there;
  // the oldest go first.
  spansKept: 200,
  // How many tasks a session's list keeps (M9 fix 509); the lowest ids
  // go first. A real list is tens; this bounds a runaway one.
  tasksKept: 500,
  // How many members a session's team keeps (M9 fix 509); the oldest go
  // first, their commits folded into the session's so none is lost.
  teamKept: 200,
  // Length bounds on the free text a client sets (M9 fix 511), in
  // UTF-16 code units of the trimmed text, so a runaway script cannot
  // write a megabyte into a row's name or a store: a session's name (one
  // line), its checkpoint comment, a colour scheme's name and a saved
  // prompt's text.
  nameMaxChars: 200,
  commentMaxChars: 2000,
  schemeMaxChars: 64,
  promptTextMaxChars: 64 * 1024,
  // A known member's hook refreshes its parent's stale clock (M9 fix
  // 507): a member's burst of tool calls is one push a minute, not one
  // per call; the stall floor is ten minutes, so a minute's resolution
  // costs nothing.
  teamClockStepMs: 60 * 1000,
  // At most three installs of emerald's hooks into one settings file a
  // minute (M9 fix 606), past which, with the file rewritten since the
  // last, the banner offers no Install and says another program is
  // fighting over the file; a person running emmer hooks install by hand
  // is never refused, since a person at a terminal is not a loop.
  hookInstallsPerWindow: 3,
  hookInstallWindowMs: 60 * 1000,
} as const;
