import { describeState, folderName, formatDuration } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import type { ConflictReport } from '@emerald/shared';
import type { GitCommit, HistoryTranscript } from '../../preload/api.ts';
import { baseLine, conflictLines } from './conflict-model.ts';
import type { BaseLine, ConflictLine, ConflictPeer } from './conflict-model.ts';

// The text of the lane card (M60): what a hover on a session's lane in
// the Commits tab, a pill on the graph or a row's owner dot says about
// the session, and which ways to it are offered. Pure, so the card
// renders it and the tests read it. A removed session (M57) is one the
// daemon keeps only as a record, with `removedAt` set; it is still
// resumable through its conversation, so the card treats it as exited.

// A stand-in for an earlier conversation span of a record (M9 fix 185)
// carries when the span ended, so the state line says so rather than
// "removed"; its resume goes through the conversation as a removed
// session's does.
export type LaneCardSession = SessionInfo & { removedAt?: number | null; spanEndedAt?: number | null };

// The label M61 adds on a subagent's lane: the card then opens on the
// parent with the agent named at the top.
export interface LaneCardAgent {
  label: string;
  memberId: string;
}

export interface LaneCardModel {
  name: string;
  state: { text: string; tone: string | undefined };
  // The branch the session is on, else the live folder's name.
  where: { kind: 'branch' | 'folder'; text: string } | null;
  // The commits of the session's own in the shown log, the newest first.
  count: number;
  newest: { hash: string; subject: string; age: string } | null;
  // `color` (M9 fix 134): the Colour row, for a record the daemon still
  // lists, live or exited; a removed one answers session.set not-found.
  actions: { show: boolean; resume: boolean; transcript: boolean; color: boolean };
  // The conversation the Transcript action reveals, when one is known.
  conversationId: string | null;
  // The conflict forecast's lines (M9 fix 320): one per other lane the
  // session's branch would conflict with, and the base line against
  // the default branch, always present for a live session with a
  // branch the daemon has read. Both empty from a daemon before level
  // 52, and for an exited or removed session, which left the forecast.
  conflicts: ConflictLine[];
  base: BaseLine | null;
}

// What the card reads the forecast with: the daemon's report and the
// sessions' names and colours, since the other lane is named in its own.
export interface LaneCardForecast {
  report: ConflictReport;
  peers: ReadonlyMap<string, ConflictPeer>;
}

export function laneCardModel(session: LaneCardSession, shown: readonly GitCommit[], now: number, forecast: LaneCardForecast | null = null): LaneCardModel {
  const removed = session.removedAt !== undefined && session.removedAt !== null;
  const gone = removed || session.state === 'exited';
  const own = new Set(session.commits.map((c) => c.hash));
  const mine = shown.filter((c) => own.has(c.hash));
  // The log is newest first; the session's newest is the first hit.
  const newest = mine[0] ?? null;
  const label = describeState(session);
  // A plain shell at its prompt has no state word anywhere else (M22).
  const state: LaneCardModel['state'] = session.spanEndedAt !== undefined && session.spanEndedAt !== null
    ? { text: `ended ${formatDuration(session.spanEndedAt, now)} ago`, tone: 'exited' }
    : removed
    ? { text: `removed ${formatDuration(session.removedAt!, now)} ago`, tone: 'exited' }
    : session.kind === 'shell' && session.state === 'idle'
      ? { text: 'shell', tone: undefined }
      : { text: label.text, tone: label.tone };
  const folder = folderName(session.cwd);
  const conversationId = session.claudeSessionId ?? session.conversation?.id ?? null;
  return {
    name: session.name,
    state,
    where: session.branch !== null ? { kind: 'branch', text: session.branch } : folder === '' ? null : { kind: 'folder', text: folder },
    count: mine.length,
    newest: newest === null ? null : { hash: newest.hash, subject: newest.subject, age: formatDuration(newest.at, now) },
    actions: {
      show: !gone,
      // A removed session resumes only through its conversation; an exited
      // one the daemon still lists resumes under its own id, shell or not.
      resume: removed ? session.conversation !== null : session.state === 'exited',
      transcript: conversationId !== null,
      color: !removed,
    },
    conversationId,
    conflicts: forecast === null || gone ? [] : conflictLines(session.id, forecast.report.conflicts, forecast.peers),
    base: forecast === null || gone ? null : baseLine(forecast.report.base[session.id], now),
  };
}

// The words for the count line: `3 commits here, the newest 2m ago`.
export function commitsLine(model: LaneCardModel): string {
  if (model.count === 0) return 'no commits in this log';
  const n = model.count === 1 ? '1 commit' : `${model.count} commits`;
  return model.newest === null ? n : `${n} here, the newest ${model.newest.age} ago`;
}

// The text of the outside block's card (M68): the commits in the shown
// log that no session here made, and why they are nobody's, in two
// counts. A commit with a Claude-Session trailer was made by a Claude
// session somewhere, only not one this daemon holds a record of (a
// worktree session on a private daemon, another machine, a record
// cleared); one with no trailer was made by hand or by something that
// is not Claude Code. Pure, so the card renders it and the tests read it.
export interface OutsideCardModel {
  count: number;
  trailer: number;
  bare: number;
  // Commits in the shown log whose trailer named a transcript on this
  // machine (M70): not in the block, drawn on history lanes of their
  // own, named here so the block's count reads against the whole.
  history: number;
}

export function outsideCardModel(outside: readonly GitCommit[], history = 0): OutsideCardModel {
  const trailer = outside.filter((c) => c.claudeSession !== null && c.claudeSession !== undefined).length;
  return { count: outside.length, trailer, bare: outside.length - trailer, history };
}

// The history lanes' line: `3 more on history lanes`.
export function historyLine(model: OutsideCardModel): string {
  return `${model.history} more on history lanes`;
}

// The count line: `4 commits in this log nobody here made`.
export function outsideLine(model: OutsideCardModel): string {
  const n = model.count === 1 ? '1 commit' : `${model.count} commits`;
  return `${n} in this log nobody here made`;
}

// The fetch line (M9 fix 286) on the outside card and every remote
// block's card while the remote branches are on the graph: emerald never
// fetches, so the remote refs are as old as the last fetch, and the
// card says how old. `fetched 2h ago`, or `never fetched` when there is
// no FETCH_HEAD (no fetch yet, or no remote at all).
export function fetchedLine(fetchedAt: number | null, now: number): string {
  return fetchedAt === null ? 'never fetched' : `fetched ${formatDuration(fetchedAt, now)} ago`;
}

// The text of a person's card (M9 fix 286): who, how many of the shown
// commits are theirs, and how many of those carry a Claude-Session
// trailer, which says their agent made it. Pure, as the others.
export interface PersonCardModel {
  name: string;
  count: number;
  trailer: number;
}

export function personCardModel(name: string, mine: readonly GitCommit[]): PersonCardModel {
  return { name, count: mine.length, trailer: mine.filter((c) => c.claudeSession !== null && c.claudeSession !== undefined).length };
}

// `4 commits here by Ada, 1 with a Claude-Session trailer`.
export function personLine(model: PersonCardModel): string {
  const n = model.count === 1 ? '1 commit' : `${model.count} commits`;
  const t = model.trailer === 0 ? '' : model.trailer === 1 ? ', 1 with a Claude-Session trailer' : `, ${model.trailer} with a Claude-Session trailer`;
  return `${n} here by ${model.name}${t}`;
}

// The text of a remote block's card (M9 fix 286): the branch, how many
// of the shown commits sit only on it, and the fetch line.
export interface RemoteCardModel {
  branch: string;
  count: number;
  fetched: string;
}

export function remoteCardModel(branch: string, mine: readonly GitCommit[], fetchedAt: number | null, now: number): RemoteCardModel {
  return { branch, count: mine.length, fetched: fetchedLine(fetchedAt, now) };
}

// `3 commits only on origin/feature`.
export function remoteLine(model: RemoteCardModel): string {
  const n = model.count === 1 ? '1 commit' : `${model.count} commits`;
  return `${n} only on ${model.branch}`;
}

// The word for a row's tooltip, the same two kinds.
export function outsideKind(commit: Pick<GitCommit, 'claudeSession'>): string {
  return commit.claudeSession !== null && commit.claudeSession !== undefined ? 'made outside emerald, its trailer naming a conversation this daemon never held' : 'made outside emerald, no trailer';
}

// The text of a history lane's card (M70): the conversation behind the
// lane, which emerald never hosted, where it ran, when, and how many of
// the shown commits it made; Resume is offered when its folder still
// exists, Transcript always. Pure, as the others.
export interface HistoryCardModel {
  title: string;
  folder: string;
  // `started 2d ago, last 3h ago`, whichever of the two the transcript had.
  when: string | null;
  count: number;
  actions: { resume: boolean; transcript: boolean };
}

export function historyCardModel(t: HistoryTranscript, mine: readonly GitCommit[], now: number): HistoryCardModel {
  const parts: string[] = [];
  if (t.startedAt !== null) parts.push(`started ${formatDuration(t.startedAt, now)} ago`);
  if (t.lastAt !== null) parts.push(`last ${formatDuration(t.lastAt, now)} ago`);
  const folder = folderName(t.cwd);
  return {
    title: t.title,
    folder: folder === '' ? t.cwd : folder,
    when: parts.length === 0 ? null : parts.join(', '),
    count: mine.length,
    actions: { resume: t.cwdExists, transcript: true },
  };
}

// The count line of a history card: `3 commits here` or `no commits in this log`.
export function historyCommitsLine(model: HistoryCardModel): string {
  if (model.count === 0) return 'no commits in this log';
  return model.count === 1 ? '1 commit here' : `${model.count} commits here`;
}

// The bars on a block's lanes (M9 fix 152), for the lines the card says
// them with. A bar is a stroke across a lane with no words of its own
// on the picture, and hovering one opens the block's card, so the card
// is where its meaning lives: a start bar marks the commit HEAD was on
// when the session spawned (M9 fix 117), a fork bar ends a lane forked
// from a commit another block owns, at that commit's row (M9 fix 145),
// or on the session's own line where such a fork lands (M9 fix 374).
// The head bar of M9 fix 151 went with M9 fix 945, a commit nobody made
// on the line being the session's square. The hash is the row's commit,
// newest first as the log runs. `landing` (M9 fix 399) tells the two
// fork bars apart: true where a fork lands on this session's own line,
// unset where the bar ends a lane at the commit it came from.
export interface CardBar {
  kind: 'start' | 'fork';
  hash: string;
  landing?: boolean;
}

export interface BarLines {
  start: string | null;
  // The two kinds of fork bar (M9 fix 399), landings first: a line for
  // each kind that has a bar, so a block with both draws two lines
  // rather than one folding both meanings into its wording.
  landing: string | null;
  ending: string | null;
}

// How many fork hashes the line names before `and N more`.
const BAR_HASHES = 3;

// The hash list a bar line names, the first BAR_HASHES then a count of
// the rest.
function hashesOf(bars: readonly CardBar[]): string {
  const named = bars.slice(0, BAR_HASHES).map((b) => b.hash.slice(0, 7));
  const rest = bars.length - named.length;
  return rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ');
}

export function barLines(bars: readonly CardBar[]): BarLines {
  const start = bars.find((b) => b.kind === 'start');
  const forks = bars.filter((b) => b.kind === 'fork');
  const landings = forks.filter((b) => b.landing === true);
  const endings = forks.filter((b) => b.landing !== true);
  return {
    start: start === undefined ? null : `bar at ${start.hash.slice(0, 7)}: the commit HEAD was on when this session started`,
    landing: landings.length === 0 ? null : `${landings.length} bar${landings.length === 1 ? '' : 's'} where a fork lands on this line (${hashesOf(landings)})`,
    ending: endings.length === 0 ? null : `${endings.length} bar${endings.length === 1 ? '' : 's'} ending a lane at the commit it came from (${hashesOf(endings)})`,
  };
}
