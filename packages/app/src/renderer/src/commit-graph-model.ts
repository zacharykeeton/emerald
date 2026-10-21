import { colorForKey, farthestSessionColor, hexOfOklab, markKind, oklabOf } from '@emerald/shared';
import type { SessionCommit, SessionInfo, SessionSpan, TeamMember } from '@emerald/shared';
import { commitOwners } from './commit-lanes-model.ts';
import type { GitCheckout, GraphCommit, HistoryTranscript } from '../../preload/api.ts';

// The commit graph's model (M65, after M51's lane-per-branch walk): the
// rail draws each session as a little graph of its own, side by side,
// and colour means session. A commit sits on the lane of the session
// that made it (M58's owner), lane 0 of the session's block for its own
// commits and a lane per subagent worktree for the commits the members
// made there (M61); `main` is not a lane, so two sessions that both
// commit to main draw as two lines. A commit no session made sits
// in a grey block of its own at the far side. The list is time order,
// newest first, as git log gives it, and inside a block the lanes
// follow git's parents over the block's own commits (M68, the classic
// walk M51 ran over the whole log, scoped to the block): the session's
// own line is lane 0, running from its newest own commit down to its
// oldest and on to a bar on the commit the session started from when
// the log holds it (M9 fix 117: the daemon reads HEAD at spawn, so the
// line says where the session began, not where it first committed; a
// bar since M9 fix 145, where a dot read as a commit and a bare line
// end as the log's window cutting it);
// a merge's second parent opens a side lane that runs down to the
// commit it forked from and curves in there, a merge curves out of the
// merge commit into that lane, and a lane is free again below its fork
// point. Sessions never share a lane or merge into each other: a lane
// whose fork point is a commit in the log that another block owns (M9
// fix 145) curves into the session's own line at that commit's row,
// with no node there since the session did not make it, the line
// reaching down to that row when nothing of the session's is below;
// when the session's own chain runs through that row without passing
// through the commit, the lane ends on itself at that row under a bar,
// which says "from a commit elsewhere". A worktree lane whose branch is
// not merged yet keeps M65's promise of a merge-back, curving into the
// session's line at its first commit below when its fork point is not
// in the log at all. The grey block gets the same walk, so the
// repository's history reads as a traditional graph in grey, its trunk
// the default branch's chain when that tip is in the block.
//
// Agents are rows, not history. Every live Claude session in the
// repository is a row of its own above the newest commit of its line,
// and every agent member of its team (M46 keeps them until the next
// prompt) a row above the newest commit of its lane, the marker on the
// lane and a dashed stretch down to that commit (dashed is "not landed
// yet"); a member with a worktree but no commit in the log (the fan a
// plan sends out) has a lane all the same and a dashed fork out of the
// commit its branch sits on, wherever that is; a member that never left
// the parent's folder has a lane of its own too (M9 fix 150), forking
// out of the commit the parent sits on, so only the parent's own star
// sits on its straight line. A session with no
// commit of its own yet (M68, the handoff's empty case) is a row all the
// same, above the tip of the branch it sits on, with one straight
// dashed stretch down its own lane to a dot of its own on that commit's
// row: existence is driven by sessions and worktrees, not by commits.
// Straight with no pill is a new session; curved with a pill is a
// worktree. List is the same rows with one lane per session, so the
// switch is a re-layout and nothing else.
//
// Conversations emerald did not host (M70): an outside commit whose
// trailer names a transcript on this machine (the history scan's map of
// claude.ai id to transcript) is not nobody's. First the transcripts
// are read against the records: a record whose Claude session id is a
// transcript's owns every id that transcript names, since a session
// resumed in an external terminal is handed a new id the daemon never
// learns, and its commits belong on its own lane. What is left joins a
// history block per transcript, a session-shaped block with no record
// behind it (its id is the transcript's under HISTORY_PREFIX, its name
// the conversation's title, its colour off the transcript id, drawn
// gone since nothing is live), walked like any other; the outside block
// keeps the commits no transcript names.
//
// People and remote branches (M9 fix 286). A commit whose author is not
// the repository's own (git config user.name in the root) is a
// person's: after the records and the transcripts have taken theirs,
// what is left goes to a block per author under PERSON_PREFIX, a
// session-shaped block with no record behind it as a history block is,
// drawn gone, coloured off the name, the person's name on it; a
// person's commit that carries a Claude-Session trailer stays in the
// person's block, since their agent is their work. The own author's
// unclaimed commits on a branch that lives only on the remote (the
// read asked with remotes, the ref on no local branch) go to a grey
// block per remote branch under REMOTE_PREFIX, the walk from the
// remote ref's commit over the commits no local branch reaches; a
// person's commits on such a branch stay the person's. The outside
// block keeps the own author's unclaimed commits that a local branch
// reaches, which is what it always held.
//
// Columns (M71): blocks whose rows do not overlap share a column group,
// packed first-fit in block order at the end of the walk, so a
// repository with many sessions one after another is a few columns
// wide rather than one lane per session summed; the grey block never
// packs. A slot is then a column several blocks can share, and the
// block behind a line, a dot or a node is named on it rather than read
// off the slot.
//
// Pure: rows and lanes as indices, and the lines between them as row
// and lane pairs, so the drawing (CommitGraph.tsx) maps to pixels and
// nothing else, upright or on its side.

export type GraphMode = 'graph' | 'list';

// How one block lays its lanes out (M71): its little graph, or one
// straight line the way List draws every block.
export type BlockLayout = 'graph' | 'line';

export const HISTORY_PREFIX = 'history:';
export const PERSON_PREFIX = 'person:';
export const REMOTE_PREFIX = 'remote:';

// The key a block is named by in the prefs (M71, M72): its session id,
// or this for the grey block, whose session is null.
export const OUTSIDE_KEY = 'outside';

export function blockKey(sessionId: string | null): string {
  return sessionId ?? OUTSIDE_KEY;
}

export interface GraphOptions {
  // A block's layout when the prefs say so (M71), by block key; a block
  // not named draws as one line when it is a history block or the mode
  // is the list, else as its graph.
  layout?: ReadonlyMap<string, BlockLayout> | undefined;
  // The blocks that draw lanes (M72): given every block's key, the keys
  // of those that draw; absent, every block draws. A block left out
  // keeps its commits as rows with no lane, contributes no lane, no
  // line, no dot and no agent row, and takes no column.
  drawn?: ((keys: readonly string[]) => ReadonlySet<string>) | undefined;
  // The colours the history blocks were given before (M9 fix 139), by
  // transcript id, read and written here so a block keeps its colour
  // from one build to the next; absent, every build picks afresh. The
  // person blocks (M9 fix 286) keep theirs here too, under their ids.
  historyColors?: Map<string, string> | undefined;
  // The repository's own author (M9 fix 286): a commit by anyone else
  // is a person's. Absent or null, nobody's is.
  author?: string | null | undefined;
  // The members placed on their session's line (M9 fix 907), by "<session
  // id> <member id>" (the string replayKey gives): no lane of their own and
  // no fork, as in a block drawn as one line, while the block's other
  // members keep theirs. The replay's readers and drafters, which made no
  // commit.
  membersOnLine?: ReadonlySet<string> | undefined;
  // The repository's checkouts with their branches (M9 fix 944), for each
  // session's home branch (homeBranchOf); absent, every session's line is
  // the branch the daemon read off its live folder.
  checkouts?: readonly GitCheckout[] | undefined;
}

// The transcript id behind a history block's session id, or null for a
// real session's.
export function historyIdOf(sessionId: string | null): string | null {
  return sessionId !== null && sessionId.startsWith(HISTORY_PREFIX) ? sessionId.slice(HISTORY_PREFIX.length) : null;
}

export interface GraphHistory {
  transcriptId: string;
  title: string;
}

// The person behind a person block's lane (M9 fix 286): the author's
// name as the commits carry it.
export interface GraphPerson {
  name: string;
}

// The remote branch behind a remote block's lane (M9 fix 286), as the
// ref reads (`origin/x`).
export interface GraphRemote {
  branch: string;
}

// The person's name behind a person block's session id, or null.
export function personNameOf(sessionId: string | null): string | null {
  return sessionId !== null && sessionId.startsWith(PERSON_PREFIX) ? sessionId.slice(PERSON_PREFIX.length) : null;
}

// The remote branch behind a remote block's session id, or null.
export function remoteBranchOf(sessionId: string | null): string | null {
  return sessionId !== null && sessionId.startsWith(REMOTE_PREFIX) ? sessionId.slice(REMOTE_PREFIX.length) : null;
}

export interface GraphLaneDef {
  // Left to right, and which session block the lane is in. Since M71 a
  // slot is a column that several blocks can share, so the gap between
  // blocks is the gap between column groups: `group` says which.
  slot: number;
  block: number;
  group: number;
  // null for the grey block of commits made outside emerald.
  sessionId: string | null;
  // A worktree lane's agent and its branch; null on a session's own line.
  memberId: string | null;
  branch: string | null;
  color: string | null;
  // The session is gone from the list (M57).
  gone: boolean;
  // The conversation behind a history block's lane (M70); null on a
  // session's or the outside block's.
  history: GraphHistory | null;
  // The person behind a person block's lane, or the remote branch
  // behind a remote block's (M9 fix 286); null on every other.
  person: GraphPerson | null;
  remote: GraphRemote | null;
  // A lane of its own beside a member's line for the member's star, so
  // no line runs through it (M9 fix 946, rule 10); it carries the member
  // lane's fields and takes its tint.
  side?: true;
}

export interface CommitItem {
  kind: 'commit';
  row: number;
  // null when the commit's block draws no lanes (M72): the row stays,
  // the gutter shows nothing beside it.
  lane: number | null;
  commit: GraphCommit;
  sessionId: string | null;
  memberId: string | null;
  // A commit nobody here made inside a live session's span on its line
  // (M9 fix 945): drawn on the session's line as a square, read by the
  // rows and the cards as nobody's.
  foreign?: true;
}

export interface AgentItem {
  kind: 'agent';
  row: number;
  lane: number;
  sessionId: string;
  // The member on the row, or null for the session's own row (M68).
  member: TeamMember | null;
  // Whether the one on the row is at work: the member running, or the
  // session working.
  working: boolean;
  // The member has nothing of its own in the log yet: the row forks
  // dashed out of the commit its branch sits on, when that commit is in
  // the log, or out of the commit its session sits on when it has no
  // branch (M9 fix 150).
  pending: boolean;
  forkRow: number | null;
  forkLane: number | null;
  // The row of the member's newest commit, for the pending stretch; on
  // a session's own row the head of the branch the session is on (M9
  // fix 151), with the lane that commit is drawn on when it is not the
  // session's own line (a member's commit main was fast-forwarded to),
  // where the stretch bends into it.
  tipRow: number | null;
  tipLane: number | null;
  // Under a head that is another session's commit (M9 fix 151; a head bar
  // marked it until M9 fix 945), the row of the session's newest own
  // commit on its line, where the stretch goes on to.
  restRow: number | null;
  // A session with no commit of its own: the row of the commit its
  // branch sits on, where its straight stretch ends in its own dot.
  startRow: number | null;
  // The member's row moved onto a side lane beside its line (M9 fix 946,
  // rule 10): its stretch is a dashed fork from there to forkRow,
  // bending into forkLane, the member's line.
  beside?: true;
}

export type GraphItem = CommitItem | AgentItem;

// A line to draw, in row and lane space. toRow 'bottom' runs off the end
// of the view. A merge-back or a fork changes lane at its far end.
export interface GraphLine {
  kind: 'session' | 'worktree' | 'pending' | 'fork' | 'merge' | 'branch' | 'outside' | 'start';
  lane: number;
  fromRow: number;
  toRow: number | 'bottom';
  toLane: number | null;
  dashed: boolean;
  // The block the line belongs to (M71): a slot no longer names one
  // block, so the colour and the card come from here.
  block: number;
}

// A mark on a lane that is not a commit's node, so it carries no hash:
// a session's start on the row of the commit it started from (M68 for
// a session with no commit yet, M9 fix 117 for every session whose
// start commit is in the log), and the end of a lane forked from a
// commit another block owns while the session's own chain runs past
// (M9 fix 145). Both draw as a bar; the dot stays a shape the drawing
// knows for whatever wants one later.
export interface GraphDot {
  row: number;
  lane: number;
  // null for the grey block's.
  sessionId: string | null;
  block: number;
  shape: 'dot' | 'bar';
  // A session's start or the end of a lane forked from elsewhere. The
  // head bar (M9 fix 151) went with M9 fix 945.
  kind: 'start' | 'fork';
  // True for a fork bar `forkBar` places, where a fork lands on this
  // session's own line because the commit it came from belongs to
  // another block (M9 fix 374); left unset for a fork bar the walk
  // places itself, ending a lane at the commit it came from, on another
  // block's own line (M9 fix 145). The card's two bar lines (M9 fix 399)
  // read it.
  landing?: boolean;
}

// A block as the drawing reads it (M71): whose it is and how it draws.
export interface GraphBlock {
  // null for the grey block of commits made outside emerald.
  sessionId: string | null;
  color: string | null;
  gone: boolean;
  history: GraphHistory | null;
  person: GraphPerson | null;
  remote: GraphRemote | null;
  // How the block laid its lanes out (M71), for the card's toggle.
  layout: BlockLayout;
  // Whether the block draws lanes at all (M72).
  drawn: boolean;
}

export interface SessionGraph {
  items: GraphItem[];
  lanes: GraphLaneDef[];
  blocks: GraphBlock[];
  // The packed width (M71): how many columns the gutter draws, and how
  // many column groups (a gap sits between groups).
  columns: number;
  groups: number;
  lines: GraphLine[];
  dots: GraphDot[];
  // The drawn row range (M9 fix 211): the first and last row any
  // drawing block's line, dot, node or agent row touches, the whole
  // list when every block draws, null when none does. With the rows
  // off the drawing is this long and no longer, so a hidden block's
  // rows past either end take no scroll space.
  drawnRows: { from: number; to: number } | null;
}

export type GraphSession = Pick<SessionInfo, 'id' | 'name' | 'color' | 'commits' | 'team' | 'removedAt' | 'remoteSessionId' | 'createdAt' | 'branch' | 'kind' | 'claudeSessionId' | 'lastEventAt' | 'state' | 'cwd' | 'spawnCwd' | 'groupCwd' | 'startHead' | 'spans'>;

// A block per conversation span (M9 fix 185). A record that hosted more
// than one conversation (a /clear, a fork, a shell that ran claude
// twice) is drawn as one block per span, the way a second shell running
// claude would be: the earlier spans become stand-in sessions under an
// id of their own, exited, with the record's colour, the span's own
// start commit, conversation and claude.ai id, and the commits the
// record claimed while the span was open; the last span is the record
// itself, so its row, its live state and its cards stay where they
// are. A record with one span, or none (from before the field), is the
// one block it always was, off its own fields.
const SPAN_SEP = '#span';

// The record and the span's ordinal (1 for the first) behind a stand-in's
// id, or null for a record's own id.
export function spanIdOf(sessionId: string | null): { sessionId: string; ordinal: number } | null {
  if (sessionId === null) return null;
  const at = sessionId.lastIndexOf(SPAN_SEP);
  if (at === -1) return null;
  const ordinal = Number(sessionId.slice(at + SPAN_SEP.length));
  return Number.isInteger(ordinal) && ordinal >= 1 ? { sessionId: sessionId.slice(0, at), ordinal } : null;
}

export function spanId(sessionId: string, ordinal: number): string {
  return `${sessionId}${SPAN_SEP}${ordinal}`;
}

// The name a span's block goes by: the record's for the first, with
// the ordinal after it for the rest (`emerald`, `emerald (2)`).
export function spanName(name: string, ordinal: number): string {
  return ordinal === 1 ? name : `${name} (${ordinal})`;
}

// The commits claimed while each span was open, by the claim's time.
// A claim older than the first span's start was made before any
// conversation existed: a shell that committed through the fix 195 path
// before the person typed claude (M9 fix 400). It goes to the record's
// own live block, the last span's, rather than into the first
// conversation's, which would say Claude made it. The start bar stays on
// that span's startHead and the line runs past it, so a commit below the
// bar reads as what it is, from before Claude.
export function spanCommits(commits: readonly SessionCommit[], spans: readonly SessionSpan[]): SessionCommit[][] {
  const out: SessionCommit[][] = spans.map(() => []);
  for (const c of commits) {
    if (spans.length > 0 && c.at < spans[0]!.startedAt) {
      out[spans.length - 1]!.push(c);
      continue;
    }
    let i = 0;
    for (let j = 1; j < spans.length; j++) if (spans[j]!.startedAt <= c.at) i = j;
    out[i]!.push(c);
  }
  return out;
}

// The hashes a session's start bar (M9 fix 117) must sit below: every
// commit it made, except one claimed before its first conversation opened
// (M9 fix 400), which sits on the live block on purpose, below the bar,
// and so does not count toward where the bar goes. A record with no spans
// keeps today's reading, every commit guarding the bar, since there is no
// "before the first conversation" to speak of.
export function commitsTheBarSitsBelow(session: Pick<SessionInfo, 'commits' | 'spans'>): Set<string> {
  const spans = session.spans ?? [];
  const firstSpanAt = spans.length === 0 ? null : spans[0]!.startedAt;
  if (firstSpanAt === null) return new Set(session.commits.map((c) => c.hash));
  return new Set(session.commits.filter((c) => c.at >= firstSpanAt).map((c) => c.hash));
}

// The stand-in ids a record's earlier spans draw under, for the
// active filter (M72): they are the listed session's blocks too.
export function spanIds(s: Pick<GraphSession, 'id' | 'spans'>): string[] {
  const n = s.spans?.length ?? 0;
  return n < 2 ? [] : Array.from({ length: n - 1 }, (_, i) => spanId(s.id, i + 1));
}

// The stand-in for one earlier span of a record, from its fields.
export function spanSession(s: GraphSession, ordinal: number): GraphSession {
  const spans = s.spans ?? [];
  const span = spans[ordinal - 1]!;
  const commits = spanCommits(s.commits, spans)[ordinal - 1] ?? [];
  return { ...s, id: spanId(s.id, ordinal), name: spanName(s.name, ordinal), commits, team: [], removedAt: null, remoteSessionId: span.remoteSessionId, createdAt: span.startedAt, claudeSessionId: span.conversation, lastEventAt: null, state: 'exited', startHead: span.startHead };
}

// The records as the graph draws them: each one with two or more spans
// becomes its earlier spans' stand-ins followed by the record on its
// last span's fields; the rest pass through.
export function spanSessions(records: readonly GraphSession[]): GraphSession[] {
  const out: GraphSession[] = [];
  for (const s of records) {
    const spans = s.spans ?? [];
    if (spans.length < 2) {
      out.push(s);
      continue;
    }
    for (let i = 1; i < spans.length; i++) out.push(spanSession(s, i));
    const last = spans[spans.length - 1]!;
    const commits = spanCommits(s.commits, spans)[spans.length - 1] ?? [];
    out.push({ ...s, name: spanName(s.name, spans.length), commits, startHead: last.startHead });
  }
  return out;
}

interface Block {
  sessionId: string | null;
  session: GraphSession | null;
  // Lane keys in order: '0' then member ids.
  laneKeys: string[];
}

// Whether dir is root or under it, on Windows terms: either slash, any
// case. The roots are the repository's checkouts as git lists them
// (forward slashes), the folders the daemon's records (backslashes).
export function underFolder(dir: string | null, root: string): boolean {
  if (dir === null) return false;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const d = norm(dir);
  const r = norm(root);
  return r !== '' && (d === r || d.startsWith(`${r}/`));
}

// A session works in the repository when the folder the sidebar groups
// it under (M9 fix 148: groupCwd, where Claude started, or a shell's
// live folder; the spawn folder only for a record without one) or its
// live folder is under one of the repository's checkouts. Not the spawn
// folder on its own: a shell opened here that ran claude in another
// repository is that repository's, as its sidebar heading says.
function inRepo(s: Pick<GraphSession, 'cwd' | 'spawnCwd' | 'groupCwd'>, roots: readonly string[]): boolean {
  const group = s.groupCwd || s.spawnCwd;
  return roots.some((r) => underFolder(group, r) || underFolder(s.cwd, r));
}

// The branch a session's line and star follow (M9 fix 944): the branch of
// the checkout holding the folder it started in (groupCwd, else the
// spawn folder), not the one its live folder is in. Claude Code reports a
// `cd` that sticks inside one Bash call as the session's new folder (fix
// 113's CwdChanged), so a lead's `cd <worktree> && git commit` moves its
// cwd, and the daemon's branch with it, into a seat's worktree until the
// next hook from home moves it back; the star stays where its folder is.
// The checkout holding a folder is the one with the longest path over
// it, since Claude Code's own worktrees sit inside the main checkout.
// When no checkout holds home, or the live folder is in the home
// checkout (the usual case, and every shell, whose groupCwd follows its
// cwd), the daemon's branch is fresh and is the answer; a detached home
// is null.
export function homeBranchOf(s: Pick<GraphSession, 'cwd' | 'groupCwd' | 'spawnCwd' | 'branch'>, checkouts: readonly GitCheckout[]): string | null {
  const holding = (dir: string | null): GitCheckout | null => {
    let best: GitCheckout | null = null;
    for (const c of checkouts) if (underFolder(dir, c.path) && (best === null || c.path.length > best.path.length)) best = c;
    return best;
  };
  const home = holding(s.groupCwd || s.spawnCwd);
  if (home === null || holding(s.cwd) === home) return s.branch;
  return home.branch;
}

// A session that gets a row of its own (M68): running Claude by the
// sidebar's reading (a shell that ran claude counts, as its star does),
// still in the list and still alive. A removed or exited session keeps
// its lane by its commits (M57) and nothing else.
function hasOwnRow(s: GraphSession): boolean {
  return markKind(s) === 'claude' && (s.removedAt === null || s.removedAt === undefined) && s.state !== 'exited';
}

// The session-shaped stand-in for a conversation with no record (M70).
// Exited and removed, so it gets no row and keeps its lane by its
// commits, as a removed session does; its folder is the transcript's,
// which is never asked since it has no row to place. Its colour is
// given once the blocks are known (historyColors, M9 fix 133), so it
// starts with none.
function historySession(t: HistoryTranscript): GraphSession {
  const at = t.startedAt ?? 0;
  return { id: HISTORY_PREFIX + t.id, name: t.title, color: null, commits: [], team: [], removedAt: at, remoteSessionId: null, createdAt: at, branch: null, kind: 'claude', claudeSessionId: t.id, lastEventAt: null, state: 'exited', cwd: t.cwd, spawnCwd: t.cwd, groupCwd: t.cwd, startHead: null };
}

// The session-shaped stand-in for a person (M9 fix 286): exited and
// removed, so no row, the lane kept by the commits, as a history
// block's is; its time is its oldest shown commit's, for the colour
// pass's order. The colour comes with the history blocks'.
function personSession(name: string, at: number): GraphSession {
  return { id: PERSON_PREFIX + name, name, color: null, commits: [], team: [], removedAt: at, remoteSessionId: null, createdAt: at, branch: null, kind: 'claude', claudeSessionId: null, lastEventAt: null, state: 'exited', cwd: '', spawnCwd: '', groupCwd: '', startHead: null };
}

// The stand-in for a remote branch (M9 fix 286): the same shape, grey
// (no colour, as the outside block has none), named by the ref.
function remoteSession(branch: string, at: number): GraphSession {
  return { id: REMOTE_PREFIX + branch, name: branch, color: null, commits: [], team: [], removedAt: at, remoteSessionId: null, createdAt: at, branch: null, kind: 'claude', claudeSessionId: null, lastEventAt: null, state: 'exited', cwd: '', spawnCwd: '', groupCwd: '', startHead: null };
}

// The commits that live only on the remote (M9 fix 286), by the remote
// ref whose walk reached them: every commit a local branch reaches is
// local, and from each remote ref's commit the parents are walked over
// the rest, the first ref to reach a commit keeping it. Empty when the
// read was not asked with remotes, since then no commit carries one.
export function remoteOnlyCommits(commits: readonly GraphCommit[]): Map<string, string> {
  const rowOf = new Map<string, GraphCommit>();
  for (const c of commits) rowOf.set(c.hash, c);
  const local = new Set<string>();
  for (const c of commits) {
    if (c.refs.length === 0) continue;
    const stack = [c.hash];
    while (stack.length > 0) {
      const h = stack.pop()!;
      if (local.has(h)) continue;
      const at = rowOf.get(h);
      if (at === undefined) continue;
      local.add(h);
      stack.push(...at.parents);
    }
  }
  const out = new Map<string, string>();
  for (const c of commits) {
    for (const ref of c.remoteRefs ?? []) {
      const stack = [c.hash];
      while (stack.length > 0) {
        const h = stack.pop()!;
        if (local.has(h) || out.has(h)) continue;
        const at = rowOf.get(h);
        if (at === undefined) continue;
        out.set(h, ref);
        stack.push(...at.parents);
      }
    }
  }
  return out;
}

// A member lane's tint (M9 fix 305). Under a wide batch the run
// session's block carries every member's branch as a lane, all in the
// block's one colour, and twelve straight amber lines told nothing
// apart. So member k of a block takes the block's colour at another
// OKLab lightness, the steps alternating around the block's own (+0.06,
// -0.06, +0.12, -0.12 and on), chroma and hue held, so the members are
// tints of one hue and the block still reads as one; the own lane
// (index 0) is the colour itself. The steps are kept inside the range
// a lane stays readable in on either ground (the palette's rings sit at
// 0.66 and 0.78), and when the count wants more steps than the range
// holds at 0.06 the step shrinks until every member has a lightness of
// its own, so twelve members are twelve distinct tints rather than a
// clamped pile at each end.
const TINT_LIGHT_LO = 0.52;
const TINT_LIGHT_HI = 0.86;
const TINT_STEP = 0.06;
export function memberTint(color: string, index: number, count: number): string {
  if (index <= 0) return color;
  const [l, a, b] = oklabOf(color);
  const lo = Math.min(l, TINT_LIGHT_LO);
  const hi = Math.max(l, TINT_LIGHT_HI);
  let step = TINT_STEP;
  let ladder: number[] = [];
  while (ladder.length < count && step > 0.002) {
    ladder = [];
    for (let k = 1; ladder.length < count && k <= count * 4; k++) {
      for (const sign of [1, -1]) {
        const at = l + sign * k * step;
        if (at >= lo - 1e-9 && at <= hi + 1e-9) ladder.push(at);
      }
    }
    if (ladder.length < count) step *= 0.75;
  }
  return hexOfOklab(ladder[index - 1] ?? l, a, b);
}

// The history blocks' colours (M9 fix 133): a conversation has no daemon
// record to keep one, and a colour hashed from its id (M70) landed
// beside a session's own shade often enough. So, once the blocks are
// known, each history block in order of its conversation's start takes
// the palette colour farthest in OKLab from every colour already on the
// graph, the session blocks' stored colours and the history blocks
// before it, ties walked from the hashed colour, which keeps the result
// the same for a given log and set of sessions. A block keeps the colour
// it was given before (M9 fix 139, the memo) unless that hex is on the
// graph already, a session's stored colour or a history block placed
// earlier in this pass, since a lane that changed identity under the eye
// whenever a session block appeared or was recoloured cost more than the
// pick it made room for; only the block that collides is re-picked, and
// its new colour keeps clear of the colours the other blocks hold too,
// so a re-pick never evicts a neighbour.
function historyColors(blocks: readonly Block[], standIns: ReadonlyMap<string, GraphSession>, memo: Map<string, string> | undefined): void {
  const onGraph: string[] = [];
  for (const b of blocks) if (b.session !== null && !standIns.has(b.session.id) && b.session.color !== null) onGraph.push(b.session.color);
  const history = blocks.flatMap((b) => (b.session !== null && standIns.has(b.session.id) ? [b.session] : [])).sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id));
  const keyOf = (h: GraphSession) => historyIdOf(h.id) ?? h.id;
  const held = history.flatMap((h) => { const k = memo?.get(keyOf(h)); return k === undefined ? [] : [k]; });
  for (const h of history) {
    const key = keyOf(h);
    const kept = memo?.get(key);
    const color = kept !== undefined && !onGraph.includes(kept) ? kept : farthestSessionColor([...onGraph, ...held.filter((c) => c !== kept)], colorForKey(key));
    h.color = color;
    memo?.set(key, color);
    onGraph.push(color);
  }
}

// The claude.ai ids a record owns through its transcript (M70): every
// id the transcript with the record's Claude session id names. The
// first record to claim a transcript keeps it.
export function remoteIdsByRecord(sessions: readonly GraphSession[], history: ReadonlyMap<string, HistoryTranscript>): Map<string, string> {
  const byTranscript = new Map<string, string>();
  for (const s of sessions) {
    if (s.claudeSessionId !== null && !byTranscript.has(s.claudeSessionId)) byTranscript.set(s.claudeSessionId, s.id);
  }
  const out = new Map<string, string>();
  for (const [remote, t] of history) {
    const sessionId = byTranscript.get(t.id);
    if (sessionId !== undefined && !out.has(remote)) out.set(remote, sessionId);
  }
  return out;
}

export function sessionGraph(commits: readonly GraphCommit[], given: readonly GraphSession[], mode: GraphMode, roots: readonly string[] = [], defaultBranch: string | null = null, history: ReadonlyMap<string, HistoryTranscript> = new Map(), options: GraphOptions = {}): SessionGraph {
  // A block per conversation span (M9 fix 185), each on its home branch
  // (M9 fix 944): every later read of a session's branch, the seed's head,
  // the star's anchor and the M68 start guess, reads the branch of the
  // checkout it started in.
  const checkouts = options.checkouts ?? [];
  const withHome = (s: GraphSession): GraphSession => {
    if (checkouts.length === 0) return s;
    const home = homeBranchOf(s, checkouts);
    return home === s.branch ? s : { ...s, branch: home };
  };
  const records = spanSessions(given.map((s) => withHome(s)));
  // One line or the little graph, per block (M71): the prefs' word for
  // the block first, else a history block is a line (its inner topology
  // is nobody's to read live), else the mode's.
  const lineOnly = (sessionId: string | null): boolean => {
    const over = options.layout?.get(blockKey(sessionId));
    if (over !== undefined) return over === 'line';
    return historyIdOf(sessionId) !== null || mode === 'list';
  };
  const onLine = (sessionId: string | null, memberId: string): boolean => options.membersOnLine?.has(`${sessionId ?? ''} ${memberId}`) ?? false;
  const owners = commitOwners(commits, records, remoteIdsByRecord(records, history));
  // The conversations left over (M70): a stand-in session per
  // transcript an unowned trailer names, owning those commits.
  const standIns = new Map<string, GraphSession>();
  for (const c of commits) {
    const remote = c.claudeSession ?? null;
    if (remote === null || owners.has(c.hash)) continue;
    const t = history.get(remote);
    if (t === undefined) continue;
    const id = HISTORY_PREFIX + t.id;
    if (!standIns.has(id)) standIns.set(id, historySession(t));
    owners.set(c.hash, id);
  }
  const sessions = [...records, ...standIns.values()];
  const byId = new Map(sessions.map((s) => [s.id, s]));
  // A member's own commits (M61) are the parent session's too, on the
  // member's lane; the trailer and the parent's own claims come first.
  // A commit the record kept from a member since gone (M9 fix 138) is
  // the same, read off the session's own list.
  const memberByHash = new Map<string, string>();
  for (const s of sessions) {
    for (const m of s.team) {
      if (m.kind !== 'agent') continue;
      for (const c of m.commits) {
        memberByHash.set(`${s.id} ${c.hash}`, m.id);
        if (!owners.has(c.hash)) owners.set(c.hash, s.id);
      }
    }
    for (const c of s.commits) if (c.agent !== undefined && !memberByHash.has(`${s.id} ${c.hash}`)) memberByHash.set(`${s.id} ${c.hash}`, c.agent.id);
  }
  // The people and the remote branches (M9 fix 286), out of what no
  // record, member or transcript took: another author's commit is the
  // person's, trailer or none; the own author's on a remote-only branch
  // is the remote's; the rest stay outside.
  const author = options.author ?? null;
  const remoteRefOf = remoteOnlyCommits(commits);
  const remoteStandIns = new Map<string, GraphSession>();
  for (const c of commits) {
    if (owners.has(c.hash)) continue;
    const name = c.author.trim();
    if (author !== null && name !== '' && name !== author) {
      const id = PERSON_PREFIX + name;
      const held = standIns.get(id);
      if (held === undefined) standIns.set(id, personSession(name, c.at));
      else if (c.at < held.createdAt) held.createdAt = held.removedAt = c.at;
      owners.set(c.hash, id);
      continue;
    }
    const ref = remoteRefOf.get(c.hash);
    if (ref === undefined) continue;
    const id = REMOTE_PREFIX + ref;
    if (!remoteStandIns.has(id)) remoteStandIns.set(id, remoteSession(ref, c.at));
    owners.set(c.hash, id);
  }
  if (standIns.size > 0 || remoteStandIns.size > 0) {
    // The session list is rebuilt with the stand-ins added here, since
    // the people's lanes are looked up by id as the others' are.
    sessions.splice(0, sessions.length, ...records, ...standIns.values(), ...remoteStandIns.values());
    for (const s of sessions) byId.set(s.id, s);
  }
  const rowOf = new Map<string, number>();
  commits.forEach((c, i) => rowOf.set(c.hash, i));
  // The row a branch name sits on, for the fork points.
  const refRow = new Map<string, number>();
  commits.forEach((c, i) => {
    for (const r of c.refs) if (!refRow.has(r)) refRow.set(r, i);
  });
  // A member gone with its worktree (M9 fix 946, rule 7): it has reported
  // back, its branch is no longer in the log and its folder is no
  // checkout of the repository any more (the sweep's worktree remove and
  // branch -D), so it has no row and no star; its commits keep their
  // lanes and their card as history. One with no branch worked in the
  // session's own folder and is never gone by this; one still running
  // never is. A returned member whose branch or worktree is still there
  // exists and can take more work, so it is drawn resting (rule 9). A
  // live member with a branch always has its folder (the branch is read
  // off it); one with none is the replay's stand-in, rebuilt from the
  // record of a batch long swept, and keeps its row there.
  const isGone = (m: TeamMember): boolean => m.outcome === 'returned' && m.branch !== null && !refRow.has(m.branch) && m.cwd !== null && !roots.some((r) => underFolder(m.cwd, r));
  // The squares (M9 fix 945, rule 5): a commit nobody here made that lies
  // on a live session's home-branch first-parent chain between the commit
  // it started on and its branch's head is inside the session's span, so
  // it is the session's, marked foreign: it draws on the session's line in
  // its colour as a square, while the rows and cards still read it as
  // nobody's. Another session's commit on that chain stays that session's,
  // and the start commit itself never is one. Two live sessions on one
  // branch (open question 1): the earliest started takes them. A chain
  // that leaves the log before it meets the start commit assigns nothing,
  // since what lies past the log's end is unknown. Members take none.
  const foreign = new Set<string>();
  const squaresFor = records.filter((s) => hasOwnRow(s) && inRepo(s, roots) && s.branch !== null && s.startHead !== null).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const s of squaresFor) {
    const collected: string[] = [];
    let met = false;
    for (let i = refRow.get(s.branch!); i !== undefined; ) {
      const c = commits[i]!;
      if (c.hash === s.startHead) {
        met = true;
        break;
      }
      if (!owners.has(c.hash)) collected.push(c.hash);
      const fp = c.parents[0];
      i = fp === undefined ? undefined : rowOf.get(fp);
    }
    if (!met) continue;
    for (const h of collected) {
      owners.set(h, s.id);
      foreign.add(h);
    }
  }
  const commitSession = commits.map((c) => owners.get(c.hash) ?? null);
  const commitMember = commits.map((c, i) => {
    const s = commitSession[i];
    return s === null ? null : (memberByHash.get(`${s} ${c.hash}`) ?? null);
  });

  // Blocks in order of first appearance among the commits, then the
  // sessions in the repository with nothing in the log yet (a session
  // just opened, or a plan just sent out), oldest first, then the grey
  // block. A session in another repository never has a block, however
  // many agents it has out.
  const blocks: Block[] = [];
  const blockOf = new Map<string | null, number>();
  const addBlock = (sessionId: string | null) => {
    if (blockOf.has(sessionId)) return;
    blockOf.set(sessionId, blocks.length);
    blocks.push({ sessionId, session: sessionId === null ? null : (byId.get(sessionId) ?? null), laneKeys: ['0'] });
  };
  for (const s of commitSession) if (s !== null) addBlock(s);
  const agentsOf = (s: GraphSession): TeamMember[] => s.team.filter((m) => m.kind === 'agent');
  const here = sessions.filter((s) => inRepo(s, roots));
  for (const s of [...here].sort((a, b) => a.createdAt - b.createdAt)) if (hasOwnRow(s) || agentsOf(s).length > 0) addBlock(s.id);
  if (commitSession.includes(null)) addBlock(null);
  historyColors(blocks, standIns, options.historyColors);
  // The blocks that draw (M72): the rest keep their rows and nothing else.
  const drawnKeys = options.drawn === undefined ? null : options.drawn(blocks.map((b) => blockKey(b.sessionId)));
  const isDrawn = (sessionId: string | null): boolean => drawnKeys === null || drawnKeys.has(blockKey(sessionId));
  for (const b of blocks) if (!isDrawn(b.sessionId)) b.laneKeys = [];
  // Lanes in a block (M68): the walk over the block's own commits gives
  // each a lane and each parent edge a bend; lane 0 is the session's
  // own line (the head of its home branch seeds it since M9 fix 944
  // whenever that head may sit there, else its newest own commit, and it
  // is never handed to anyone else), the grey block's trunk the default branch's tip when
  // it holds it. A member whose commits are in the block is on the lane
  // its newest commit took; a member with nothing in the log gets a
  // lane of its own after the walk's, by start, whether or not it has a
  // worktree (M9 fix 150: a member in the session's own folder used to
  // sit on the session's line, over its star). The list has the
  // session's line alone.
  // The row of the commit a session started on (M9 fix 117), when the
  // log holds it.
  const startIndexOf = (s: GraphSession): number | undefined => {
    if (s.startHead === null) return undefined;
    const i = commits.findIndex((c) => c.hash === s.startHead);
    return i === -1 ? undefined : i;
  };
  const localLane = new Map<number, number>();
  const edges: TopologyEdge[] = [];
  const laneMember = new Map<string, string>();
  // Each drawn block's walk (M9 fix 145), for its bars, the forks'
  // landings and how far its line reaches.
  const walkOf = new Map<number, Topology>();
  const defaultTip = defaultBranch === null ? undefined : commits.find((c) => c.refs.includes(defaultBranch))?.hash;
  blocks.forEach((b, bi) => {
    const mine: number[] = [];
    commitSession.forEach((sid, i) => {
      if (sid === b.sessionId) mine.push(i);
    });
    if (!isDrawn(b.sessionId) || lineOnly(b.sessionId)) return;
    // The grey block's trunk is the default branch's history: the first
    // commit down the tip's first parents that nobody in emerald made (the
    // tip itself when a session did not make it), so a session's commits
    // on main leave main's older history as the trunk. A session's trunk
    // is its own commits', never a member's.
    let seed: string | null = null;
    for (let h = b.sessionId === null ? defaultTip : undefined; h !== undefined; ) {
      const i = rowOf.get(h);
      if (i === undefined) break;
      if (commitSession[i] === null) {
        seed = h;
        break;
      }
      h = commits[i]!.parents[0];
    }
    // Whether lane 0 has anything to land on (M9 fix 145): the grey
    // trunk, a session's own commits, or the start bar a session with
    // a row of its own gets; a member's lane under a session with none
    // of those ends under a bar instead.
    const start = b.session === null ? undefined : (startIndexOf(b.session) ?? (b.session.branch === null ? undefined : refRow.get(b.session.branch)));
    const hasOwn = mine.some((i) => commitMember[i] === null);
    // Where the session sits (M9 fix 151): the head of its branch when
    // the log holds it, else its own commits, else its start. A member
    // with no branch forks from there, and the walk is asked about the
    // row when the block has no commit of its own on the line.
    const head = b.session === null || b.session.branch === null ? undefined : refRow.get(b.session.branch);
    const seat = head ?? (hasOwn ? undefined : start);
    const withRow = b.session !== null && hasOwnRow(b.session) && inRepo(b.session, roots);
    const trunkDrawn = b.session === null || hasOwn || ((start !== undefined || head !== undefined) && withRow);
    // The session's line is its branch's (M9 fix 937, M9 fix 944): the
    // trunk is seeded with the head of the branch it started on whenever
    // the log holds it and that head may sit on the trunk, so the lead's
    // commits off that chain (made in a seat's worktree while its folder
    // stayed home) take a side lane, nothing of the session's sits above
    // its star on its line, and a commit landing on main from elsewhere
    // never hands the trunk back to the lead's newest commit (fix 937
    // compared age, so the moment one did, the walk restarted from the
    // fix-up and swung the seat's work onto the lead's line). A head in
    // another block, or nobody's, is watched, so the walk follows the
    // trunk's chain through it. A head that is a member's own commit
    // (main fast-forwarded onto a member's work, fix 151's case) seeds
    // only when the session's newest own commit is newer, as fix 937 had
    // it: seeded with it, the member's commits would take lane 0 and its
    // lane would become the session's line.
    const ownTop = mine.find((i) => commitMember[i] === null);
    const seedHead = b.sessionId !== null && withRow && head !== undefined && (!mine.includes(head) || commitMember[head] === null || (ownTop !== undefined && ownTop < head));
    if (seedHead) seed = commits[head]!.hash;
    // The commit-less members' fork points in other blocks are watched
    // (M9 fix 145), so their forks land by the walk's rule: a member
    // with a branch forks from the commit the branch sits on, and one
    // with none (M9 fix 150: it works in the session's own folder, or
    // has not run a command yet) from the commit the session sits on,
    // which is the session's start commit when it has none of its own.
    const placedMembers = new Set(mine.map((i) => commitMember[i]).filter((m): m is string => m !== null));
    // A gone member with nothing in the block (M9 fix 946) gets no lane.
    const unplaced = b.session === null ? [] : agentsOf(b.session).filter((m) => !placedMembers.has(m.id) && !onLine(b.sessionId, m.id) && !isGone(m)).sort((x, y) => x.startedAt - y.startedAt);
    const watch = unplaced.map((m) => (m.branch === null ? undefined : refRow.get(m.branch)) ?? seat).filter((r): r is number => r !== undefined);
    if (seedHead && !mine.includes(head)) watch.push(head);
    const walk = blockTopology(mine, commits, rowOf, seed, (i) => b.sessionId === null || commitMember[i] === null, watch, trunkDrawn);
    walkOf.set(bi, walk);
    // The lead's commit on a seat's line (M9 fix 944, rule 4): the commits
    // down a member's branch from its head that are the session's own and
    // that the walk put off the trunk are hinted to that member, so the
    // lane they took is the member's even before the member has a commit
    // of its own (once it has, the walk puts both on one lane already),
    // and the member is not fresh. The hint names lanes only: the commit
    // stays the lead's. A member's watched fork point is never in the
    // block, so the walk above reads the same with the member unplaced.
    const hint = new Map<number, string>();
    for (const m of unplaced) {
      for (let i = m.branch === null ? undefined : refRow.get(m.branch); i !== undefined; ) {
        if (commitSession[i] !== b.sessionId || commitMember[i] !== null || (walk.laneOf.get(i) ?? 0) === 0 || hint.has(i)) break;
        hint.set(i, m.id);
        const fp = commits[i]!.parents[0];
        i = fp === undefined ? undefined : rowOf.get(fp);
      }
    }
    const hinted = new Set(hint.values());
    const fresh = unplaced.filter((m) => !hinted.has(m.id));
    walk.laneOf.forEach((lane, i) => {
      localLane.set(i, lane);
      const m = commitMember[i] ?? hint.get(i) ?? null;
      const key = `${bi} ${lane}`;
      if (m !== null && !laneMember.has(key)) laneMember.set(key, m);
    });
    edges.push(...walk.edges);
    // Every commit-less member has a lane of its own, branch or none
    // (M9 fix 150), by start, so a member that gains a branch keeps its
    // lane and the lanes stop reshuffling as branches arrive; the
    // session's own line carries only its own commits and its star.
    // Those lanes sit right after the session's own line, before the
    // walk's (M9 fix 374): a member with nothing in the log forks off
    // its parent's line, and put after every walk lane its fork was a
    // straight line along the row across all of them, which read as an
    // agent from nowhere; beside the line it is a short bend. The lane
    // moves once, to a walk lane, when the member's first commit
    // lands, which fix 150's stability covers and no more. The walk's
    // lanes keep their `t<k>` names, so a lookup by name below finds
    // them wherever they sit.
    b.laneKeys.push(...fresh.map((m) => m.id));
    for (let k = 1; k < walk.laneCount; k++) b.laneKeys.push(`t${k}`);
  });
  const personOf = (sessionId: string | null): GraphPerson | null => {
    const name = personNameOf(sessionId);
    return name === null ? null : { name };
  };
  const remoteOf = (sessionId: string | null): GraphRemote | null => {
    const branch = remoteBranchOf(sessionId);
    return branch === null ? null : { branch };
  };
  const lanes: GraphLaneDef[] = [];
  const slotOf = new Map<string, number>();
  const blockColors = blocks.map((b) => b.session?.color ?? null);
  blocks.forEach((b, bi) => {
    b.laneKeys.forEach((key, k) => {
      const memberId = key === '0' || b.session === null ? (laneMember.get(`${bi} ${k}`) ?? null) : key.startsWith('t') ? (laneMember.get(`${bi} ${key.slice(1)}`) ?? null) : key;
      const member = memberId === null || b.session === null ? null : (b.session.team.find((m) => m.id === memberId) ?? foldedAgents(b.session).find((m) => m.id === memberId) ?? null);
      slotOf.set(`${b.sessionId ?? ''} ${key}`, lanes.length);
      // A member with commits is reached by its id too, for its row.
      if (member !== null && !slotOf.has(`${b.sessionId ?? ''} ${member.id}`)) slotOf.set(`${b.sessionId ?? ''} ${member.id}`, lanes.length);
      const transcriptId = historyIdOf(b.sessionId);
      const history = transcriptId === null || b.session === null ? null : { transcriptId, title: b.session.name };
      lanes.push({ slot: lanes.length, block: bi, group: bi, sessionId: b.sessionId, memberId: member?.id ?? null, branch: member?.branch ?? null, color: blockColors[bi]!, gone: typeof b.session?.removedAt === 'number', history, person: personOf(b.sessionId), remote: remoteOf(b.sessionId) });
    });
  });
  // A commit's slot: its walk lane in the graph, the session's line in
  // the list; none when its block draws no lanes (M72).
  const slotOfCommit = (i: number): number | null => {
    const sessionId = commitSession[i] ?? null;
    const base = slotOf.get(`${sessionId ?? ''} 0`);
    if (base === undefined) return null;
    return lineOnly(sessionId) ? base : walkSlot(sessionId, localLane.get(i) ?? 0);
  };
  // A walk lane's slot (M9 fix 374): the session's line for lane 0,
  // else the `t<k>` lane by name, since the commit-less members' lanes
  // sit between.
  const walkSlot = (sessionId: string | null, lane: number): number => (lane === 0 ? slotOf.get(`${sessionId ?? ''} 0`)! : slotOf.get(`${sessionId ?? ''} t${lane}`)!);
  const walkSlotOf = (bi: number, lane: number): number => walkSlot(blocks[bi]!.sessionId, lane);
  const laneOf = (sessionId: string | null, memberId: string | null): number => {
    if (memberId === null || lineOnly(sessionId)) return slotOf.get(`${sessionId ?? ''} 0`)!;
    return slotOf.get(`${sessionId ?? ''} ${memberId}`) ?? slotOf.get(`${sessionId ?? ''} 0`)!;
  };
  const trunkSlot = (bi: number): number => slotOf.get(`${blocks[bi]!.sessionId ?? ''} 0`)!;

  // Where each row goes. A session's own row: above its newest own
  // commit; else above the tip of the branch it sits on, when the log
  // holds it (the new session, a straight stretch to its own dot); else
  // at the top. A member's: above its newest commit; else above the
  // commit its branch sits on (the fork point, dashed); else where its
  // session's own row goes, forking from the commit the session sits
  // on (M9 fix 150: a member with no branch works in the session's own
  // folder, so its lane bends into the session's line at that commit,
  // as one with a branch does at its fork point; in the list it sits
  // on the session's line as before).
  interface Placed {
    sessionId: string;
    session: GraphSession;
    member: TeamMember | null;
    // The commit index the row sits above, or null for the top.
    above: number | null;
    kind: 'tip' | 'fork' | 'line' | 'top' | 'start' | 'head';
    // A member lifted above its session's anchor (M9 fix 944, the user's
    // amendment to rule 2): the commit index the row is drawn above, while
    // `above` keeps the far end its stretch runs down to.
    at?: number;
  }
  const placed: Placed[] = [];
  for (const b of blocks) {
    if (b.session === null || b.sessionId === null || !isDrawn(b.sessionId)) continue;
    const s = b.session;
    const sessionId = b.sessionId;
    const own = commitSession.findIndex((x, i) => x === sessionId && commitMember[i] === null);
    // Where the session began (M9 fix 117): the commit HEAD was at when
    // it spawned, when the log holds it; else the tip of the branch it
    // sits on, the M68 guess for a record from before the daemon kept
    // the start commit. A session with commits of its own is anchored
    // above its newest, and its line runs down to the start (below).
    const started = startIndexOf(s);
    const start = started !== undefined ? started : s.branch === null ? undefined : refRow.get(s.branch);
    // The star sits over the head of the branch the session is on (M9
    // fix 151), usually main's tip, wherever that commit is drawn: its
    // own newest commit is the head's usual place and keeps its kind,
    // as does the start of a session with no commit yet (the M68 guess
    // makes the two one for a record with no start kept); any other
    // head, a member's commit main was fast-forwarded to or someone
    // else's on top, is the `head` kind.
    const head = s.branch === null ? undefined : refRow.get(s.branch);
    const anchor: Pick<Placed, 'above' | 'kind'> = head !== undefined && head !== own && (own !== -1 || head !== start) ? { above: head, kind: 'head' } : own !== -1 ? { above: own, kind: 'tip' } : start !== undefined ? { above: start, kind: 'start' } : { above: null, kind: 'top' };
    // A batch's seats stack above its lead (M9 fix 944, the user's word of
    // 2026-10-20 amending rule 2: "main first and the subagents on top"):
    // a member whose head is older than the commit its session's own row
    // sits over (the head of the lead's branch, main in every batch) is
    // lifted to that row, into the members' block above the session's own
    // row, its stretch running down its own lane past it to its head; one
    // whose head is newer (it has committed past main) stays over its head.
    // A seat merged but still there is lifted too, until it goes. Only a
    // session with a row of its own over its branch's head, in the graph
    // (the write graph's sessions have no branch head to stack over).
    const liftsMembers = hasOwnRow(s) && inRepo(s, roots) && !lineOnly(sessionId) && head !== undefined && anchor.above !== null;
    const placeMember = (m: TeamMember, above: number, kind: 'tip' | 'fork') => {
      const lifted = liftsMembers && above > anchor.above! && !onLine(sessionId, m.id);
      placed.push({ sessionId, session: s, member: m, above, kind, ...(lifted ? { at: anchor.above! } : {}) });
    };
    for (const m of agentsOf(s)) {
      // A member gone with its worktree has no row (M9 fix 946, rule 7).
      if (isGone(m)) continue;
      // A member's star sits over its branch's head whoever made it (M9
      // fix 944, rule 2): the lead's fix-up in a seat's worktree is the
      // seat's head, on the seat's line, and the seat's row goes over it.
      const ref = m.branch === null ? undefined : refRow.get(m.branch);
      if (ref !== undefined && commitSession[ref] === sessionId && !lineOnly(sessionId) && slotOfCommit(ref) === laneOf(sessionId, m.id)) {
        placeMember(m, ref, 'tip');
        continue;
      }
      const tip = commitMember.findIndex((x, i) => x === m.id && commitSession[i] === sessionId);
      if (tip !== -1) {
        placeMember(m, tip, 'tip');
        continue;
      }
      const fork = (m.branch === null ? undefined : refRow.get(m.branch)) ?? anchor.above ?? undefined;
      if (fork !== undefined && !lineOnly(sessionId) && !onLine(sessionId, m.id)) {
        placeMember(m, fork, 'fork');
        continue;
      }
      placed.push({ sessionId, session: s, member: m, above: anchor.above, kind: anchor.kind === 'top' ? 'top' : 'line' });
    }
    if (hasOwnRow(s) && inRepo(s, roots)) placed.push({ sessionId, session: s, member: null, above: anchor.above, kind: anchor.kind });
  }
  // The rows that are not yet landed sit newest session first, and a
  // session's members above its own row (the note's order).
  const bySession = (a: Placed, b: Placed) => b.session.createdAt - a.session.createdAt || (a.member === null ? 1 : 0) - (b.member === null ? 1 : 0);
  const items: GraphItem[] = [];
  const rowOfCommit = new Map<number, number>();
  const agentItem = (p: Placed): AgentItem => {
    const worktree = !lineOnly(p.sessionId) && p.member !== null && slotOf.has(`${p.sessionId} ${p.member.id}`);
    // Commit-less: nothing of its own in the log, whether or not it has
    // a worktree, and whether or not the branch's commit is in the log
    // to fork from (M9 fix 150).
    return {
      kind: 'agent',
      row: items.length,
      lane: worktree && p.member !== null ? laneOf(p.sessionId, p.member.id) : laneOf(p.sessionId, null),
      sessionId: p.sessionId,
      member: p.member,
      working: p.member === null ? p.session.state === 'working' : p.member.outcome === 'running',
      pending: p.member !== null && p.kind !== 'tip',
      forkRow: null,
      forkLane: null,
      tipRow: null,
      tipLane: null,
      restRow: null,
      startRow: null,
    };
  };
  // The sessions on one branch all sit over its head (M9 fix 151), so
  // the session whose own commit the head is keeps its members next to
  // its own row, under the other sessions' rows, rather than having
  // those rows fall between.
  // The lifted members (M9 fix 944) join the first call at their row,
  // whatever their kind, so they sit above their session's own row.
  const pushAgents = (above: number | null, kinds: Placed['kind'][], ordered: boolean, lifted = false) => {
    const here = placed.filter((p) => (p.at ?? p.above) === above && (p.at !== undefined ? lifted : kinds.includes(p.kind)));
    const tipHere = new Set(placed.filter((p) => p.above === above && p.member === null && p.kind === 'tip').map((p) => p.sessionId));
    if (ordered) here.sort((a, b) => (tipHere.has(a.sessionId) ? 1 : 0) - (tipHere.has(b.sessionId) ? 1 : 0) || bySession(a, b));
    for (const p of here) items.push(agentItem(p));
  };
  pushAgents(null, ['top'], true);
  commits.forEach((c, i) => {
    // The rows not landed on this commit first (the fan of commit-less
    // worktrees, the members on the line, the new sessions), then the
    // agents whose newest commit this is, then the commit (the note's
    // assembly rule).
    pushAgents(i, ['fork', 'line', 'start', 'head'], true, true);
    pushAgents(i, ['tip'], false);
    rowOfCommit.set(i, items.length);
    const sessionId = commitSession[i] ?? null;
    const memberId = commitMember[i] ?? null;
    items.push({ kind: 'commit', row: items.length, lane: slotOfCommit(i), commit: c, sessionId, memberId, ...(foreign.has(c.hash) ? { foreign: true as const } : {}) });
  });
  // Now the rows are known, the agents' far ends. A fork out of the
  // commit its session started from, with no commit of the session's own
  // on the line, bends into the session's own lane there, where its bar
  // is, not into the lane the commit sits on; one out of a commit the
  // session's block holds bends into that commit's lane; one out of
  // another block's commit (M9 fix 145) lands where the walk said, the
  // session's own lane 0 under a fork bar (M9 fix 374: the line there
  // has no node of its own, and a fork landing on a bare line read as
  // coming from nowhere, so the landing is marked as the other lane's
  // is; one bar per row and lane however many members land there), or
  // its own lane under a bar.
  const dots: GraphDot[] = [];
  const barred = new Set<string>();
  const forkBar = (row: number, lane: number, sessionId: string, block: number, landing: boolean) => {
    const key = `${row} ${lane}`;
    if (barred.has(key)) return;
    barred.add(key);
    dots.push({ row, lane, sessionId, block, shape: 'bar', kind: 'fork', landing });
  };
  const startRowOf = new Map<string, number>();
  for (const p of placed) {
    if (p.member === null && p.kind === 'start' && p.above !== null) startRowOf.set(p.sessionId, rowOfCommit.get(p.above)!);
  }
  for (const it of items) {
    if (it.kind !== 'agent') continue;
    const p = placed.find((x) => x.member === it.member && x.sessionId === it.sessionId)!;
    if (p.above === null) continue;
    const row = rowOfCommit.get(p.above)!;
    if (p.kind === 'fork') {
      it.forkRow = row;
      const at = items[row] as CommitItem;
      if (startRowOf.get(it.sessionId) === row) it.forkLane = laneOf(it.sessionId, null);
      else if (at.sessionId === it.sessionId && at.lane !== null) it.forkLane = at.lane;
      else {
        const bi = lanes[it.lane]!.block;
        const landings = walkOf.get(bi)?.landings;
        const landing = landings !== undefined && landings.has(p.above) ? landings.get(p.above)! : 0;
        if (landing === 0) {
          it.forkLane = laneOf(it.sessionId, null);
          // M9 fix 399: the fork lands on the session's own bare line,
          // read as coming from nowhere without the bar (M9 fix 374).
          forkBar(row, it.forkLane, it.sessionId, bi, true);
        } else {
          it.forkLane = it.lane;
          // The fork stays on its own lane and ends there, at the
          // commit it came from (M9 fix 145); not a landing.
          forkBar(row, it.lane, it.sessionId, bi, false);
        }
      }
    } else if (p.kind === 'start') it.startRow = row;
    else if (p.kind === 'head') {
      // The session's row over its branch's head (M9 fix 151): the
      // stretch ends on the head's node when the block holds it,
      // bending into its lane, else at the head's row on the session's
      // own lane, the head being another session's commit (open question
      // 1 of M9 fix 945: the earlier session's square). Below that the
      // stretch goes on down to the session's newest own commit, or to
      // its start bar when it has none, so the lane stays one piece. The
      // head bar that sat there went with M9 fix 945 (rule 5): a commit
      // nobody made on the line is the session's square now.
      it.tipRow = row;
      const at = items[row] as CommitItem;
      if (at.sessionId === it.sessionId && at.lane !== null) it.tipLane = at.lane;
      else {
        // On the session's own line (M9 fix 944): the lead's commits off
        // it, on a seat's lane or a side lane, are not where it rests.
        const own = items.find((x): x is CommitItem => x.kind === 'commit' && x.row > row && x.sessionId === it.sessionId && x.memberId === null && x.lane === it.lane);
        const started = startIndexOf(p.session);
        if (own !== undefined) it.restRow = own.row;
        else if (started !== undefined && rowOfCommit.get(started)! > row) it.startRow = rowOfCommit.get(started)!;
      }
    } else {
      it.tipRow = row;
      // A member's head drawn on another lane than its row's (M9 fix
      // 944): the stretch bends into it there, as fix 151's does.
      const at = items[row] as CommitItem;
      if (p.kind === 'tip' && at.lane !== null && at.lane !== it.lane) it.tipLane = at.lane;
    }
  }
  for (const it of items) {
    if (it.kind === 'agent' && it.member === null && it.startRow !== null) dots.push({ row: it.startRow, lane: it.lane, sessionId: it.sessionId, block: lanes[it.lane]!.block, shape: 'bar', kind: 'start' });
  }
  // A session with commits of its own and its start commit in the log
  // (M9 fix 117): a bar on its own lane at that row, and its line runs
  // down to it (below), so the lane says where the session began. The
  // bar is only placed below the oldest of the commits it must sit below
  // (see commitsTheBarSitsBelow, beside spanCommits): a start commit
  // above one (a rebase moved the commits under it) draws nothing more.
  const startRowOfSession = new Map<string, number>();
  for (const b of blocks) {
    if (b.session === null || b.sessionId === null || !isDrawn(b.sessionId)) continue;
    const started = startIndexOf(b.session);
    if (started === undefined) continue;
    const lane = laneOf(b.sessionId, null);
    const barFloor = commitsTheBarSitsBelow(b.session);
    // A square (M9 fix 945) lies above the start commit by its making, so
    // the bar sits below it as below the session's own.
    const own = items.filter((it): it is CommitItem => it.kind === 'commit' && it.lane === lane && (barFloor.has(it.commit.hash) || (it.foreign === true && it.sessionId === b.sessionId)));
    const oldest = own[own.length - 1];
    const row = rowOfCommit.get(started)!;
    if (oldest === undefined || row <= oldest.row) continue;
    startRowOfSession.set(b.sessionId, row);
    dots.push({ row, lane, sessionId: b.sessionId, block: lanes[lane]!.block, shape: 'bar', kind: 'start' });
  }
  // The walks' bars (M9 fix 145): a lane that ended beside another
  // block's commit, and how far each block's line reaches to meet the
  // lanes that landed on it.
  const reachOf = new Map<number, number>();
  for (const [bi, walk] of walkOf) {
    const b = blocks[bi]!;
    for (const bar of walk.bars) dots.push({ row: rowOfCommit.get(bar.index)!, lane: walkSlotOf(bi, bar.lane), sessionId: b.sessionId, block: bi, shape: 'bar', kind: 'fork' });
    if (walk.reach !== undefined) reachOf.set(bi, rowOfCommit.get(walk.reach)!);
  }

  // The lines. The parent edges first (M68): the same lane is a straight
  // segment (a session's own line is drawn whole below, so its segments
  // are left out), a first-parent edge across lanes runs down the
  // child's lane and curves into the parent's at the fork, and a
  // merge's edge runs up the parent's lane and curves into the merge
  // commit. Then per lane the session's own line, M65's merge-back where
  // the walk drew no fork for an unmerged worktree, and the agents'
  // dashed stretches.
  const lines: GraphLine[] = [];
  const rowOfIndex = (i: number) => rowOfCommit.get(i)!;
  const mergedTips = new Set<number>();
  const forkedTails = new Set<number>();
  for (const e of edges) {
    const child = items[rowOfIndex(e.child)] as CommitItem;
    const parent = items[rowOfIndex(e.parent)] as CommitItem;
    // An edge comes from a drawn block's walk, so the child has a lane;
    // a parent in another block (M9 fix 145) ends on the lane the walk
    // gave the edge, in the child's block, whatever that block draws.
    if (child.lane === null) continue;
    const bi = lanes[child.lane]!.block;
    const parentLane = e.lane === undefined ? parent.lane : walkSlotOf(bi, e.lane);
    if (parentLane === null) continue;
    if (child.lane === parentLane) {
      // A lane that ends under a bar found its fork point, elsewhere,
      // so no merge-back is promised for it either.
      if (e.bend === 'end') forkedTails.add(e.child);
      if (child.lane === trunkSlot(bi)) continue;
      lines.push({ kind: blocks[bi]!.sessionId === null ? 'outside' : 'worktree', lane: child.lane, fromRow: child.row, toRow: parent.row, toLane: null, dashed: false, block: bi });
    } else if (e.bend === 'end') {
      forkedTails.add(e.child);
      lines.push({ kind: 'branch', lane: child.lane, fromRow: child.row, toRow: parent.row, toLane: parentLane, dashed: false, block: bi });
    } else {
      mergedTips.add(e.parent);
      lines.push({ kind: 'merge', lane: parentLane, fromRow: parent.row, toRow: child.row, toLane: child.lane, dashed: false, block: bi });
    }
  }
  for (const lane of lanes) {
    const mine = items.filter((it) => it.lane === lane.slot);
    const commitsHere = mine.filter((it): it is CommitItem => it.kind === 'commit');
    const newest = commitsHere[0];
    const oldest = commitsHere[commitsHere.length - 1];
    if (lane.sessionId === null) {
      // The grey trunk whole, newest to oldest; the side lanes are the
      // edges' already.
      if (lane.slot === trunkSlot(lane.block) && newest !== undefined && oldest !== undefined && newest !== oldest) lines.push({ kind: 'outside', lane: lane.slot, fromRow: newest.row, toRow: oldest.row, toLane: null, dashed: false, block: lane.block });
      continue;
    }
    // The agents' dashed stretches, after the lane's own lines.
    const agentLines: GraphLine[] = [];
    for (const it of mine) {
      if (it.kind !== 'agent') continue;
      // The fork is the graph's alone (the list has no worktree lanes to
      // fork into); the pending stretch above a lane's newest commit is
      // drawn dashed in both, since dashed means "not landed yet" in
      // either picture (M9 fix 118: the list used to run the solid line
      // up over it). In the list every row of the session shares one
      // lane, so a member whose newest commit sits inside the solid
      // line gets no dashed stretch of its own there; one anchored at
      // or above the lane's newest commit (a branchless member under
      // the session's row, M9 fix 150) keeps its stretch.
      // A fork that ends on its own lane, under a bar (M9 fix 145), is a
      // straight stretch with no far lane.
      // A session's own stretch (M9 fix 151) ends on its branch's head,
      // bending into the head's lane when the block holds the commit
      // elsewhere than on the line; under a head bar it goes on down
      // to the newest own commit, or to the start bar, and that part is
      // solid (M9 fix 176): dashed is the air above the head the next
      // commit falls through, and everything under the head has landed.
      if (!lineOnly(lane.sessionId) && it.pending && it.forkRow !== null && it.forkLane !== null) agentLines.push({ kind: 'fork', lane: lane.slot, fromRow: it.row, toRow: it.forkRow, toLane: it.forkLane === lane.slot ? null : it.forkLane, dashed: true, block: lane.block });
      else {
        if (it.tipRow !== null && (it.member === null || !lineOnly(lane.sessionId) || newest === undefined || it.tipRow <= newest.row)) agentLines.push({ kind: 'pending', lane: lane.slot, fromRow: it.row, toRow: it.tipRow, toLane: it.tipLane === null || it.tipLane === lane.slot ? null : it.tipLane, dashed: true, block: lane.block });
        if (it.tipRow !== null && it.restRow !== null) agentLines.push({ kind: 'pending', lane: lane.slot, fromRow: it.tipRow, toRow: it.restRow, toLane: null, dashed: false, block: lane.block });
        if (it.startRow !== null) agentLines.push({ kind: 'start', lane: lane.slot, fromRow: it.tipRow ?? it.row, toRow: it.startRow, toLane: null, dashed: it.tipRow === null, block: lane.block });
      }
    }
    const trunk = trunkSlot(lane.block);
    if (lineOnly(lane.sessionId) || lane.slot === trunk) {
      // The session's own line: from its newest commit down to its
      // oldest, or on to its start dot (M9 fix 117), and no further
      // (M68: the line stops at the lowest dot, as the grey one does);
      // the same in the list, where the rows above the newest commit
      // are the dashed stretches (M9 fix 118). A session with no commit
      // draws none: its lane is the start stretch and the dot.
      const reach = reachOf.get(lane.block);
      // The lowest of the bar and every own commit, not just the ones
      // commitsTheBarSitsBelow counts (above, beside spanCommits): the
      // bar sits below the oldest of those, so this reads as it always
      // did, except for a commit claimed before Claude (M9 fix 400),
      // which that helper leaves out and this line goes on past the bar
      // to reach.
      const startRow = startRowOfSession.get(lane.sessionId);
      const end = startRow === undefined ? oldest?.row : oldest === undefined ? startRow : Math.max(startRow, oldest.row);
      const last = end === undefined ? reach : reach === undefined ? end : Math.max(end, reach);
      if (newest !== undefined && last !== undefined && newest.row !== last) lines.push({ kind: 'session', lane: lane.slot, fromRow: newest.row, toRow: last, toLane: null, dashed: false, block: lane.block });
      lines.push(...agentLines);
      continue;
    }
    if (newest !== undefined && oldest !== undefined) {
      const newestIndex = commits.indexOf(newest.commit);
      const oldestIndex = commits.indexOf(oldest.commit);
      // M65's merge-back, for a worktree the session has not merged and
      // the walk could not fork (its fork point is outside the block):
      // into the session's own line at its first commit below the
      // worktree's oldest, or its start dot there. With nothing of the
      // session's below there is nothing to join, so the lane ends at
      // its oldest commit (M68; it used to run off the bottom).
      if (!mergedTips.has(newestIndex) && !forkedTails.has(oldestIndex)) {
        const trunkRows = [...items.filter((it): it is CommitItem => it.kind === 'commit' && it.lane === trunk).map((it) => it.row), ...dots.filter((d) => d.lane === trunk).map((d) => d.row)].sort((a, b) => a - b);
        const below = trunkRows.find((r) => r > oldest.row);
        if (below !== undefined) lines.push({ kind: 'merge', lane: lane.slot, fromRow: oldest.row, toRow: below, toLane: trunk, dashed: false, block: lane.block });
      }
    }
    lines.push(...agentLines);
  }

  // A star beside its line (M9 fix 946, rule 10). A member's row whose own
  // stretch shares its lane with another line of the block, or passes a
  // commit on it, has a line running through its star: a merged seat that
  // still exists, its row stacked above the lead's (M9 fix 944) and its
  // stretch running down its lane past the merge line coming up it. The
  // row moves to a lane of its own inserted right after the member's, its
  // stretch one dashed fork down that lane bending into the member's line
  // at its head (the short bend a commit-less member's fork draws), and
  // the lanes to its right move over one. The crossings are read before
  // any lane is inserted, and the insertions go right to left by slot, so
  // one never moves the next one's target. The list has no member lanes,
  // and a member on the session's own line (M9 fix 907's, or one with no
  // lane) shares it with the session's stretch by design, so neither moves.
  const spanOfLine = (l: GraphLine): [number, number] => {
    const to = l.toRow === 'bottom' ? items.length : l.toRow;
    return [Math.min(l.fromRow, to), Math.max(l.fromRow, to)];
  };
  const stretchOf = (it: AgentItem): GraphLine[] => lines.filter((l) => l.lane === it.lane && l.fromRow === it.row);
  const besides: AgentItem[] = [];
  for (const it of items) {
    if (it.kind !== 'agent' || it.member === null || lineOnly(it.sessionId) || it.lane === trunkSlot(lanes[it.lane]!.block)) continue;
    const own = stretchOf(it);
    if (own.length === 0) continue;
    const lo = it.row;
    const hi = Math.max(...own.map((l) => spanOfLine(l)[1]));
    const crossed =
      lines.some((l) => {
        if (l.lane !== it.lane || own.includes(l)) return false;
        const [a, b] = spanOfLine(l);
        return Math.max(a, lo) < Math.min(b, hi);
      }) || items.some((x) => x.kind === 'commit' && x.lane === it.lane && x.row > lo && x.row < hi);
    if (crossed) besides.push(it);
  }
  besides.sort((x, y) => y.lane - x.lane);
  for (const it of besides) {
    const k = it.lane;
    const memberLane = lanes[k]!;
    const bi = memberLane.block;
    const own = stretchOf(it);
    const far = Math.max(...own.map((l) => spanOfLine(l)[1]));
    const farLane = it.pending ? it.forkLane : it.tipLane;
    const up = (slot: number) => (slot > k ? slot + 1 : slot);
    lanes.splice(k + 1, 0, { ...memberLane, side: true });
    lanes.forEach((l, i) => {
      l.slot = i;
    });
    for (const x of items) {
      if (x.lane !== null) x.lane = up(x.lane);
      if (x.kind !== 'agent') continue;
      if (x.forkLane !== null) x.forkLane = up(x.forkLane);
      if (x.tipLane !== null) x.tipLane = up(x.tipLane);
    }
    for (const l of lines) {
      l.lane = up(l.lane);
      if (l.toLane !== null) l.toLane = up(l.toLane);
    }
    for (const d of dots) d.lane = up(d.lane);
    // The packing's width is the block's key count.
    const keys = blocks[bi]!.laneKeys;
    keys.splice(k - lanes.findIndex((l) => l.block === bi) + 1, 0, `side:${it.member!.id}`);
    for (const l of own) lines.splice(lines.indexOf(l), 1);
    const toLane = farLane === null || farLane === k ? k : up(farLane);
    it.lane = k + 1;
    it.forkRow = far;
    it.forkLane = toLane;
    it.beside = true;
    lines.push({ kind: 'fork', lane: k + 1, fromRow: it.row, toRow: far, toLane, dashed: true, block: bi });
  }

  // The columns (M71). Up to here every block has slots of its own in
  // block order, so a repository with many sessions is as wide as their
  // lanes summed. Blocks whose rows do not overlap can share a column:
  // each block's span is the lowest and highest row anything of its
  // touches (its rows, its lines' two ends, its dots), and the session
  // and history blocks pack first-fit in block order into column
  // groups, a block joining the first group none of whose blocks' spans
  // come within a row of its own (one row of clearance, so a merge
  // curve never meets a neighbour's start); a group is as wide as its
  // widest block. The grey outside block spans the whole log and never
  // packs, so it keeps a group of its own at the far side. Then every
  // lane index is remapped from the block's old slots to the group's
  // base plus the lane's place in its block, and the gap the drawing
  // puts between blocks is put between groups instead.
  const spans = blocks.map(() => ({ lo: Infinity, hi: -Infinity }));
  const widen = (bi: number, row: number) => {
    const sp = spans[bi]!;
    if (row < sp.lo) sp.lo = row;
    if (row > sp.hi) sp.hi = row;
  };
  for (const it of items) if (it.lane !== null) widen(lanes[it.lane]!.block, it.row);
  for (const l of lines) {
    widen(l.block, l.fromRow);
    widen(l.block, l.toRow === 'bottom' ? items.length : l.toRow);
  }
  for (const d of dots) widen(d.block, d.row);
  const firstSlot = blocks.map((_, bi) => lanes.find((l) => l.block === bi)?.slot ?? 0);
  const groups: Array<{ blocks: number[]; width: number }> = [];
  const groupOf = blocks.map(() => -1);
  const apart = (a: number, b: number) => spans[a]!.hi + 1 < spans[b]!.lo || spans[b]!.hi + 1 < spans[a]!.lo;
  blocks.forEach((b, bi) => {
    if (b.laneKeys.length === 0 || b.sessionId === null) return;
    let gi = groups.findIndex((g) => g.blocks.every((o) => apart(o, bi)));
    if (gi === -1) gi = groups.push({ blocks: [], width: 0 }) - 1;
    groups[gi]!.blocks.push(bi);
    groups[gi]!.width = Math.max(groups[gi]!.width, b.laneKeys.length);
    groupOf[bi] = gi;
  });
  blocks.forEach((b, bi) => {
    if (b.laneKeys.length === 0 || b.sessionId !== null) return;
    groupOf[bi] = groups.push({ blocks: [bi], width: b.laneKeys.length }) - 1;
  });
  const base: number[] = [];
  let columns = 0;
  for (const g of groups) {
    base.push(columns);
    columns += g.width;
  }
  const newSlot = new Map<number, number>();
  for (const l of lanes) {
    newSlot.set(l.slot, base[groupOf[l.block]!]! + (l.slot - firstSlot[l.block]!));
  }
  const remap = (slot: number) => newSlot.get(slot)!;
  for (const l of lanes) {
    l.slot = remap(l.slot);
    l.group = groupOf[l.block]!;
  }
  for (const it of items) if (it.lane !== null) it.lane = remap(it.lane);
  for (const l of lines) {
    l.lane = remap(l.lane);
    if (l.toLane !== null) l.toLane = remap(l.toLane);
  }
  for (const d of dots) d.lane = remap(d.lane);
  for (const it of items) {
    if (it.kind !== 'agent') continue;
    if (it.forkLane !== null) it.forkLane = remap(it.forkLane);
    if (it.tipLane !== null) it.tipLane = remap(it.tipLane);
  }
  // The drawn row range (M9 fix 211), off the same spans the packing
  // read: a block with no lanes has an empty span and drops out.
  let drawnRows: SessionGraph['drawnRows'] = null;
  for (const sp of spans) {
    if (sp.lo === Infinity) continue;
    const hi = Math.min(sp.hi, items.length - 1);
    drawnRows = drawnRows === null ? { from: sp.lo, to: hi } : { from: Math.min(drawnRows.from, sp.lo), to: Math.max(drawnRows.to, hi) };
  }
  const blockList: GraphBlock[] = blocks.map((b) => {
    const transcriptId = historyIdOf(b.sessionId);
    return { sessionId: b.sessionId, color: b.session?.color ?? null, gone: typeof b.session?.removedAt === 'number', history: transcriptId === null || b.session === null ? null : { transcriptId, title: b.session.name }, person: personOf(b.sessionId), remote: remoteOf(b.sessionId), layout: lineOnly(b.sessionId) ? 'line' : 'graph', drawn: isDrawn(b.sessionId) };
  });
  return { items, lanes, blocks: blockList, columns, groups: groups.length, lines, dots, drawnRows };
}

interface TopologyEdge {
  // Commit indices in the log, child above parent.
  child: number;
  parent: number;
  // Where the edge changes lane when the two differ: right above the
  // parent (a branch folding into the line it forked from) or right
  // under the child (a merge reaching into its second parent's lane).
  bend: 'end' | 'start';
  // The block's lane the parent's end lands on when the parent is
  // another block's commit (M9 fix 145): lane 0 when the trunk waits
  // there or its own chain passes through the commit, else the lowest
  // lane reserved for it, under a bar. Absent for a parent in the
  // block, whose own lane is the end.
  lane?: number;
}

interface Topology {
  laneOf: Map<number, number>;
  edges: TopologyEdge[];
  laneCount: number;
  // The bars (M9 fix 145): the commit index and lane of each lane end
  // that landed beside another block's commit rather than on the trunk.
  bars: Array<{ index: number; lane: number }>;
  // Where each watched row landed: 0 for the trunk, null for its own
  // lane under a bar.
  landings: Map<number, number | null>;
  // The oldest commit index a side lane or a watched row landed on the
  // trunk at, for the session's line to reach.
  reach: number | undefined;
}

// Lane 0 while nothing is on its way there: the trunk's place is kept,
// and a commit the trunk may hold (a session's own, or any of the grey
// block's) falls back onto it when its chain has left the block.
const NOBODY = ' ';

// The classic walk (M51's, scoped to one block's commits, newest first):
// a commit takes the trunk when it is waiting and the commit may sit
// there, else the lowest lane a child reserved for it, else the lowest
// free lane, and every lane reserved for it ends there; it then
// reserves its own lane for its first parent (even when another child
// already reserved one, so a branch runs down its own lane and curves
// into the parent at the parent's row) and, for each other parent nobody
// has reserved, the lowest free lane. A parent outside the block
// reserves nothing and draws no edge. Lane 0 is the trunk: it waits for
// the seed when there is one, is never handed out as a free lane, and
// when nothing is reserved for it takes the next commit trunkAllowed
// says may sit there, so a session's own commits stay on its line when
// their chain runs through another block (two sessions taking turns on
// main) and only an own commit beside a live chain opens a side lane.
// The trunk is the first question (M9 fix 131): a member's commit on
// top of the session's own, with no own commit above it, takes a side
// lane and reserves its parent there, and when the reservation was
// asked before the trunk the own commit answered it and dragged the
// session's whole chain onto the side lane, its star a lane apart from
// its commits. Asked first, the waiting trunk takes the own commit, the
// release below drops the side reservation, and the member's edge bends
// into the trunk at its parent's row. Nothing moves when the trunk is
// taken or reserved, and a lane a merge reserved for its second parent
// holds whatever the trunk is doing: a merge commit whose first parent
// is outside the block leaves the trunk waiting, and the branch it
// merged would otherwise slide onto the trunk under it and the merge
// curve draw as a straight line. The sentinel goes back the moment the
// trunk's reservation is spent, before the parents ask for lanes (M9
// fix 144): put back after them, a merge commit the trunk had waited
// for whose first parent is outside the block left lane 0 null for its
// second parent to take, so the merged branch drew as the trunk and the
// session's own chain below it opened a side lane. And a commit on a
// lane a merge opened keeps it when its first parent is outside the
// block: it is the branch's last commit here, not the fork point, and
// the waiting trunk would otherwise take it and draw the branch as
// rejoining the session's line where it left the block. A member's
// lane is not one a merge opened, so fix 131's rule stands there.
//
// A parent in the log but in another block (M9 fix 145) is reserved on
// its lane like any other, so the lane is held down to that row and
// nothing reuses it in between, and the walk visits that row too, in
// order with the block's own, to free every lane holding the hash and
// give each one's edge the lane it lands on: lane 0 when the trunk is
// waiting or the trunk's own chain reserved the same hash (the fork
// point is on the session's line, which runs through that row with no
// node), else, when lane 0 carries a different chain of the session's
// there, the lowest lane that reserved it, where a bar says the branch
// came from a commit elsewhere. The row gets no lane of its own and no
// node. The trunk's own chain is followed through the rows it owns
// nothing on: at such a row lane 0 is reserved again for the row's
// first parent, so "the same hash" keeps meaning "on the session's
// first-parent ancestry" however many of another block's commits sit
// on it, and the trunk only goes back to waiting when the chain leaves
// the log. The watched rows (a commit-less member's fork point in
// another block) are visited the same way, so the fork learns where to
// land off the same rule. A block with nothing on lane 0 at all (no
// own commit and no start bar) has no line to land on, so its lanes
// end under bars there. A parent not in the log at all still reserves
// nothing and draws no edge.
function blockTopology(indices: readonly number[], commits: readonly GraphCommit[], rowOf: ReadonlyMap<string, number>, seed: string | null, trunkAllowed: (i: number) => boolean, watch: readonly number[] = [], trunkDrawn = true): Topology {
  const inBlock = new Set(indices);
  const reserved: Array<string | null> = [seed ?? NOBODY];
  const mergedIn = new Set<string>();
  const sideLanes = new Set<number>();
  const laneOf = new Map<number, number>();
  const edges: TopologyEdge[] = [];
  const bars: Topology['bars'] = [];
  const landings = new Map<number, number | null>();
  let reach: number | undefined;
  const lowestFree = (): number => {
    const i = reserved.indexOf(null);
    if (i !== -1) return i;
    reserved.push(null);
    return reserved.length - 1;
  };
  // The rows outside the block still to visit, in order, and what each
  // one's children reserved: a claim per edge, with the bend and the
  // lane it was reserved on.
  const watched = new Set(watch.filter((r) => !inBlock.has(r)));
  const foreign = [...watched].sort((a, b) => a - b);
  const visit = (pi: number) => {
    if (foreign.includes(pi)) return;
    const at = foreign.findIndex((r) => r > pi);
    foreign.splice(at === -1 ? foreign.length : at, 0, pi);
  };
  const claims = new Map<number, Array<{ child: number; bend: TopologyEdge['bend']; lane: number }>>();
  const claim = (pi: number, entry: { child: number; bend: TopologyEdge['bend']; lane: number }) => {
    const list = claims.get(pi);
    if (list === undefined) claims.set(pi, [entry]);
    else list.push(entry);
    visit(pi);
  };
  const release = (hash: string) => {
    for (let k = 0; k < reserved.length; k++) if (reserved[k] === hash) reserved[k] = null;
    if (reserved[0] === null) reserved[0] = NOBODY;
  };
  const visitForeign = (fi: number) => {
    const c = commits[fi]!;
    const held: number[] = [];
    reserved.forEach((h, k) => {
      if (h === c.hash) held.push(k);
    });
    const side = held.filter((k) => k !== 0);
    const following = reserved[0] === c.hash;
    const onTrunk = following || (reserved[0] === NOBODY && trunkDrawn);
    const target = onTrunk ? 0 : (side[0] ?? null);
    for (const cl of claims.get(fi) ?? []) edges.push({ child: cl.child, parent: fi, bend: cl.bend, lane: target ?? cl.lane });
    if (!onTrunk && side.length > 0) bars.push({ index: fi, lane: side[0]! });
    else if (onTrunk && (side.length > 0 || watched.has(fi))) reach = reach === undefined ? fi : Math.max(reach, fi);
    if (watched.has(fi)) landings.set(fi, target);
    release(c.hash);
    for (const k of sideLanes) if (reserved[k] === null) sideLanes.delete(k);
    if (!following || c.parents.length === 0) return;
    const fp = c.parents[0]!;
    const fpi = rowOf.get(fp);
    if (fpi === undefined || fpi <= fi) return;
    reserved[0] = fp;
    if (!inBlock.has(fpi)) visit(fpi);
  };
  let next = 0;
  while (next < indices.length || foreign.length > 0) {
    if (foreign.length > 0 && (next >= indices.length || foreign[0]! < indices[next]!)) {
      visitForeign(foreign.shift()!);
      continue;
    }
    const i = indices[next++]!;
    const c = commits[i]!;
    const held = reserved.indexOf(c.hash);
    const firstParent = c.parents.length === 0 ? undefined : rowOf.get(c.parents[0]!);
    const lastOfBranch = sideLanes.has(held) && (firstParent === undefined || !inBlock.has(firstParent));
    const keeps = held !== -1 && (mergedIn.has(c.hash) || lastOfBranch);
    let lane = keeps ? held : reserved[0] === NOBODY && trunkAllowed(i) ? 0 : held;
    if (lane === -1) lane = lowestFree();
    release(c.hash);
    laneOf.set(i, lane);
    c.parents.forEach((p, k) => {
      const pi = rowOf.get(p);
      if (pi === undefined) return;
      const inside = inBlock.has(pi);
      // A row above the child is not a parent the log's order can draw.
      if (!inside && pi <= i) return;
      if (k === 0) {
        reserved[lane] = p;
        if (inside) edges.push({ child: i, parent: pi, bend: 'end' });
        else claim(pi, { child: i, bend: 'end', lane });
      } else {
        let side = reserved.indexOf(p);
        if (side === -1) {
          side = lowestFree();
          reserved[side] = p;
          sideLanes.add(side);
        }
        mergedIn.add(p);
        if (inside) edges.push({ child: i, parent: pi, bend: 'start' });
        else claim(pi, { child: i, bend: 'start', lane: side });
      }
    });
    for (const k of sideLanes) if (reserved[k] === null) sideLanes.delete(k);
  }
  return { laneOf, edges, laneCount: reserved.length, bars, landings, reach };
}

export type BranchSession = Pick<SessionInfo, 'id' | 'branch' | 'color' | 'state' | 'team'> & Partial<Pick<SessionInfo, 'commits'>>;

// The agents a session's commits still name once they have left the
// team (M9 fix 138): one stand-in member per agent id on the folded
// commits that the live team does not hold, returned, spanning its
// commits, with the branch and label the record kept, so the lane, its
// pill and the commit's card draw as they did while the member was
// out. A stand-in gets no row of its own (the row is for an agent that
// is or was just there), which the placement skips by this list.
export function foldedAgents(s: Pick<SessionInfo, 'team'> & Partial<Pick<SessionInfo, 'commits'>>): TeamMember[] {
  const live = new Set(s.team.map((m) => m.id));
  const byId = new Map<string, TeamMember>();
  for (const c of s.commits ?? []) {
    const a = c.agent;
    if (a === undefined || live.has(a.id)) continue;
    const m = byId.get(a.id);
    if (m === undefined) {
      byId.set(a.id, { id: a.id, kind: 'agent', type: a.type, description: a.description, command: null, startedAt: c.at, endedAt: c.at, outcome: 'returned', cwd: null, branch: a.branch, commits: [{ hash: c.hash, at: c.at }], activity: null });
    } else {
      m.commits.push({ hash: c.hash, at: c.at });
      m.startedAt = Math.min(m.startedAt, c.at);
      m.endedAt = Math.max(m.endedAt ?? c.at, c.at);
    }
  }
  return [...byId.values()];
}

// A subagent on a branch (M61): a member of a session's team whose own
// Bash calls ran in a worktree on that branch. Its pill opens the
// parent's card with the agent named (M9 fix 110).
export interface LaneAgent {
  sessionId: string;
  memberId: string;
  label: string;
  working: boolean;
  color: string | null;
}

// The branch no session is on that a subagent is: per branch, the member
// on it, a running one before a returned one and the newest among those,
// so the label follows the agent still out there. A branch a session of
// its own sits on is the session's, never an agent's, however many of
// its members work there too.
export function laneAgents(branches: Iterable<string | null>, sessions: readonly BranchSession[]): Map<string, LaneAgent> {
  const agents = new Map<string, LaneAgent>();
  for (const b of branches) {
    if (b === null || agents.has(b)) continue;
    const name: string = b;
    if (sessions.some((s) => s.branch === name)) continue;
    let best: { session: BranchSession; member: TeamMember } | null = null;
    for (const s of sessions) {
      for (const m of [...s.team, ...foldedAgents(s)]) {
        if (m.kind !== 'agent' || m.branch !== name) continue;
        if (best === null || rank(m) > rank(best.member)) best = { session: s, member: m };
      }
    }
    if (best === null) continue;
    const { session, member } = best;
    agents.set(name, { sessionId: session.id, memberId: member.id, label: member.description ?? member.type ?? 'agent', working: member.outcome === 'running', color: session.color });
  }
  return agents;
}

function rank(m: TeamMember): number {
  return (m.outcome === 'running' ? 1e15 : 0) + m.startedAt;
}

// The session a branch's pill stands for (M60), for the card a hover on
// the pill opens: the first session on the branch with a colour, else
// the first on it at all, else the parent of the subagent working on it
// (M61), else nothing.
export function laneSessions<S extends BranchSession & { id: string }>(branches: Iterable<string | null>, sessions: readonly S[]): Map<string, S> {
  const out = new Map<string, S>();
  const list = [...branches];
  const agents = laneAgents(list, sessions);
  for (const b of list) {
    if (b === null || out.has(b)) continue;
    const name: string = b;
    const parent = agents.get(name)?.sessionId;
    const s = sessions.find((x) => x.branch === name && x.color !== null) ?? sessions.find((x) => x.branch === name) ?? (parent === undefined ? undefined : sessions.find((x) => x.id === parent));
    if (s !== undefined) out.set(b, s);
  }
  return out;
}

// The agent's name on a row and a card: its description, else its type.
export function agentLabel(m: TeamMember): string {
  return m.description ?? m.type ?? 'agent';
}

// The role pill on a member's row and its card (M9 fix 373): `subagent`,
// then the word Claude Code names the agent by when the record has one
// (`subagent · fork`), the sidebar's own vocabulary for the type
// (memberParts in shared/team.ts says `agent fork`) and no other.
export function agentRole(m: TeamMember): string {
  return m.type === null ? 'subagent' : `subagent · ${m.type}`;
}

// The graph to show against a read that came back empty (M9 fix 210).
// gitGraph answers any failure with the root kept and no commits (a
// timeout under load, git cut off mid-read), and the panel used to take
// that at its word: the view unmounted on "No commits yet" and the next
// read mounted it afresh, parking the scroll at the tip again. So an
// empty read on the same root keeps the last graph that had commits; a
// repository that never had a commit shows nothing, since there was
// never a graph to hold, and a change of root drops the hold.
export function holdGraph<G extends { root: string | null; commits: readonly unknown[] }>(prev: G, next: G): G {
  if (next.commits.length > 0 || prev.commits.length === 0) return next;
  return prev.root === next.root ? prev : next;
}
