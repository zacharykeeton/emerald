import { clockTime, dayKey } from '@emerald/shared';
import type { ActivitySession, ActivitySpan, TeamMember } from '@emerald/shared';
import { spanSessions } from './commit-graph-model.ts';
import type { AgentItem, GraphLine, GraphSession, SessionGraph } from './commit-graph-model.ts';

// The commit graph's replay (M9 fix 868, the backlog entry of
// 2026-10-18): the graph replayed from one commit as it happened, faster.
// The commits above the start land at their committer times and the
// working marks of the session and its subagents turn on and off at the
// times the hook log recorded, on one clock sped up by REPLAY_SPEED, with
// every idle stretch longer than a beat squeezed to it. The record's own
// times keep their proportions, durations and overlaps alike; only the
// gaps where nothing the replay draws is working are cut.
//
// The graph has no rows for a finished batch: a returned member leaves
// the team at the next prompt and an exited session draws no row of its
// own. So replayInput builds the rows itself, as stand-in input for
// sessionGraph, and buildReplay times the model that comes back. Pure:
// no React, no window; fix 869's panel drives it.

// Record milliseconds per replay millisecond: ten minutes of the record
// play in one second, so a batch of six to ten working hours plays in 36
// to 60 seconds.
export const REPLAY_SPEED = 600;
// Replay milliseconds: the longest an idle stretch plays, where nothing
// the replay draws is working (ten minutes of the record and more), so an
// overnight gap costs a second.
export const REPLAY_BEAT_MS = 1000;

// The key an agent row's marks are kept under: the graph session's id (a
// span part's own) and the member's, or `own` for the session's row.
export function replayKey(sessionId: string, memberId: string | null): string {
  return `${sessionId} ${memberId ?? 'own'}`;
}

export interface ReplayInput {
  sessions: GraphSession[];
  marks: ReadonlyMap<string, readonly ActivitySpan[]>;
  // The members sessionGraph puts on their session's line (M9 fix 907): those with a working span and no commit shown, by replayKey.
  membersOnLine: ReadonlySet<string>;
}

// The records as the replay draws them, the working spans of every row
// under its replayKey, and the members to put on their session's line.
// `shown` is the hashes of the graph's commits: a member with a commit
// there gets a stand-in row on that commit's lane, and one with none but a
// working span a stand-in on its session's line with no lane of its own
// (M9 fix 907, reversing fix 868's none), so a batch's dozens of readers
// stack above the session's row at the width of one lane and light up as
// their spans run.
export function replayInput(records: readonly GraphSession[], rows: readonly ActivitySession[], shown: ReadonlySet<string>): ReplayInput {
  const live = rows.filter((r) => !r.lifetime);
  const sessions: GraphSession[] = [];
  const marks = new Map<string, readonly ActivitySpan[]>();
  const membersOnLine = new Set<string>();
  for (const record of records) {
    const spans = record.spans ?? [];
    const split = spans.length >= 2;
    // Each part with its own span alone, so sessionGraph's spanSessions
    // passes it through as it is.
    const parts = spanSessions([record]).map((p, i) => (split ? { ...p, spans: [spans[i]!] } : p));
    const windowOf = (i: number): { from: number; to: number } => (split ? { from: spans[i]!.startedAt, to: i + 1 < spans.length ? spans[i + 1]!.startedAt : Infinity } : { from: -Infinity, to: Infinity });
    const last = parts.length - 1;
    // Before the first conversation's start belongs to the last part, as
    // spanCommits does with a commit.
    const firstStart = split ? spans[0]!.startedAt : -Infinity;
    const own = live.find((r) => r.sessionId === record.id && (r.agentId === null || r.agentId === undefined));
    if (own !== undefined) {
      parts.forEach((p, i) => {
        const w = windowOf(i);
        const cut: ActivitySpan[] = [];
        for (const s of own.spans) {
          if (s.from < firstStart) {
            if (i === last) cut.push(s);
            continue;
          }
          const from = Math.max(s.from, w.from);
          const to = Math.min(s.to, w.to);
          if (to > from) cut.push(from === s.from && to === s.to ? s : { ...s, from, to });
        }
        if (cut.length === 0) return;
        // A part that was exited or removed then was live then.
        parts[i] = { ...p, state: 'idle', removedAt: null };
        marks.set(replayKey(p.id, null), cut);
      });
    }
    for (const r of live) {
      if (r.agentId === null || r.agentId === undefined || r.sessionId !== record.id) continue;
      const agentId = r.agentId;
      let at = last;
      let commit: GraphSession['commits'][number] | undefined;
      for (let i = 0; i < parts.length && commit === undefined; i++) {
        commit = parts[i]!.commits.find((c) => c.agent?.id === agentId && shown.has(c.hash));
        if (commit !== undefined) at = i;
      }
      const part = parts[at]!;
      marks.set(replayKey(part.id, agentId), r.spans);
      if (commit === undefined) {
        // A member that never worked in the window gets no row.
        if (r.spans.length === 0) continue;
        membersOnLine.add(replayKey(part.id, agentId));
      }
      // A live team's member with no commit is put on the line too, so the replay has one rule.
      if (part.team.some((m) => m.id === agentId)) continue;
      const standIn: TeamMember = {
        id: agentId,
        kind: 'agent',
        type: r.agentType,
        description: r.name,
        command: null,
        startedAt: r.spans[0]?.from ?? commit!.at,
        endedAt: r.spans[r.spans.length - 1]?.to ?? commit!.at,
        outcome: 'returned',
        cwd: null,
        branch: commit?.agent?.branch ?? null,
        commits: [],
        activity: null,
      };
      parts[at] = { ...part, team: [...part.team, standIn] };
    }
    sessions.push(...parts);
  }
  return { sessions, marks, membersOnLine };
}

// An agent row's marks on the replay clock, in replay ms.
export interface ReplayMark {
  // When the row comes out: its first span's start, 0 for a row with no
  // spans (shown from the start, never working).
  appear: number;
  spans: Array<{ from: number; to: number; prompt: string | null }>;
}

export interface Replay {
  // The commit the replay starts from, and its row.
  hash: string;
  startRow: number;
  // Record ms: the start commit's time, and the end (the last landing or
  // span end, never past now).
  from: number;
  to: number;
  // Replay ms the whole replay plays.
  length: number;
  // The replay ms each commit row above the start lands at, by row.
  lands: ReadonlyMap<number, number>;
  // The marks of every agent row, by row.
  marks: ReadonlyMap<number, ReplayMark>;
  // The breakpoints, ascending: each record ms with its replay ms.
  clock: ReadonlyArray<{ record: number; replay: number }>;
}

export function buildReplay(model: SessionGraph, marks: ReplayInput['marks'], hash: string, now: number): Replay | null {
  const start = model.items.find((it) => it.kind === 'commit' && it.commit.hash === hash);
  if (start === undefined || start.kind !== 'commit') return null;
  const startRow = start.row;
  const from = start.commit.at;
  // Oldest first, never before the one below: git's date order puts a
  // child above its parents whatever the clock says.
  const landsAt = new Map<number, number>();
  let prev = from;
  for (let row = startRow - 1; row >= 0; row--) {
    const it = model.items[row]!;
    if (it.kind !== 'commit') continue;
    prev = Math.max(it.commit.at, prev);
    landsAt.set(row, prev);
  }
  const agents = model.items.filter((it): it is AgentItem => it.kind === 'agent');
  const spansOf = new Map<number, ActivitySpan[]>();
  let latest = from;
  for (const it of agents) {
    const got = marks.get(replayKey(it.sessionId, it.member?.id ?? null)) ?? [];
    const kept = got.filter((s) => s.to > from).map((s) => (s.from >= from ? s : { ...s, from }));
    for (const s of kept) latest = Math.max(latest, s.to);
    spansOf.set(it.row, kept);
  }
  const to = Math.min(now, Math.max(from, prev, latest));
  for (const [row, spans] of spansOf) spansOf.set(row, spans.filter((s) => s.from < to).map((s) => (s.to <= to ? s : { ...s, to })));
  const edges = new Set<number>([from, to]);
  for (const t of landsAt.values()) edges.add(Math.min(t, to));
  for (const spans of spansOf.values()) for (const s of spans) edges.add(s.from).add(s.to);
  const points = [...edges].filter((t) => t >= from && t <= to).sort((a, b) => a - b);
  const all = [...spansOf.values()].flat();
  const clock: Array<{ record: number; replay: number }> = [];
  let sum = 0;
  points.forEach((b, i) => {
    if (i > 0) {
      const a = points[i - 1]!;
      const busy = all.some((s) => s.from <= a && s.to >= b);
      sum += busy ? (b - a) / REPLAY_SPEED : Math.min((b - a) / REPLAY_SPEED, REPLAY_BEAT_MS);
    }
    clock.push({ record: b, replay: sum });
  });
  const base: Replay = { hash, startRow, from, to, length: sum, lands: new Map(), marks: new Map(), clock };
  const lands = new Map<number, number>();
  for (const [row, t] of landsAt) lands.set(row, replayAt(base, t));
  const out = new Map<number, ReplayMark>();
  for (const [row, spans] of spansOf) {
    const played = spans.map((s) => ({ from: replayAt(base, s.from), to: replayAt(base, s.to), prompt: s.prompt }));
    out.set(row, { appear: played[0]?.from ?? 0, spans: played });
  }
  return { ...base, lands, marks: out };
}

// Piecewise linear over the clock's breakpoints, clamped to its ends.
function along(clock: Replay['clock'], value: number, key: 'record' | 'replay', other: 'record' | 'replay'): number {
  if (clock.length === 0) return 0;
  const first = clock[0]!;
  const last = clock[clock.length - 1]!;
  if (value <= first[key]) return first[other];
  if (value >= last[key]) return last[other];
  for (let i = 1; i < clock.length; i++) {
    const a = clock[i - 1]!;
    const b = clock[i]!;
    if (value > b[key]) continue;
    if (b[key] === a[key]) return b[other];
    return a[other] + ((value - a[key]) / (b[key] - a[key])) * (b[other] - a[other]);
  }
  return last[other];
}

export function replayAt(replay: Replay, record: number): number {
  return along(replay.clock, record, 'record', 'replay');
}

export function recordAt(replay: Replay, at: number): number {
  return along(replay.clock, at, 'replay', 'record');
}

// Pause or play a replay (M9 fix 905): playing, it holds at the position now; paused, it plays on from where it holds, and from the start when it holds at the end.
export function togglePlay(clock: { startedAt: number; pausedAt: number | null }, length: number, now: number): { startedAt: number; pausedAt: number | null } {
  if (clock.pausedAt === null) return { startedAt: clock.startedAt, pausedAt: Math.min(length, Math.max(0, now - clock.startedAt)) };
  const from = clock.pausedAt >= length ? 0 : clock.pausedAt;
  return { startedAt: now - from, pausedAt: null };
}

export interface ReplayFrame {
  // Replay ms, and the record ms it stands for.
  at: number;
  record: number;
  // The rows that draw nothing yet: commits not landed, agents not out.
  hidden: ReadonlySet<number>;
  // The agent rows at work, and the prompt each is working on.
  working: ReadonlySet<number>;
  prompts: ReadonlyMap<number, string | null>;
  done: boolean;
}

export function frameAt(replay: Replay, given: number): ReplayFrame {
  const at = Math.max(0, Math.min(replay.length, given));
  const hidden = new Set<number>();
  for (const [row, t] of replay.lands) if (t > at) hidden.add(row);
  const working = new Set<number>();
  const prompts = new Map<number, string | null>();
  for (const [row, mark] of replay.marks) {
    if (row < replay.startRow && mark.appear > at) hidden.add(row);
    // Half open, so a span's end reads idle.
    const on = mark.spans.find((s) => s.from <= at && at < s.to);
    if (on !== undefined) working.add(row);
    prompts.set(row, on?.prompt ?? null);
  }
  return { at, record: recordAt(replay, at), hidden, working, prompts, done: at >= replay.length };
}

// The next replay ms anything changes after `at`, so the panel sleeps
// until then rather than rendering on a frame tick.
export function nextChange(replay: Replay, at: number): number {
  let next = replay.length;
  const see = (t: number) => {
    if (t > at && t < next) next = t;
  };
  for (const t of replay.lands.values()) see(t);
  for (const mark of replay.marks.values()) {
    see(mark.appear);
    for (const s of mark.spans) {
      see(s.from);
      see(s.to);
    }
  }
  return next;
}

// The model as the frame draws it. Each agent row's mark follows the
// record (it then steps on the one global clock as a live one does); a
// commit's lane stays, since the rows read a null lane as hidden lines;
// a dot on a hidden row goes; a session's line grows up its lane commit
// by commit, and every other line comes with its newer end's row.
export function replayGraph(model: SessionGraph, frame: ReplayFrame): SessionGraph {
  const { hidden } = frame;
  const items = model.items.map((it) => (it.kind === 'agent' ? { ...it, working: frame.working.has(it.row) } : it));
  const dots = model.dots.filter((d) => !hidden.has(d.row));
  const lines: GraphLine[] = [];
  for (const l of model.lines) {
    // Which end is the newer (the smaller row): fromRow unless the line
    // was drawn upward.
    const fromFirst = l.toRow === 'bottom' || l.fromRow <= l.toRow;
    const top = l.toRow === 'bottom' ? l.fromRow : Math.min(l.fromRow, l.toRow);
    const bottom = l.toRow === 'bottom' ? 'bottom' : Math.max(l.fromRow, l.toRow);
    if ((l.kind === 'session' || l.kind === 'worktree' || l.kind === 'outside') && l.toLane === null) {
      if (bottom !== 'bottom' && hidden.has(bottom)) continue;
      const end = bottom === 'bottom' ? items.length : bottom;
      let r = -1;
      for (let i = top; i < end; i++) {
        const it = items[i]!;
        if (it.kind === 'commit' && it.lane === l.lane && !hidden.has(i)) {
          r = i;
          break;
        }
      }
      if (r === -1) continue;
      if (r === top) lines.push(l);
      else if (fromFirst) lines.push({ ...l, fromRow: r });
      else lines.push({ ...l, toRow: r });
      continue;
    }
    if (!hidden.has(top)) lines.push(l);
  }
  return { ...model, items, dots, lines };
}

// The panel's note on where the working record starts, or null when it
// covers the whole replay.
export function replayNote(from: number, historyFrom: number | null, answered: boolean): string | null {
  if (!answered || historyFrom === null) return 'No working record; the commits replay without marks';
  if (from < historyFrom) return `The working record starts ${dayKey(historyFrom)} ${clockTime(historyFrom)}; the commits before it replay without marks`;
  return null;
}
