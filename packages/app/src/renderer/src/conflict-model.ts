import { formatDuration } from '@emerald/shared';
import type { BranchBase, ConflictPair, ConflictReport, SessionInfo } from '@emerald/shared';
import type { SessionGraph } from './commit-graph-model.ts';

// The conflict forecast as the window draws it (M9 fix 320,
// docs/design/conflict-forecast.md section 6), pure: the daemon's
// report (the pairs and the bases) against the commit graph gives the
// ties to draw between the two lanes' newest commit nodes, the count
// on each row, the lines on each card and the base line under them.
// The components place what this returns and compute nothing.

export interface ConflictTie {
  a: string;
  b: string;
  // Named on the card, never drawn on the graph.
  files: string[];
  // The rows of the two newest commits, the heads the merge-tree ran
  // between, and the slots the tie runs between.
  tipA: number;
  tipB: number;
  laneA: number;
  laneB: number;
}

export interface ConflictLine {
  other: string;
  // The other session's name and colour, since its name is the one
  // place a second session's hue is allowed on a card.
  name: string;
  color: string | null;
  files: string;
  // The whole list, for the CLI's form and a tooltip.
  all: string[];
}

export interface BaseLine {
  text: string;
  stale: boolean;
  behind: number;
}

export interface ConflictReading {
  // In tip-row order, newest first; two on one tip by their lower slot.
  ties: ConflictTie[];
  // The row's count: how many other lanes the session is tangled with.
  pairsBySession: Map<string, number>;
  linesBySession: Map<string, ConflictLine[]>;
  baseBySession: Map<string, BaseLine>;
}

// Past this many commits behind the default the card's base line takes
// the tone (M9 fix 320); the graph draws no figure for it since M9 fix
// 938, so the count is on the card alone.
export const BEHIND_AT = 40;

// What a session's peers look like to the card: a name and a colour.
export type ConflictPeer = { name: string; color: string | null };

export function conflictPeers(sessions: ReadonlyMap<string, Pick<SessionInfo, 'id' | 'name' | 'color'>>): Map<string, ConflictPeer> {
  return new Map([...sessions.values()].map((s) => [s.id, { name: s.name, color: s.color }]));
}

// One or two files whole and joined with ` and `; three or more as
// `<first> and N more`. The CLI names every one; this is the card's.
export function filesText(files: readonly string[]): string {
  if (files.length === 0) return '';
  if (files.length <= 2) return files.join(' and ');
  return `${files[0]} and ${files.length - 1} more`;
}

// `12 ahead, 40 behind main, forked 2d ago`.
export function baseText(base: BranchBase, now: number): string {
  return `${base.ahead} ahead, ${base.behind} behind ${base.defaultBranch}, forked ${formatDuration(base.forkedAt, now)} ago`;
}

export function baseLine(base: BranchBase | undefined, now: number): BaseLine | null {
  if (base === undefined) return null;
  return { text: baseText(base, now), stale: base.behind >= BEHIND_AT, behind: base.behind };
}

// The card's lines for one session, one per other lane it pairs with,
// in the report's order; empty with no pairs.
export function conflictLines(sessionId: string, conflicts: readonly ConflictPair[], peers: ReadonlyMap<string, ConflictPeer>): ConflictLine[] {
  const lines: ConflictLine[] = [];
  for (const p of conflicts) {
    const other = p.a === sessionId ? p.b : p.b === sessionId ? p.a : null;
    if (other === null) continue;
    const peer = peers.get(other);
    lines.push({ other, name: peer?.name ?? other, color: peer?.color ?? null, files: filesText(p.files), all: [...p.files] });
  }
  return lines;
}

// The line as words, for a row's tooltip and the CLI's voice:
// `conflicts with fix-live-count on style.css, protocol.ts and 1 more`.
export function conflictWords(line: ConflictLine): string {
  return `conflicts with ${line.name} on ${line.files}`;
}

export function conflictReading(graph: SessionGraph, report: ConflictReport, peers: ReadonlyMap<string, ConflictPeer>, now: number): ConflictReading {
  // A session's tip: the row and lane of its newest commit in the shown
  // log, off its own agent row's tip (the head of the branch it is on,
  // M9 fix 151), or its newest commit item on its own line when the
  // graph gave it no agent row. A block that draws no lanes (M72), or
  // is not on this graph at all, has no tip, and a pair needs two.
  const drawn = new Set(graph.blocks.filter((b) => b.drawn && b.sessionId !== null).map((b) => b.sessionId!));
  const tips = new Map<string, { row: number; lane: number }>();
  for (const it of graph.items) {
    if (it.kind !== 'agent' || it.member !== null || it.lane === null || !drawn.has(it.sessionId)) continue;
    if (it.tipRow !== null) tips.set(it.sessionId, { row: it.tipRow, lane: it.tipLane ?? it.lane });
  }
  for (const it of graph.items) {
    if (it.kind !== 'commit' || it.sessionId === null || it.memberId !== null || it.lane === null || !drawn.has(it.sessionId) || tips.has(it.sessionId)) continue;
    // The log is newest first, so the first commit item of a session is
    // its newest.
    tips.set(it.sessionId, { row: it.row, lane: it.lane });
  }
  const ties: ConflictTie[] = [];
  const pairsBySession = new Map<string, number>();
  for (const p of report.conflicts) {
    const a = tips.get(p.a);
    const b = tips.get(p.b);
    if (a === undefined || b === undefined) continue;
    ties.push({ a: p.a, b: p.b, files: [...p.files], tipA: a.row, tipB: b.row, laneA: a.lane, laneB: b.lane });
    pairsBySession.set(p.a, (pairsBySession.get(p.a) ?? 0) + 1);
    pairsBySession.set(p.b, (pairsBySession.get(p.b) ?? 0) + 1);
  }
  ties.sort((x, y) => Math.min(x.tipA, x.tipB) - Math.min(y.tipA, y.tipB) || Math.min(x.laneA, x.laneB) - Math.min(y.laneA, y.laneB));
  const linesBySession = new Map<string, ConflictLine[]>();
  for (const id of pairsBySession.keys()) linesBySession.set(id, conflictLines(id, report.conflicts, peers));
  const baseBySession = new Map<string, BaseLine>();
  for (const [id, base] of Object.entries(report.base)) {
    const line = baseLine(base, now);
    if (line !== null) baseBySession.set(id, line);
  }
  return { ties, pairsBySession, linesBySession, baseBySession };
}
