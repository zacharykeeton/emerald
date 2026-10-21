import type { Layout, SingleTree } from './layout.ts';
import type { SavedPrompt } from './prompts.ts';
import type { FolderLabel } from './folders.ts';
import type { ActivitySession, ActivityTotals, CappedSpan } from './activity.ts';
import type { LoadSample, SessionInfo, SessionKind, SessionPhase, ShellId, ShellOption } from './session.ts';
import type { UpdateState } from './update.ts';
import type { ConflictReport } from './conflicts.ts';
import type { BrowserAnswer, BrowserFilter, BrowserVerb } from './browser-drive.ts';

export const PROTOCOL_VERSION = 1;

// Bumped whenever a new daemon build changes what a session reports, so a
// window can tell that the daemon it found (which survives an app upgrade
// on purpose) is an older build and offer a restart. The protocol version
// above stays put so that daemon still answers hello.
//   1: through M9 fix 7
//   2: fix 8, branch and the last turn on SessionInfo
//   3: fix 14, shells started by the daemon report their folder
//   4: M16, model and contextPercent on SessionInfo from the status line
//   5: M17, pty.screen, session.read since, the activity topic
//   6: M18, comment and phase on SessionInfo, session.set
//   7: M24, color on SessionInfo
//   8: M29, color on session.set
//   9: M30, the waiting state
//  10: M33, title on SessionInfo from the terminal title
//  11: M36, layout tabs: layout.get and layout.changed carry tabs
//  12: M9 fix 39, model and contextPercent cleared by a shell's SessionEnd and by a resume
//  13: M9 fix 52, waitingOn on SessionInfo, the tasks a waiting session waits on
//  14: M41, the rate topic and pty.rate, the output rate behind the state meter
//  15: M42, contextWindow on SessionInfo, the status line's token counts
//  16: M9 fix 60, groupCwd on SessionInfo, the folder the sidebar groups under
//  17: M46, team on SessionInfo, the subagents and background shells a session sent out
//  18: M47, transcriptPath and liveReply on SessionInfo, the row's agent line off the transcript
//  19: M48, conversation and shellCwd on SessionInfo, a resume picking the conversation up in its folder
//  20: M9 fix 79, liveTool on SessionInfo, the tool call as a verb phrase on the agent line
//  21: M49, commits on SessionInfo, the commits a session made for the Commits tab's lanes
//  22: M56, prompts.list and prompts.set, the saved prompts the box and emmer prompt --saved cycle
//  23: M52, view on a layout pane, a commits view pinned to a folder in place of a session
//  24: M54, activity.spans, the stretches each session spent working, off hooks.jsonl
//  25: M57 and M58, removed sessions kept behind session.list { removed }, the activity log naming them, and commits with an owner from the trailer
//  26: M61, cwd, branch and commits on a team member, a subagent's worktree branch and what it committed there
//  27: M62, agent rows in activity.spans, a subagent's span under its parent with parentId and agentId
//  28: M9 fix 109, agent-permission as a needs-input reason and permission on a team member, a subagent's permission prompt released by its own tool hook
//  29: M65, activity on a team member, the tool phrase of a subagent's latest call
//  30: M66, strip on a commits view, the day's strip above the commits scoped to the folder, all or the pane's tab
//  31: M9 fix 117, startHead on SessionInfo, the commit HEAD was at in the start folder when the session spawned
//  32: M69, an activity view on a layout pane, one window of the activity tab in place of a session
//  33: M9 fix 138, agent on a session's commit, a subagent's commits folded into the record when the member leaves the team
//  34: M9 fix 143, tokens on SessionInfo, the running sum of the status line's counts since the process started
//  35: M73, lastPromptAt and lastReplyAt on SessionInfo, when the last turn's prompt and reply landed
//  36: M9 fix 148, startHead read again where Claude started when SessionStart moves a shell's group folder
//  37: M9 fix 153, tasks on SessionInfo, Claude's own checklist off its TaskCreate, TaskUpdate and TodoWrite calls
//  38: M9 fix 158, liveVerb on SessionInfo, Claude Code's spinner word off the PTY for an empty agent line
//  38: M9 fix 159, pty.screen answers a kept frame for a session whose PTY is gone, and daemon.stop keeps every live one before exiting
//  38: M9 fix 154, costUsd on SessionInfo, Claude Code's own dollars so far off the status line (the batch of fixes 154 to 163 shares the level)
//  38: M9 fix 162, rows on a commits view, the pane's graph as lines alone (the batch of fixes 154 to 163 and M74 shares the level)
//  39: M9 fix 178, graph, scope, folder and layers on a pane's view record, the state a pane opened from the rail keeps; fix 179, chrome on the record
//  39: M9 fix 180, a file view on a pane's record, the kind a file dropped on a pane lands as
//  39: M9 fix 185, spans on SessionInfo, the conversations a session hosted, a /clear closing one and opening the next with its own start commit
//  39: M9 fix 194, folders.list, folders.set and folders.changed, the person's own label on a folder group (the batch of fixes 178 to 194 shares the level)
//  40: M9 fix 196, command on SessionInfo, a shell's last command off the OSC 133 marks its prompt writes, a long one's end at done or errored
//  41: M9 fix 198, touched on SessionInfo, the files the session's own and its members' Edit, Write, MultiEdit and NotebookEdit calls wrote (40 is fix 196's shell command marks)
//  42: M9 fix 215, cwd and groupCwd on ActivitySession, a removed session's folders so the activity view's folder scope keeps its row (the batch of fixes 211 to 227 shares the level)
//  42: M9 fix 217, requests on ActivitySession and requestsSince on activity.spans, each track's request points off its status lines for the window's tokens and cost
//  43: M9 fix 213, scale on a commits view's graph record, the Ctrl+wheel zoom a pane keeps (42 is the fixes 215 to 218 batch's)
//  44: M9 fix 231, debt on ActivitySession, the asked and unread stretches a session spent waiting on the person, beside its working spans
//  45: M9 fix 233, outside on ActivitySession and the unhosted hook post, a Claude emerald did not start credited on the activity view (44 is fix 231's span kinds)
//  46: M9 fix 244, scheme on SessionInfo and session.set, the terminal colour scheme one session wears in place of the window's
//  47: M9 fix 245, presence.away and presence.back, the app's lock, sleep and idle edges written as away lines, and awayMs on ActivitySession, the waiting docked by them (46 is fix 244's scheme on the record)
//  48: M9 fix 250, panes as an activity view's scope on its pane record, the validator taking the third value (46 is fix 244's scheme, 47 fix 245's presence)
//  49: M9 fix 261, here as an activity view's scope on its pane record, the sessions on the panes of the tab holding the pane (48 is fix 250's panes)
//  49: M9 fix 271, update.report, update.state and update.act with the app topic's update.requested push, the badge's clicks relayed from emmer update
//  50: M9 fix 285, usage.capped and usage.freed, the app's usage window edges written as capped lines, capped on activity.spans beside the sessions and cappedMs on ActivitySession, the waiting docked by the bands
//  50: M9 fix 286, remotes on a commits view's graph record, the chip that puts the remote branches on the graph (the batch of fixes 274 to 287 shares the level)
//  51: M9 fix 300, load and loadNames on SessionInfo, the process tree's cpu and memory samples the daemon's load sampler pushes every tick (50 is fix 285's capped and fix 286's remotes)
//  52: M9 fix 320, conflicts.get and conflicts.changed, the merge-tree forecast between live sessions' branches and each branch's base against the default
//  53: M9 fix 341, file.open with the app topic's file.open.requested push, a file opened in the window from emmer open
//  54: M9 fix 360, the daemon reports a shell's /exit without a hook: the prompt's D ending the command whose C opened the open conversation span unbinds the shell
//  55: M9 fix 375, scheme on file.open and its push with file.open.done, the window's answer held for the CLI (emmer open --scheme and --clear-scheme; fix 376's beside shares the level)
//  56: M9 fix 394, agentId on SessionTask, a subagent's own TaskCreate and TaskUpdate read off its hook's agent_id, so the lid can draw a strip per member's checklist
//  57: M9 fix 494, daemonStartedAt on the hello, so a client kills only the daemon it met
//  57: M9 fix 495, home on the hello, and the pipe named per user and per home
//  58: M9 fix 580, the unhosted hook post names its conversation in the body's session_id alone, so claude-hook.cmd posts it with curl and no node
//  58: M9 fix 582, featureLevel on the app's hello, and answered on file.open's reply: every open to windows at 58 waits for file.open.done
//  59: M9 fix 607, historyFrom on activity.spans, the earliest line the daemon's activity log holds, so the view and emmer activity say how far back the history goes
//  59: M9 fix 606, hooks.test and the Test hook event, answered and applied to no session, so emmer hooks status --test proves the hook script, curl, the sink and the pipe in one read
//  60: M9 fix 612, token on the hello, daemon.json's pipeToken, and a hello without it refused and closed
//  61: M9 fix 624, shells on the hello, the shells the daemon found at its start, and shell on session.spawn and SessionInfo, the shell a resume starts again
//  62: M9 fix 649, a cmd row's prompt with Claude bound and a hook landed unbinds the shell, as fix 360's D does for a shell that writes C
//  62: M9 fix 659, the browser view, { kind: 'browser', url } in a layout, and url on file.open and its push, a page opened in a pane from emmer open
//  63: M9 fix 672, browser.run with its browser.requested push and browser.done, a page in a browser pane driven from emmer browser
//  63: M9 fix 673, profile on a browser view, and upload, events and resume on browser.run
//  64: M9 fix 703, sessions.load on the sessions topic, one push per load tick with each sampled session's newest sample and names, to app windows at level 64; an older window gets session.changed per session as before, a CLI none
//  65: M9 fix 766, usage on an activity view's record, false while its usage windows row is hidden, absent while shown
//  65: M9 fix 739, usage.limits on the app topic, the rate limits a hosted session's mod measured, to app windows at level 65
//  65: M9 fix 738, the mod's Spinner, TurnStart and TurnComplete events on the hook sink, an aborted turn putting the row at idle
//  65: M9 fix 741, session.submit and mod.channel with its mod.submit push, a prompt to a Claude session whose emerald mod opened its channel submitted by the mod rather than typed
//  65: M9 fix 742, askedFor on SessionInfo, the tool and its input from the mod's ToolAsk post at a permission ask
//  66: M9 fix 769, transcript.row on the sessions topic, each row of the conversation a hosted session's emerald mod kept (its Append post on the hook sink), to app windows at level 66
//  66: M9 fix 779, ghost on the pty.screen reply, the dim run on Claude Code's prompt row (a suggested prompt, a placeholder or an inline completion), null when there is none
//  66: M9 fix 772, cache on SessionInfo, the prompt cache's TTL, expiry and warmth off the status line's prompt_cache, for the idle compaction's countdown
//  66: M9 fix 773, keepWhole on SessionInfo and session.set, and the hook sink's POST /compact, which the emerald mod asks before a compaction and which skips an idle one of a session marked to keep whole
//  66: M9 fixes 774 to 776, a top-level TurnComplete ending a turn that had no Stop, the mod's ToolRunning moving an answered permission ask back to working, and session.submit held up to 3 s for a hosted Claude's mod channel
//  66: M9 fix 781, submitId on the mod.submit push and the mod's ModSubmit post on the hook sink, session.submit answering typed for a prompt the engine did not enter (a person's Stop standing)
//  67: M9 fix 799, effort on SessionInfo, the session's effort level off the status line's effort.level, null for a model with no effort setting
//  67: M9 fix 800, effort on the activity reply's request points, off the same status line, now kept in hooks.jsonl
//  67: M9 fixes 812 and 813, compactFrom on SessionInfo, the state an idle compaction found, which its PostCompact puts the row back to, and endReason, the reason a Claude session's SessionEnd gave, by which an /exit drops its pane to a shell
//  67: M9 fix 808, needs-input with the reason trust on SessionInfo, a Claude session at its folder's trust dialog read off its screen while starting
//  67: M9 fix 802, needsInputReason question for an AskUserQuestion's PermissionRequest, which a permission_prompt Notification no longer turns back to permission
//  68: M9 fix 830, turn on SessionInfo, the open turn's id off the emerald mod's TurnStart and whether its Stop has landed, by which a late TurnComplete of the turn before ends nothing
//  68: M9 fix 833, session.set taking keepWhole on a shell with Claude running in it, and CLAUDE_CODE_PLUGIN_DIRS on every shell naming the emerald mod first, so a claude typed into an Emerald shell loads the mod
//  69: M9 fix 835, prompt, recent and model on a team member, the first lines of the Agent call's prompt, its last three tool phrases and the model its PostToolUse resolved
//  70: M9 fix 836, activity.totals, one folder's whole-history totals folded on the daemon's side, a total and a row per month with every folder's price beside it, for the Statistics tab
//  71: M9 fix 839, toolbar on a browser view, kept only when false, the pane's toolbar row hidden from its menu
//  72: M9 fix 874, drag on browser.run, a press, a move in ten steps and a release, relayed to app windows at level 72 alone
//  72: M9 fix 875, filter on browser.run and browser.requested, a snapshot's printed rows kept to a name or a region, and the snapshot's region rows (@r1), to app windows at level 72
//  73: M9 fix 865, windows on the layout (each window's tabs and its own current tab, layout.currentTabId the front window's) and window.open, window.close and window.front
//  74: M9 fix 896, a browser view's emerald-file: url and its root, a page from the disk served by the app from the folder the Files rail shows
//  74: M9 fix 915, drag from a point x,y on browser.run, relayed to app windows at level 74 alone
//  74: M9 fix 904, seq on a team member and teamSeq on SessionInfo, each subagent's handle number in spawn order (A3), kept when the members before it are dropped
//  75: M9 fix 935, click and hover from a point x,y on browser.run, relayed to app windows at level 75 alone
//  75: M9 fix 936, browser on file.open and file.open.requested, an absolute .html or .htm path the window renders in a browser pane on emerald-file:, its root the Files rail's folder when the file is under it, else the file's own
//  76: M9 fix 969, openedBy on a browser view, the EMERALD_SESSION_ID of the session whose emmer browser open made the pane, by which emmer browser close puts away only a pane its own session opened
//  76: M9 fix 970, upload with a CSS selector in place of a ref on browser.run (emmer browser upload --selector), for a hidden file input, relayed to app windows at level 76 alone
export const DAEMON_FEATURE_LEVEL = 76;

// One rate-limit window as the mod's measure gives it (M9 fix 739): its
// kind (five_hour, seven_day, ...), the percent used and when it resets.
export interface UsageLimit {
  kind: string;
  percentUsed: number;
  resetsAt: string | null;
}

// What the emerald mod (M9 fix 725, packages/cli/mod) sends as
// X-Emerald-Hook in place of a hook file's path, so the sink knows its
// posts from the hook file's copies; register.js carries the same literal
// and the CLI's mod test holds the two together.
export const MOD_HOOK_NAME = 'emerald-mod';

// The event the emerald mod posts at a permission ask (M9 fix 742), as its
// hook_event_name: the tool and a short form of its input, at the
// decision rather than at the dialog. register.js carries the literal.
export const MOD_TOOL_ASK = 'ToolAsk';

// The event the emerald mod posts for each row the conversation keeps (M9
// fix 769), as its hook_event_name: the daemon pushes the row on as
// transcript.row and moves no state. register.js carries the literal.
export const MOD_APPEND = 'Append';

// The event the emerald mod posts once a submit the daemon pushed has an
// answer (M9 fix 781), as its hook_event_name: the push's submitId, whether
// the prompt entered and, when not, the engine's reason. The hook sink hands
// it to the waiting session.submit and writes no hooks.jsonl line.
// register.js carries the literal.
export const MOD_SUBMIT = 'ModSubmit';

// One row as the mod posts it (M9 fix 769): the transcript line's type and
// message, its long strings capped; a row the mod cut has no blocks.
export interface ModRow {
  type: 'user' | 'assistant';
  role?: 'user' | 'assistant';
  isMeta?: true;
  content: unknown[];
}

// The event the emerald mod posts when a call's progress row first draws
// (M9 fix 775), and the daemon raises when the spinner draws again on a
// row at a permission ask: the call is running, so its ask was answered.
export const MOD_TOOL_RUNNING = 'ToolRunning';

// Requests: every one has an id and gets exactly one Reply with that id.
// pty.input and pty.resize are fire-and-forget (no id, no reply) because they are hot.
export interface Requests {
  // featureLevel is absent from daemons older than M9 fix 11, which counts as level 1.
  // feed (M9 fix 240) is the update feed the daemon serves, absent from
  // older daemons and null on a box with no feed folder; no level for
  // it, since a client reads absent as none.
  // daemonStartedAt (M9 fix 494) is when the daemon's process started, in
  // epoch ms, so a client kills that pid only while it is still this
  // process; an older daemon leaves it out. home (M9 fix 495) is the
  // folder the daemon serves, resolved, so a client on another home can
  // say so; an older daemon leaves it out too.
  // featureLevel on the request: the app says the level its own build was
  // made at (M9 fix 582), so the daemon knows a window that answers every
  // file.open from one that predates it; the CLI says none.
  // token (M9 fix 612) is daemon.json's pipeToken; a daemon that has one
  // refuses a hello without it, or with another, and closes the connection.
  // shells (M9 fix 624) are the shells the daemon found at its start, in
  // SHELL_IDS order, the first the default New shell starts; an older
  // daemon leaves it out.
  'hello':          { req: { client: 'app' | 'cli'; protocolVersion: number; featureLevel?: number; token?: string };            res: { daemonPid: number; daemonStartedAt?: number; home?: string; daemonVersion: string; featureLevel?: number; feed?: { dir: string; port: number } | null; shells?: ShellOption[] } };
  // removed (M57): the removed sessions after the listed ones, each with
  // its removedAt, for the Commits tab's lanes and the activity timeline.
  'session.list':   { req: { removed?: boolean };                                          res: { sessions: SessionInfo[] } };
  // shell (M9 fix 624) picks one of the hello's shells for kind shell, the
  // first when left out; args go to that shell.
  'session.spawn':  { req: { kind: SessionKind; cwd: string; name?: string; args?: string[]; shell?: ShellId; cols: number; rows: number }; res: { session: SessionInfo } };
  // remove: forget the session once its PTY has exited, so a closed shell
  // leaves the list on its own rather than sitting in the exited group.
  'session.kill':   { req: { sessionId: string; remove?: boolean };                        res: {} };
  // New PTY for an exited session under the same id, in the folder of the
  // last conversation it hosted with claude --resume (typed into a shell
  // that hosted one), else a fresh claude or shell in spawnCwd (M48).
  'session.resume': { req: { sessionId: string; cols: number; rows: number };              res: { session: SessionInfo } };
  // Forgets an exited session: gone from the list, the file and every pane.
  'session.remove': { req: { sessionId: string };                                          res: {} };
  'session.rename': { req: { sessionId: string; name: string };                            res: {} };
  // The checkpoint: a field left out is unchanged, null clears it, and a
  // blank comment counts as null. color (M29) is one of SESSION_COLORS or
  // any lower-case hex; it cannot be cleared, every session has one.
  // scheme (M9 fix 244) is a colour scheme's name for this session alone,
  // null clears it back to the window's pick. keepWhole (M9 fix 773) marks
  // a Claude session whose idle compaction the emerald mod skips.
  'session.set':    { req: { sessionId: string; comment?: string | null; phase?: SessionPhase | null; color?: string; scheme?: string | null; keepWhole?: boolean }; res: {} };
  'session.ack':    { req: { sessionId: string };                                          res: {} };   // done -> idle when you look at it
  // since: only the bytes after that sequence number; next is the number to
  // pass back for the bytes after these, and oldest is set when the ring had
  // already dropped some of what was asked for. lastOutputAt is when the
  // PTY last wrote anything, null before it has.
  'session.read':   { req: { sessionId: string; maxBytes?: number; since?: number };       res: { data: string /* base64 */; next: number; oldest?: number; lastOutputAt: number | null } };
  // The rendered screen from a headless terminal fed the same bytes: what
  // is on it now, not what was emitted over time. For a session whose PTY
  // is gone (M9 fix 159) the frame kept at its exit or at the daemon's
  // stop, marked kept; empty when none was kept.
  // ghost (M9 fix 779): the dim run on Claude Code's prompt row, the last row starting with ❯, as Claude Code draws a suggested prompt, a placeholder or an inline completion; y indexes rows, x is the index in rows[y] where the run's text begins; null when the row has none or there is no such row; absent on a kept frame and from a daemon below level 66.
  'pty.screen':     { req: { sessionId: string };                                          res: { rows: string[]; cursor: { x: number; y: number }; seq: number; kept?: boolean; ghost?: { y: number; x: number; text: string } | null } };
  'pty.attach':     { req: { sessionId: string };                                          res: {} };   // replay push arrives before this reply
  'pty.detach':     { req: { sessionId: string };                                          res: {} };
  'layout.get':     { req: {};                                                             res: { layout: Layout } };
  // The whole value, tabs and all (M36). A single tree, the shape before
  // M36, is still taken as an edit to the tab on show.
  'layout.set':     { req: { layout: Layout | SingleTree };                                res: { layout: Layout } };
  // Several windows (M9 fix 865): window.open adds a window holding the tab named (moved out of its window, never a window's only tab) or a new empty tab, in front; window.close removes a window and its tabs, the sessions untouched, never the last, and answers the layout unchanged for an id it does not hold; window.front puts a window in front, its current tab becoming layout.currentTabId. Absent from a daemon older than level 73, which answers bad-request.
  'window.open':    { req: { tabId?: string };                                             res: { layout: Layout; windowId: string } };
  'window.close':   { req: { windowId: string };                                           res: { layout: Layout } };
  'window.front':   { req: { windowId: string };                                           res: { layout: Layout } };
  // The saved prompts (M56), by name: set with text null removes one, and
  // a name already taken is replaced. The list comes back sorted by name.
  'prompts.list':   { req: {};                                                             res: { prompts: SavedPrompt[] } };
  'prompts.set':    { req: { name: string; text: string | null };                          res: {} };
  // The folder labels (M9 fix 194), by folder: set with label null
  // removes one, and a folder already labelled is relabelled. Every
  // change goes out as folders.changed on the sessions topic.
  'folders.list':   { req: {};                                                             res: { folders: FolderLabel[] } };
  'folders.set':    { req: { folder: string; label: string | null };                      res: {} };
  // The sessions active between from and to (epoch ms) with their working
  // spans clipped to that window (M54), in start order. With
  // requestsSince (M9 fix 217), a row's request points are those opened
  // at or after it plus the track's open one, for a caller that keeps
  // the earlier ones; without it, every point in the window.
  // `capped` (M9 fix 285) is the account's capped stretches inside the
  // window, an open one running to now or to its reset; absent from a
  // daemon older than level 50, which reads as none.
  // `historyFrom` (M9 fix 607) is the earliest line the daemon's activity
  // log holds, null when it holds none; absent from a daemon older than
  // level 59, which reads as null.
  'activity.spans': { req: { from: number; to: number; requestsSince?: number };           res: { sessions: ActivitySession[]; capped: CappedSpan[]; historyFrom: number | null } };
  // One folder's totals over a window (M9 fix 836), folded on the daemon's
  // side so a whole life is one small answer: the total and a row per
  // local month, with every folder's price beside each. from defaults to
  // the log's first line, to to now. Absent from a daemon older than
  // level 70, which answers bad-request.
  'activity.totals': { req: { folder: string; from?: number; to?: number }; res: ActivityTotals };
  // activity: pty.activity pushes, at most one per session every
  // Limits.activityIntervalMs while it writes. Its own topic so the app,
  // which only wants sessions and layout, is not woken by them.
  // rate: pty.rate pushes, one per session every Limits.rateWindowMs while
  // it writes (M41), its own topic for the same reason the other way
  // round: the app wants these and a CLI waiting on activity does not.
  // app (M9 fix 271): update.requested pushes, the clicks emmer update
  // relays; only the app's main process subscribes.
  'subscribe':      { req: { topics: Array<'sessions' | 'layout' | 'activity' | 'rate' | 'app'> }; res: {} };
  // Presence (M9 fix 245): the app says nobody is at the box (the screen
  // locked, the box asleep, nothing touched for EMERALD_AWAY_AFTER_MS) and
  // that someone is back. The daemon writes the edge to its log and docks
  // every waiting stretch by the away time; a second away inside an open
  // one, or a back with none open, is nothing. The app posts these only
  // to a daemon at level 47 or later.
  'presence.away':  { req: {};                                                             res: {} };
  'presence.back':  { req: {};                                                             res: {} };
  // Capped (M9 fix 285): the app says a usage window reached 100 percent
  // (with when it resets) and that it dropped under. The daemon writes
  // the edge to its log, keeps one open band per window closed at the
  // earlier of the freed edge and the reset, and docks every waiting
  // stretch by the bands as by the away time; a second capped on an open
  // band, or a freed with none open, is nothing. The app posts these
  // only to a daemon at level 50 or later.
  'usage.capped':   { req: { window: string; resetsAt: number };                          res: {} };
  'usage.freed':    { req: { window: string };                                             res: {} };
  // Stop the daemon the way a signal would, keeping every live session's
  // screen first (M9 fix 159): the app's restart and emmer daemon stop
  // ask this before falling back to a kill, since a killed process keeps
  // nothing. The reply says how many frames were kept; the daemon exits
  // once it has gone out.
  'daemon.stop':    { req: {};                                                             res: { kept: number } };
  // The update relay (M9 fix 271). The app reports its updater's state on
  // every change and at each connect; the daemon keeps the last one and
  // answers update.state with it, apps being how many windows are on the
  // app topic (0 means nobody would take a click). update.act asks every
  // window on the app topic to do whatever its badge's click does next
  // (check, download, restart to install), as an update.requested push;
  // the reply says how many were asked.
  'update.report':  { req: { state: UpdateState };                                        res: {} };
  'update.state':   { req: {};                                                             res: { state: UpdateState | null; apps: number } };
  'update.act':     { req: {};                                                             res: { apps: number } };
  // A file opened in the window from the CLI (M9 fix 341, `emmer open`):
  // every window on the app topic gets it as file.open.requested and
  // opens the path as a pinned tab, or with pane in a pane beside the
  // focused one; the reply says how many were asked, 0 being the CLI's
  // `no window open`. The daemon does not check the path. M9 fix 375:
  // scheme is the file's own colour scheme to set before it opens (null
  // clears a pick); with it the push carries an openId and the daemon
  // holds the reply for the window's file.open.done, a few seconds at
  // most, so the CLI can say when the name is not on the window's list
  // (known). M9 fix 582: when every window on the app topic said level
  // 58 or more at hello, a plain request carries an openId too and waits
  // the same way, and the reply says whether the window answered
  // (answered); with an older window on the topic a plain request is
  // answered at once as before and carries no answered. M9 fix 376:
  // beside is a session id whose pane the file goes beside, on that
  // pane's tab (pane implied); a session on no pane falls back to
  // beside the focused pane and the answer says so (besideFound). M9
  // fix 404: a session can be on several panes, so the window says
  // which one it picked, besidePane the pane's id and besideTab its
  // tab's name; both are absent from a daemon or a window older than
  // the fix, and the CLI then says what it said before.
  // M9 fix 659: url says path holds a URL the browser pane takes, as
  // browserUrl writes it, opened in a pane and never with a scheme.
  // M9 fix 936: browser says path is an absolute .html or .htm file the
  // window renders in a browser pane on emerald-file:, its root the Files
  // rail's folder when the file is under it, else the file's own folder;
  // never with url or a scheme.
  'file.open':      { req: { path: string; pane: boolean; scheme?: string | null; beside?: string; url?: boolean; browser?: boolean }; res: { apps: number; known?: boolean; besideFound?: boolean; besidePane?: string; besideTab?: string; answered?: boolean } };
  // The window's answer to a file.open.requested push that carried an
  // openId (M9 fix 375): whether the scheme named is on its list,
  // whether the session named by beside was on a pane (fix 376), and
  // which of its panes was picked (fix 404).
  'file.open.done': { req: { openId: number; known?: boolean; besideFound?: boolean; besidePane?: string; besideTab?: string };     res: {} };
  // M9 fix 672: a command for the page in a browser pane, from emmer
  // browser, relayed to the windows at level 63 as browser.requested. by
  // is the driving session's name, shown on the pane; drivers counts the
  // windows that can drive; answered is false when none answered by the
  // deadline, the verb's own timeoutMs and the daemon's slack. filter
  // (M9 fix 875) keeps a snapshot's printed rows to a name or a region.
  'browser.run':    { req: { paneId: string; verb: BrowserVerb; args: string[]; by: string; timeoutMs: number; filter?: BrowserFilter }; res: { apps: number; drivers?: number; answered?: boolean; answer?: BrowserAnswer } };
  // The window's answer to a browser.requested push (M9 fix 672).
  'browser.done':   { req: { runId: number; answer: BrowserAnswer };             res: {} };
  // Whether a Test event carrying this test_id reached the hook sink
  // within the last minute (M9 fix 606); emmer hooks status --test posts
  // one through the installed hook and then asks; a daemon older than 59
  // answers bad-request.
  'hooks.test':     { req: { testId: string };                                     res: { arrived: boolean } };
  // The conflict forecast (M9 fix 320): the pairs of live sessions whose
  // branches would conflict on a merge, with the files, and each
  // branch's ahead, behind and fork time against the default branch,
  // read on a minute's poll and after every credited commit. Every
  // change goes out as conflicts.changed on the sessions topic.
  'conflicts.get':  { req: {};                                                             res: ConflictReport };
  // The emerald mod's prompt channel (M9 fix 741): `emmer mod-channel`,
  // which the mod starts inside a hosted Claude, asks this and the
  // connection takes that session's mod.submit pushes until it closes.
  'mod.channel':    { req: { sessionId: string };                                  res: {} };
  // A prompt for a Claude session (M9 fix 741): with its mod's channel
  // up the daemon pushes mod.submit to it and answers 'mod'; with none it
  // does nothing and answers 'typed', and the caller types the text.
  'session.submit': { req: { sessionId: string; text: string };                    res: { via: 'mod' | 'typed' } };
}

// A session's last screen (M9 fix 159): the rows and the cursor the
// emulator held when the PTY ended, kept on the record so a pane shows
// what the session was doing until it is resumed.
export interface KeptScreen {
  rows: string[];
  cursor: { x: number; y: number };
}

export type RequestType = keyof Requests;

// One concrete request message, narrowed by type. Handy for dispatch tables.
export type Request<K extends RequestType = RequestType> =
  { [P in RequestType]: { id: number; type: P } & Requests[P]['req'] }[K];

export type ClientMessage =
  | Request
  | { type: 'pty.input';  sessionId: string; data: string }                 // utf8 keystrokes
  | { type: 'pty.resize'; sessionId: string; cols: number; rows: number };

export type Reply<K extends RequestType = RequestType> =
  | { type: 'reply'; id: number; ok: true;  result: Requests[K]['res'] }
  | { type: 'reply'; id: number; ok: false; error: { code: string; message: string } };

export type ServerMessage =
  | Reply
  | { type: 'pty.output';      sessionId: string; data: string /* base64 */; replay?: true }
  | { type: 'pty.exit';        sessionId: string; exitCode: number }
  | { type: 'pty.activity';    sessionId: string; at: number }
  // The bytes the PTY wrote in each of the last Limits.rateSamples windows,
  // oldest first; all zeros once a burst has ended.
  | { type: 'pty.rate';        sessionId: string; samples: number[]; at: number }
  | { type: 'session.changed'; session: SessionInfo }
  // One load tick's samples (M9 fix 703), on the sessions topic, to app
  // windows at level 64; each sample is appended to its session's ring and
  // the names replace loadNames. A window at an older level gets each
  // sampled session's whole record as session.changed, and a CLI gets none.
  | { type: 'sessions.load';   at: number; samples: Array<{ sessionId: string; sample: LoadSample; names: string[] }> }
  // The rate-limit windows a hosted session's mod last measured (M9 fix
  // 739), on the app topic to windows at level 65; the account's, so one
  // push whichever session measured them, and only when they moved.
  | { type: 'usage.limits';    at: number; limits: UsageLimit[] }
  // A row of the conversation a hosted session's mod kept (M9 fix 769), on
  // the sessions topic to app windows at level 66, so the chat view draws
  // it before the transcript file has it; cut, present only when true,
  // marks a row the mod cut, which the view never draws.
  | { type: 'transcript.row';  sessionId: string; at: number; uuid: string; row: ModRow; cut?: true }
  | { type: 'session.removed'; sessionId: string }
  | { type: 'layout.changed';  layout: Layout }
  // The whole list after a folders.set (M9 fix 194), on the sessions topic.
  | { type: 'folders.changed'; folders: FolderLabel[] }
  // The forecast after a poll that changed it (M9 fix 320), on the
  // sessions topic.
  | { type: 'conflicts.changed'; report: ConflictReport }
  // A click on the update badge relayed from the CLI (M9 fix 271), on
  // the app topic; the app runs its updater's act().
  | { type: 'update.requested' }
  // A file to open relayed from emmer open (M9 fix 341), on the app topic;
  // with a scheme or a beside (M9 fix 375), or to windows at level 58
  // (M9 fix 582), the openId the window answers with.
  // M9 fix 659: url says path holds a URL the browser pane takes.
  // M9 fix 936: browser says path is an .html file for a browser pane.
  | { type: 'file.open.requested'; path: string; pane: boolean; openId?: number; scheme?: string | null; beside?: string; url?: boolean; browser?: boolean }
  // A command for a browser pane's page relayed from emmer browser (M9 fix
  // 672), to the app-topic windows at level 63 alone; the window answers
  // with browser.done and the runId.
  | { type: 'browser.requested'; runId: number; paneId: string; verb: BrowserVerb; args: string[]; by: string; timeoutMs: number; filter?: BrowserFilter }
  // A prompt for the emerald mod to submit (M9 fix 741), to the session's
  // mod.channel connection alone. The mod posts ModSubmit with the
  // submitId and whether the prompt entered (M9 fix 781).
  | { type: 'mod.submit'; sessionId: string; text: string; submitId?: string };
