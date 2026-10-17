export type SessionKind = 'claude' | 'shell';

// The shells a plain shell session can run (M9 fix 624), in the order the
// daemon reports the installed ones; the first installed is the default.
export type ShellId = 'pwsh' | 'powershell' | 'gitbash' | 'cmd';
export const SHELL_IDS: readonly ShellId[] = ['pwsh', 'powershell', 'gitbash', 'cmd'];
// Windows Terminal's own names for the four profiles.
export const SHELL_LABELS: Record<ShellId, string> = {
  pwsh: 'PowerShell',
  powershell: 'Windows PowerShell',
  gitbash: 'Git Bash',
  cmd: 'Command Prompt',
};
// One shell the daemon found at its start, with the file it runs.
export interface ShellOption {
  id: ShellId;
  label: string;
  file: string;
}

export function isShellId(v: unknown): v is ShellId {
  return typeof v === 'string' && (SHELL_IDS as readonly string[]).includes(v);
}

export type SessionState =
  | 'starting'
  | 'idle'
  | 'working'
  | 'needs-input'
  | 'done'
  // A turn ended while background tasks (subagents, shells) still ran; the
  // agent is woken again when one finishes, so nothing has finished yet.
  | 'waiting'
  | 'errored'
  | 'exited';

// agent-permission (M9 fix 109): a subagent's tool call is waiting on
// a permission, raised by its own PermissionRequest and released by its
// own PostToolUse, PostToolUseFailure or PermissionDenied, or its return;
// the parent's own permission is 'permission', which only the parent's
// next event releases.
// trust (M9 fix 808): a starting Claude at its folder's trust dialog,
// read off the screen by the daemon, since no hook fires before it.
export type NeedsInputReason = 'permission' | 'agent-permission' | 'elicitation' | 'question' | 'trust';

// The phases a checkpoint can name, Orca's board columns. A checkpoint is a
// comment a session writes on itself with `emmer set` (or a person writes
// from the row menu): what it means to be doing, kept until replaced, as
// opposed to the last turn, which is what happened.
export const SESSION_PHASES = ['todo', 'in-progress', 'in-review', 'done'] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

export function isSessionPhase(v: unknown): v is SessionPhase {
  return typeof v === 'string' && (SESSION_PHASES as readonly string[]).includes(v);
}

// The colours a session can be given when it starts (M24), shown as a bar
// down its sidebar row, as the tint of any pane title showing it and as
// its lane on the Commits tab, so a glance maps rows to panes and lanes
// to sessions. Measured rather than eyeballed since M59, and twelve again
// since M9 fix 133: M68 went to twenty-four at fifteen degrees so no two
// sessions would ever share a colour, and the three lightness rings put
// hue neighbours 0.079 apart in OKLab, which a 2px lane and a 3px bar
// read as one colour (a plum, a violet and a lilac side by side on the
// graph read as one block). Twelve is what tells apart at a glance: hues
// thirty degrees apart on two OKLCH lightness rings (0.66 and 0.78,
// alternating, so hue neighbours differ in lightness too), each ring at
// the largest chroma sRGB holds at every hue, from scripts/palette.mjs
// (`node packages/shared/scripts/palette.mjs 0.66,0.78 12`), which prints
// the list and the smallest pairwise OKLab distance: 0.109 here (0.108
// after the hex rounding, violet and magenta), where the old eight had
// 0.077 at their worst pair. Two sessions past the twelve share a colour,
// and the pick below keeps the ones on one screen apart. Hex, lower case,
// so a stored value can be checked by shape; a hex from an older palette
// stays valid, since the shape is all that is checked.
export const SESSION_COLORS = [
  '#cd7578', // red, hue 18
  '#f1a279', // orange, hue 48
  '#b7893b', // amber, hue 78
  '#bebd67', // olive, hue 108
  '#70a25e', // green, hue 138
  '#69ceaa', // teal, hue 168
  '#10a6aa', // cyan, hue 198
  '#63c5ee', // sky, hue 228
  '#6793d5', // blue, hue 258
  '#b4acf9', // violet, hue 288
  '#ae7cbe', // lilac, hue 318
  '#eb9ac4', // magenta, hue 348
] as const;

// The OKLab distance under which two lane colours read as one on the
// Commits graph (M9 fix 133): between the old eight's worst pair, 0.077,
// and the twelve's nearest, 0.108; M68's twenty-four sat at 0.079 and
// did not tell apart. The tests and the verify scripts read every pair
// of colours on one graph against it.
export const COLOR_FLOOR = 0.08;

export function isSessionColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);
}

// The palette by name, in the order above, for `emmer set --color` and its
// help: a person types teal rather than #69ceaa. A name of the
// twenty-four that is not one of these (coral, plum) reads as unknown.
export const SESSION_COLOR_NAMES: Readonly<Record<string, string>> = {
  red: SESSION_COLORS[0],
  orange: SESSION_COLORS[1],
  amber: SESSION_COLORS[2],
  olive: SESSION_COLORS[3],
  green: SESSION_COLORS[4],
  teal: SESSION_COLORS[5],
  cyan: SESSION_COLORS[6],
  sky: SESSION_COLORS[7],
  blue: SESSION_COLORS[8],
  violet: SESSION_COLORS[9],
  lilac: SESSION_COLORS[10],
  magenta: SESSION_COLORS[11],
};

// A Claude conversation id as a hook may name it (M9 fix 508): the id is
// typed into a shell as `claude --resume <id>` at a resume and joined
// into the task folder's path, so anything but the characters a real id
// holds is refused at the bind. The app's transcript lookup takes the
// same set; the bound is generous, a UUID being 36.
export function isSessionId(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

// A palette name or a hex colour in either case, as typed on the command
// line, to the lower-case hex the store keeps; null for anything else.
export function parseSessionColor(text: string): string | null {
  const t = text.trim().toLowerCase();
  // Own keys only (M9 fix 510): `constructor` is no colour.
  const named = Object.hasOwn(SESSION_COLOR_NAMES, t) ? SESSION_COLOR_NAMES[t] : undefined;
  if (named !== undefined) return named;
  return isSessionColor(t) ? t : null;
}

// A colour for a new session: among the palette colours no listed session
// has yet (`taken`), the one farthest from the colours that will share a
// screen with it (`peers`, the live sessions of the same repository, so
// the blocks side by side on one Commits graph are the ones kept apart),
// ties broken by the distance to the rest of what is taken, and with no
// peers the farthest from everything taken; the same rule over the whole
// palette once every colour is taken. The old eight had three near pairs
// and a random pick among the free colours gave a pair of sessions the
// twins often enough to read as one colour on a 3px bar (M9 fix 54); by
// distance neighbours only meet once the far colours are gone. The
// distance is OKLab's (M9 fix 133; it was hue alone, which put two
// colours a ring apart at the same hue as far as any), the measure the
// palette was picked on, so the picks go far round the hue circle first
// (red, then teal, then blue) and a hue neighbour comes last. The
// daemon keeps a colour out of the pool while a lane in it is still on
// screen, an exited or removed session with a recent commit (see the
// manager). With nothing in use the first colour wins, so the pick is
// deterministic; with everything in use a colour's own entry among the
// rest of the taken does not count against it, so the most isolated
// colour of the palette is the one repeated, but a peer's own colour
// does, so a peer's colour is never repeated while a free one is left.
export function pickSessionColor(taken: Iterable<string | null>, peers: Iterable<string | null> = []): string {
  const used = new Set([...taken].filter((c): c is string => c !== null && isSessionColor(c)));
  const shared = [...new Set([...peers].filter((c): c is string => c !== null && isSessionColor(c)))];
  const free = SESSION_COLORS.filter((c) => !used.has(c));
  const pool: readonly string[] = free.length > 0 ? free : SESSION_COLORS;
  const rest = [...used].filter((c) => !shared.includes(c));
  const gap = (c: string, others: readonly string[]) => (others.length === 0 ? 0 : Math.min(...others.map((u) => colorDistance(c, u))));
  let best = pool[0]!;
  let bestPeers = -1;
  let bestRest = -1;
  for (const c of pool) {
    const toPeers = gap(c, shared);
    const toRest = gap(c, rest.filter((u) => u !== c));
    // Strictly better, so the first of a tie in palette order wins.
    if (toPeers > bestPeers + 1e-9 || (Math.abs(toPeers - bestPeers) <= 1e-9 && toRest > bestRest + 1e-9)) {
      best = c;
      bestPeers = toPeers;
      bestRest = toRest;
    }
  }
  return best;
}

// The palette colour farthest in OKLab from every colour in `used` (M9
// fix 133, the history blocks of the Commits graph, which have no daemon
// record to keep a colour): the largest smallest distance wins, ties
// broken by walking the palette from `start`'s index, so a deterministic
// key (colorForKey) gives a deterministic colour, and with nothing in
// use the key's own colour.
export function farthestSessionColor(used: readonly string[], start: string): string {
  const from = Math.max(0, SESSION_COLORS.indexOf(start as (typeof SESSION_COLORS)[number]));
  let best = SESSION_COLORS[from]!;
  let bestGap = -1;
  for (let k = 0; k < SESSION_COLORS.length; k++) {
    const c = SESSION_COLORS[(from + k) % SESSION_COLORS.length]!;
    const g = used.length === 0 ? Infinity : Math.min(...used.map((u) => colorDistance(c, u)));
    if (g > bestGap + 1e-9) {
      best = c;
      bestGap = g;
    }
  }
  return best;
}

// A palette colour for something that is not a session and has no
// daemon record to keep one (M70: a conversation on disk the Commits
// graph draws a lane for): the same key gives the same colour on every
// draw and every machine, off a small hash of the key, so a history
// lane keeps its colour across scans without anyone storing it.
export function colorForKey(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return SESSION_COLORS[h % SESSION_COLORS.length]!;
}

// A hex colour in OKLab (Björn Ottosson's space, the one CSS oklch()
// uses): lightness, then the two opponent axes. The perceptual distance
// between two colours is the Euclidean one here, which is what the
// palette was picked on and what its test measures.
export function oklabOf(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function colorDistance(a: string, b: string): number {
  const p = oklabOf(a);
  const q = oklabOf(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// The way back (M9 fix 305, the member lane tints): an OKLab colour as a
// lower-case hex, the inverse of `oklabOf` and the palette script's
// matrices. A colour outside sRGB keeps its lightness and hue and gives
// up chroma until it fits, by bisection, so a tint of a palette colour
// at another lightness stays the same hue rather than clipping to a
// neighbour's.
export function hexOfOklab(l: number, a: number, b: number): string {
  const linear = (scale: number): [number, number, number] => {
    const l_ = (l + 0.3963377774 * a * scale + 0.2158037573 * b * scale) ** 3;
    const m_ = (l - 0.1055613458 * a * scale - 0.0638541728 * b * scale) ** 3;
    const s_ = (l - 0.0894841775 * a * scale - 1.291485548 * b * scale) ** 3;
    return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
  };
  const fits = (rgb: readonly number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
  let rgb = linear(1);
  if (!fits(rgb)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fits(linear(mid))) lo = mid;
      else hi = mid;
    }
    rgb = linear(lo);
  }
  const channel = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${rgb.map(channel).join('')}`;
}

// The hue of a hex colour in OKLCH degrees; a grey has no hue and reads
// as 0. The palette test reads the rings' spacing off it; the pick no
// longer does (M9 fix 133).
export function hueOf(hex: string): number {
  const [, a, b] = oklabOf(hex);
  if (Math.hypot(a, b) < 1e-6) return 0;
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

// One of the background tasks a Stop said was still running (M9 fix 52):
// what Claude Code lists in background_tasks, kept only as far as the
// badge needs it. A subagent has a description and no command; a shell
// has both, the command cut to its first line.
export interface WaitingTask {
  type: string;
  description: string | null;
  command: string | null;
}

// One member of the team a session sent out this turn (M46): a subagent
// (SubagentStart, or the Agent tool's PostToolUse, whichever lands first)
// or a background shell (only a Stop's background_tasks lists those). A
// returned member stays on the row until the next prompt a person types,
// so a subagent that took four seconds still leaves a trace. No failed
// outcome: no hook says so.
export interface TeamMember {
  id: string;
  kind: 'agent' | 'shell';
  type: string | null;
  description: string | null;
  command: string | null;
  startedAt: number;
  endedAt: number | null;
  outcome: 'running' | 'returned';
  // Where a subagent works and what it committed there (M61), read off
  // its own Bash hooks: the folder its last command ran in (a fork in a
  // worktree cd's there), the branch that folder is on, and the commits
  // its git-writing commands made, oldest first, so the commit graph can
  // draw the agent's branch in its parent's colour. A shell member and an
  // agent that has run no command have null and none. The merge flag
  // (M9 fix 218) rides them as it does the session's own.
  cwd: string | null;
  branch: string | null;
  commits: Array<Pick<SessionCommit, 'hash' | 'at' | 'merge'>>;
  // The tool the member is waiting on a permission for (M9 fix 109),
  // null or absent otherwise; optional so a record written before the
  // field reads the same and a fixture need not name it.
  permission?: string | null;
  // What the agent is doing now (M65): the tool phrase of its latest
  // PreToolUse, kept past its return so the row still says what it last
  // did; null for a shell member and an agent that has called no tool.
  activity: string | null;
}

// The context window's token counts from Claude Code's status line (M42):
// the window's size, what is in it (the status line's total_input_tokens,
// which is what the used percentage is taken over), and how the last
// request's input split, in tokens. The split is what current_usage says:
// read from the cache, written to it, sent fresh, and the reply's output.
// The prompt cache of the main conversation (M9 fix 772), off the status
// line's prompt_cache block: the TTL the last request wrote ('5m' or '1h'),
// when the cached prefix goes cold (epoch ms, Claude Code's expires_at in
// seconds times 1000) and whether it is warm now.
export interface SessionCache {
  ttl: '5m' | '1h';
  expiresAt: number;
  warm: boolean;
}

export interface ContextWindow {
  size: number;
  used: number;
  cacheRead: number;
  cacheWrite: number;
  fresh: number;
  output: number;
}

// What the session has sent and received since its Claude process started
// (M9 fix 143), summed over its requests from the same status line: the
// status line's own totals are the last request's, not the session's (its
// total_input_tokens is the current_usage parts added up and its
// total_output_tokens resets each request, read off a real one), so the
// reducer keeps the sum. Up is the three input parts, cache reads
// included since they were sent; down is the output. Persisted and
// cleared with contextPercent, so the count is per process, as Claude
// Code's own cost figure is.
export interface SessionTokens {
  fresh: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  // The share of cacheWrite billed at the 1-hour TTL rather than the
  // 5-minute one (M9 fix 278), 2x the fresh rate against 1.25x. Absent
  // or 0 prices the whole of cacheWrite at the 5-minute rate, which is
  // what the status line's current_usage gives (no split) and what a
  // transcript from before Claude Code split the two carries.
  cacheWrite1h?: number;
}

export function tokensUp(t: SessionTokens): number {
  return t.fresh + t.cacheWrite + t.cacheRead;
}

// One entry of Claude Code's own task list (M9 fix 153), the checklist
// it keeps per conversation through its TaskCreate and TaskUpdate tools
// (older builds through TodoWrite, the whole list in one call), each a
// file under ~/.claude/tasks/<claude session id>/. The reducer reads the
// tools off the parent's own PostToolUse hooks and keeps the list by id,
// so the row can say how far along Claude's plan is, 5/8, with the task
// in progress as its line. activeForm is the present-participle phrase
// Claude writes for the one it is on, "Extending strength-history row";
// null when the tool call carried none.
export type SessionTaskStatus = 'pending' | 'in_progress' | 'completed';

export interface SessionTask {
  id: string;
  subject: string;
  activeForm: string | null;
  status: SessionTaskStatus;
  // The member whose checklist this is (M9 fix 394), when a hook said so.
  // A subagent writes its tasks into the parent's own task folder and a
  // task file carries no owner, so the only word on whose a task is comes
  // off the agent_id of the TaskCreate or TaskUpdate that made it. Absent
  // on the session's own tasks and on any the hooks never saw (a resumed
  // conversation whose list the folder read built), which count for the
  // session as before but draw no member's strip.
  agentId?: string;
}

// The last Claude conversation a session hosted (M48): its id, the folder
// Claude started in (the cwd of its SessionStart) and, for a Claude
// session, the args it was started with, so a resume can pick the
// conversation up from the right folder whether the session was Claude
// itself or a shell someone typed claude into. Kept through SessionEnd,
// the exit and a daemon restart; replaced only by the next SessionStart.
export interface SessionConversation {
  id: string;
  cwd: string;
  args: string[];
}

// One commit a session made (M58): the full hash and when the session
// claimed it, which is the moment its git command finished. A commit a
// subagent made in its worktree carries the agent (M9 fix 138): the
// member's id, branch and label, folded into the session's list when
// the member leaves the team, so the graph keeps the commit on the
// member's lane of the session's block once the team no longer names
// it. Absent on the session's own commits and on records written
// before the field.
export interface SessionCommit {
  hash: string;
  at: number;
  agent?: SessionCommitAgent;
  // Whether the commit has more than one parent (M9 fix 218), read at
  // the claim with one `git rev-list --parents` over the credited
  // hashes, so the activity view can count merges apart from commits.
  // Absent on a record from before the field, which counts as a plain
  // commit.
  merge?: boolean;
}

// The last command a shell ran (M9 fix 196), read off the FinalTerm marks
// (OSC 133) the daemon's prompt wrapper writes: C at the Enter that starts
// a command, D with the exit code at the prompt that follows it. Running
// from the C until its D; ok or failed by the code. Null on a shell whose
// prompt never reports (a shell started with args of its own; and cmd,
// whose PROMPT writes the folder, A and a bare D but has no hook for C,
// M9 fix 624), which then shows nothing new. Not persisted: a new PTY starts
// with none.
export interface ShellCommand {
  state: 'running' | 'ok' | 'failed';
  // Null while running, and on a D that carried no code.
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

// One reading of a session's process tree (M9 fix 300): the daemon's
// load sampler sweeps the box's processes every tick, walks each live
// session's tree from its pty's pid by parent id, and reads the tree's
// cpu as the delta of its processes' cpu time over the wall time between
// two sweeps, in percent of one core (a tree on a many-core box reads
// over 100), and its memory as the working sets summed, in MB. The
// sidebar row draws the last five minutes as a sparkline.
export interface LoadSample {
  at: number;
  cpu: number;
  rss: number;
}

export interface SessionCommitAgent {
  id: string;
  branch: string | null;
  type: string | null;
  description: string | null;
}

// One conversation the session hosted (M9 fix 185). A /clear in a Claude
// pane ends the conversation and starts another under a new session_id
// and a new transcript, as a fork or a /resume of another conversation
// does; the record stays one row, since it is one process, but the
// Commits graph draws a block per span so the work after a clear reads
// as a separate session, the way a second shell running claude would.
// A SessionStart of a new conversation closes the open span and opens
// the next; a SessionEnd closes the open one, and a resume of the same
// conversation reopens it. A compact never touches the list. The
// commits a span made are the record's commits claimed between its
// startedAt and the next span's, so nothing on SessionCommit moves.
// A file the session wrote (M9 fix 198): the path off an Edit, Write,
// MultiEdit or NotebookEdit PostToolUse, in the file's one spelling, with
// when the call ended and, for a subagent's edit, the member's id. The
// files rail marks the file's row with a dot in the session's colour, so
// a tree with two sessions in it says who touched what. One entry per
// path, the latest write moving it to the end of the list.
export interface SessionTouched {
  path: string;
  at: number;
  agentId: string | null;
}

export interface SessionSpan {
  // Claude Code's session_id for the conversation, the transcript's name.
  conversation: string;
  // The claude.ai id read off that transcript (M58), once found.
  remoteSessionId: string | null;
  startedAt: number;
  endedAt: number | null;
  // HEAD in the group folder when the span began, read fresh at each
  // start, so each block gets its own start dot; null outside a
  // repository or until the read lands.
  startHead: string | null;
}

export interface SessionInfo {
  id: string;                 // EMERALD_SESSION_ID
  kind: SessionKind;
  name: string;               // user label, defaults to folder name
  // True while nobody has named the session by hand: the name then follows
  // the folder (spawnCwd, then each CwdChanged). A rename clears it; a
  // rename to an empty string sets it again.
  autoName: boolean;
  spawnCwd: string;
  // What the user passed after -- (or typed in the dialog), for example
  // --model opus. Part of the identity: a resume starts with the same args.
  args: string[];
  // Which shell a plain shell session runs (M9 fix 624), so a resume
  // starts the same one; null for a Claude session, absent from a daemon
  // older than level 61 and on a record from before the field, which
  // resumes in the default.
  shell?: ShellId | null;
  cwd: string;                // live, from CwdChanged hook
  // The folder the sidebar groups the row under (M9 fix 60). A shell's
  // follows its cwd; a Claude session's is where Claude started, for the
  // life of the conversation, so a session that enters a worktree stays
  // under its repo's heading. cwd keeps saying where the process really
  // is (the tooltips, the branch, the pane's folder).
  groupCwd: string;
  // The git branch of cwd, read by the daemon from .git/HEAD; null outside
  // a repository. Decoration for the sidebar, not persisted.
  branch: string | null;
  // The last turn, for the sidebar: the first line of the last prompt and
  // of the reply that ended it. A new prompt clears the reply. Persisted so
  // an exited Claude session still says what it was about.
  lastPrompt: string | null;
  lastReply: string | null;
  // When each landed (M73): the prompt's UserPromptSubmit and the reply's
  // Stop, epoch ms, for the turn card the row's lines open. Persisted
  // with them; optional so a record written before the field reads the
  // same and a fixture need not name it.
  lastPromptAt?: number | null;
  lastReplyAt?: number | null;
  state: SessionState;
  stateSince: number;         // epoch ms, drives "blocked for 4m" and sorting
  lastEventAt: number | null;
  // The latest hook of a known running agent member (M9 fix 507), epoch
  // ms, stepped a minute at a time: a parent blocked on a synchronous
  // subagent hears nothing of its own, so its stale clock reads the later
  // of this and lastEventAt. Kept apart from lastEventAt, which the usage
  // re-ask and the shell's leave read as the session's own. Not
  // persisted; optional so an older daemon's record reads the same.
  teamEventAt?: number | null;
  stale: boolean;             // working with no hook event past the stall threshold
  // The threshold the stale flag tripped (M9 fix 232), ms: three times
  // the turn's median tool gap, floored at Limits.staleAfterMs, so the
  // badge and emmer explain can say which. Set with the flag and cleared
  // with it; optional so a record from an older daemon reads the same.
  staleThresholdMs?: number | null;
  needsInputReason: NeedsInputReason | null;
  // The permission ask the emerald mod posted at the decision (M9 fix
  // 742, a ToolAsk): the tool and its subject in words, the call it is
  // for, the asking agent. Cleared when the call ends or the turn does.
  // Optional so an older record reads as none; not persisted, since
  // toPersisted picks its fields.
  askedFor?: { words: string; toolUseId: string | null; agentId: string | null; at: number } | null;
  // From the last StopFailure, for the badge tooltip. Cleared on the next turn.
  errorType: string | null;
  // What a waiting session waits on: the running entries of the Stop that
  // paused it, so the badge can say why (M9 fix 52). Empty in every other
  // state, and not persisted: a restored session is exited.
  waitingOn: WaitingTask[];
  // The team (M46): the subagents and background shells the session sent
  // out, running or returned this turn. Reducer-owned like waitingOn and
  // not persisted, but a state change leaves it alone: a returned member
  // outlives the Stop that ended the turn.
  team: TeamMember[];
  // From Claude Code's status line, which the hooks installer points at
  // emmerd: the model's display name and how full the context window is,
  // 0 to 100. Null until the first status line; a shell never has one.
  // Persisted, so an exited session still says what it was running.
  model: string | null;
  contextPercent: number | null;
  // The same status line's token counts (M42). Null until a status line
  // carries them; a payload that lacks a part keeps the last known one.
  // Persisted and cleared with contextPercent.
  contextWindow: ContextWindow | null;
  // The running sum of those counts over the process's requests (M9 fix
  // 143). Null until a status line carries counts; persisted and cleared
  // with contextPercent.
  tokens: SessionTokens | null;
  // What the process has cost so far at API rates in dollars (M9 fix
  // 154): Claude Code's own figure, the one its /cost prints, read off
  // the status line's cost.total_cost_usd, whether the account is a
  // subscription or a key. Null until a status line carries it; a line
  // without the field keeps the last one. Persisted and cleared with
  // tokens, so the figure is per process as the sum is. Optional so a
  // record or a fixture from before the field reads as none.
  costUsd?: number | null;
  // M9 fix 772: the prompt cache of the main conversation off the status
  // line's prompt_cache: the TTL the last request wrote, when the cached
  // prefix goes cold, epoch ms, and whether it is warm now. Null when the
  // last response reported no cache tokens; a status line without the
  // block keeps the last. Not persisted (toPersisted picks its fields), so
  // an exited or restored session has none; optional so an older daemon's
  // record and a fixture read as none.
  cache?: SessionCache | null;
  // M9 fix 799: the effort level the session's model runs at, off the
  // status line's effort.level, the level Claude Code resolved from
  // /effort, the settings and the model's default. Null for a model with
  // no effort setting and until the first status line; a line without a
  // model block (the mod's measure, a percent alone) keeps it. Not
  // persisted (toPersisted picks its fields); optional so an older
  // daemon's record and a fixture read as none.
  effort?: string | null;
  // Claude's task list (M9 fix 153, see SessionTask): what its TaskCreate,
  // TaskUpdate and TodoWrite calls built this turn, cleared by the next
  // prompt a person types, since a list belongs to a turn, and read back
  // off the files under ~/.claude/tasks when a later call names a task
  // the list lacks. Persisted with the record and kept across a resume,
  // since the conversation's list is the same list. Optional so a record
  // or a fixture from before the field reads as no list.
  tasks?: SessionTask[];
  // The checkpoint (see SessionPhase). Persisted, gone with a remove, kept
  // across a resume: the work is the same work.
  comment: string | null;
  phase: SessionPhase | null;
  // One of SESSION_COLORS, picked when the session started and persisted
  // with it. Null only from a daemon older than M24, which never sets one.
  color: string | null;
  // The terminal colour scheme this session wears (M9 fix 244), by the
  // scheme's name as the pane menu lists it, set through session.set the
  // way the colour is and persisted with it; null for the window's own
  // pick, which is every session's until one is given its own. A name
  // no scheme on the box carries falls back to the window's in the
  // renderer. Optional so a record or a fixture from before the field
  // reads as none.
  scheme?: string | null;
  // M9 fix 773: the person's mark that the emerald mod skips Claude Code's
  // idle compaction for this session (POST /compact on the hook sink).
  // Persisted and kept across a resume; a Claude session only. Optional so
  // a record or a fixture from before the field reads as not marked.
  keepWhole?: boolean;
  // M9 fix 812: the state and stateSince an automatic PreCompact found at
  // idle, waiting or done, which its PostCompact puts the row back to. Set
  // and cleared by the reducer; not persisted. Optional so a record or a
  // fixture from before the field reads as none.
  compactFrom?: { state: 'idle' | 'waiting' | 'done'; since: number } | null;
  // The terminal title the process last set through OSC 0 or 2, as
  // written, glyph and all; null for a process that never set one or
  // cleared it. Claude Code puts a spinner glyph and the conversation's
  // name there while it works (M33), which is what the working row shows.
  // Not persisted: a new PTY starts with none.
  title: string | null;
  // Where Claude Code writes the conversation's transcript, from the
  // transcript_path every hook carries (M47); the daemon tails it while
  // the session works so the row can show Claude's latest text as it
  // lands. Null until the first hook, and for a shell at its prompt. Not
  // persisted: a resumed conversation reports it again.
  transcriptPath: string | null;
  // The latest assistant text read off the transcript during the turn
  // (M47), published without a store write the way the title is. Null
  // between turns: a prompt clears it and the Stop's lastReply takes over.
  liveReply: string | null;
  // The tool call Claude is making, as a verb phrase off the PreToolUse
  // hook's tool_input (M9 fix 79), for the agent line while no text has
  // landed yet; the pane's own line for the call. Latest wins between it
  // and liveReply: a call nulls the text, the next text nulls the call.
  // Published without a store write like liveReply; null between turns.
  liveTool: string | null;
  // Claude Code's spinner word off the PTY stream (M9 fix 158), the
  // `Grinding` its working line shows, for the agent line when nothing
  // else has landed yet; published without a store write like the title,
  // cleared with liveReply. Optional so a record or a fixture from before
  // the field reads as none.
  liveVerb?: string | null;
  claudeSessionId: string | null;
  // The claude.ai session the conversation belongs to (M58), the
  // session_<id> token a session run through claude.ai/code puts in the
  // Claude-Session trailer of every commit it makes and in a
  // remote_session_change attachment near the head of its transcript,
  // which the daemon reads once the transcript path is known. The
  // Commits tab maps a commit's trailer to its session by it. Null for a
  // plain terminal session, whose commits carry no trailer. Persisted.
  remoteSessionId: string | null;
  // The commit HEAD pointed at in the start folder when the session was
  // spawned (M9 fix 117), read once and kept through a resume, since a
  // resumed session is the same session; null outside a repository and
  // on a record from before the field. The Commits graph runs a
  // session's line down to this commit and puts a dot on it, so the
  // lane says where the session began rather than where it first
  // committed. Persisted.
  startHead: string | null;
  // See SessionConversation. Persisted; null until a SessionStart binds one.
  conversation: SessionConversation | null;
  // The conversations hosted, oldest first (M9 fix 185, see SessionSpan);
  // the open one last. Persisted. Optional so a record or a fixture from
  // before the field reads as none, which the graph draws as one block
  // off the record's own fields, as it did before.
  spans?: SessionSpan[];
  // The files the session wrote (M9 fix 198, see SessionTouched), oldest
  // first, at most Limits.touchedKept, one entry per path. Persisted and
  // kept across a resume, so a resumed session keeps its marks. Optional
  // so a record or a fixture from before the field reads as none.
  touched?: SessionTouched[];
  // The commits the session made (M49, M58): HEAD read before and after
  // each Bash tool call that commits, merges, rebases, cherry-picks,
  // pulls, reverts or applies, in the folder the command ran in, and the
  // first-parent commits between the two credited with the time of the
  // claim; oldest first, at most Limits.commitsKept. The Commits tab
  // draws a lane per session from them, the earlier claim winning a hash
  // two sessions claim. Persisted, so an exited session keeps its lane,
  // and kept across a resume: the work is the same work. A plain shell
  // has no hooks and records none.
  commits: SessionCommit[];
  // The folder the shell's own prompt last reported (OSC 9;9), kept apart
  // from the cwd Claude's hooks report, so when Claude leaves the row can
  // go straight back to where the shell is (M9 fix 74). A Claude-kind
  // session never has one. Not persisted.
  shellCwd: string | null;
  // See ShellCommand (M9 fix 196). A long command's end puts a plain
  // shell at done or errored through the reducer, the way a Claude turn's
  // Stop does, so the row pulses and chimes by the same path; the next
  // command or an ack puts it back at idle. Optional so a record or a
  // fixture from before the field reads as none.
  command?: ShellCommand | null;
  // The load sampler's ring (M9 fix 300, see LoadSample): the last 150
  // samples of the session's process tree, oldest first, one per tick.
  // Null or absent means never sampled, which the row draws as a dash
  // and never as a zero line; a session without a pty samples nothing.
  // Not persisted: a restored session is exited.
  load?: LoadSample[] | null;
  // The image names of the tree's processes at the last sweep, at most
  // eight, for the row's hover card. Not persisted with the ring.
  loadNames?: string[];
  pid: number | null;
  exitCode: number | null;
  // M9 fix 813: the reason a Claude session's last SessionEnd gave
  // (prompt_input_exit for /exit, logout, other for a kill), kept through
  // the exit and cleared by the next SessionStart and by a resume. Not
  // persisted. Optional so a record from before the field reads as none.
  endReason?: string | null;
  createdAt: number;
  // When the session was removed from the list (M57). The daemon keeps a
  // removed session's record so the activity timeline still names it and
  // the Commits tab keeps its lane, and answers session.list { removed:
  // true } with these beside the listed ones. Absent or null on a listed
  // session.
  removedAt?: number | null;
}
