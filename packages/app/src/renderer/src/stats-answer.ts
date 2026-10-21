import type { ActivityTotals } from '@emerald/shared';
import type { GitProjectCounts } from '../../preload/api.ts';
import { normalizePath } from './files-model.ts';
import { STATS_REFRESH_MS, asOfText, historyText, releasesOf, releasesSince, spanStart, spanText, spanTitle, startsBeforeHistory, statsFigures, yieldText } from './stats-model.ts';
import type { StatsFigure } from './stats-model.ts';

// The answer to one folder's statistics, kept outside the component (M9
// fix 885) so the rail's tab and the document tab share it, a remount
// draws it at once and nothing is asked again inside the minute. Pure, no
// React and no window, so a test can import it.

export interface StatsAnswer {
  totals: ActivityTotals;
  counts: GitProjectCounts;
  // The clock the figures are read against: the fold's own `to`, else the
  // time the ask started.
  now: number;
  // When the ask started.
  at: number;
}

// Everything the body draws from an answer, computed once per answer.
export interface StatsSheet {
  start: number | null;
  span: string;
  spanTitle: string;
  figures: StatsFigure[];
  releases: number;
  yieldLine: string;
  months: ActivityTotals['months'];
  history: string;
  asOf: string;
}

const kept = new Map<string, StatsAnswer>();
const failures = new Map<string, string>();
const asks = new Map<string, number>();
const started = new Map<string, number>();
const listeners = new Map<string, Set<{ answer: (answer: StatsAnswer) => void; failure: ((message: string) => void) | undefined }>>();
const sheets = new Map<string, number>();
const sheetOf = new WeakMap<StatsAnswer, StatsSheet>();

function keyOf(folder: string): string {
  return normalizePath(folder).toLowerCase();
}

export function keptAnswer(folder: string): StatsAnswer | null {
  return kept.get(keyOf(folder)) ?? null;
}

export function keepAnswer(folder: string, answer: StatsAnswer): void {
  const k = keyOf(folder);
  kept.set(k, answer);
  failures.delete(k);
  // Over a copy, so a listener that unsubscribes inside its call never
  // skips a sibling.
  for (const l of [...(listeners.get(k) ?? [])]) l.answer(answer);
}

// A failed ask on a folder with no answer kept (M9 fix 964): kept, so a
// panel mounted later in the minute starts on it, and heard by every panel
// on the folder, so none reads `Reading the totals…` until its own tick.
// A folder with an answer kept goes on drawing it (fix 942's rule): there
// a failure is neither kept nor heard. The next answer clears it.
export function keepFailure(folder: string, message: string): void {
  const k = keyOf(folder);
  if (kept.has(k)) return;
  failures.set(k, message);
  for (const l of [...(listeners.get(k) ?? [])]) l.failure?.(message);
}

export function keptFailure(folder: string): string | null {
  return failures.get(keyOf(folder)) ?? null;
}

// Every panel on a folder hears the one ask's answer the moment it is kept
// (M9 fix 942), so a second panel waits for it rather than asking. A
// panel's failure listener hears a failed ask while the folder has no
// answer kept (M9 fix 964). Returns the unsubscribe.
export function onAnswer(folder: string, listener: (answer: StatsAnswer) => void, failure?: (message: string) => void): () => void {
  const k = keyOf(folder);
  let set = listeners.get(k);
  if (set === undefined) {
    set = new Set();
    listeners.set(k, set);
  }
  const entry = { answer: listener, failure };
  set.add(entry);
  return () => {
    const now = listeners.get(k);
    if (now === undefined) return;
    now.delete(entry);
    if (now.size === 0) listeners.delete(k);
  };
}

// The milliseconds until the next ask is due, counted from the later of the
// last ask's start on the folder by any panel and the kept answer's (M9 fix
// 942): neither, now.
export function askDue(folder: string, now: number): number {
  const k = keyOf(folder);
  const a = kept.get(k);
  const s = started.get(k);
  if (a === undefined && s === undefined) return 0;
  const last = Math.max(a?.at ?? 0, s ?? 0);
  return Math.max(0, last + STATS_REFRESH_MS - now);
}

export function countAsk(folder: string): void {
  const k = keyOf(folder);
  asks.set(k, (asks.get(k) ?? 0) + 1);
}

// When the folder's last ask started, whichever panel sent it (M9 fix 942),
// so a second panel's tick inside the minute asks nothing.
export function noteAsk(folder: string, at: number): void {
  started.set(keyOf(folder), at);
}

export function statsCounts(folder: string): { asks: number; sheets: number } {
  const k = keyOf(folder);
  return { asks: asks.get(k) ?? 0, sheets: sheets.get(k) ?? 0 };
}

// Memoised on the answer object, so a remount on a kept answer computes
// nothing; a sheet is counted only when one is computed.
export function statsSheet(folder: string, answer: StatsAnswer): StatsSheet {
  const had = sheetOf.get(answer);
  if (had !== undefined) return had;
  const { totals, counts, now } = answer;
  const start = spanStart(counts.firstCommitAt, totals.firstAt);
  const sheet: StatsSheet = {
    start,
    span: spanText(counts.firstCommitAt, totals.firstAt, now),
    spanTitle: spanTitle(counts.firstCommitAt, totals.firstAt, counts.root !== null, now),
    figures: statsFigures(totals, counts),
    releases: releasesOf(counts).count,
    yieldLine: '',
    months: [...totals.months].reverse(),
    history: historyText(totals.historyFrom, start, now),
    asOf: asOfText(answer.at),
  };
  // A span that starts before the log's first day is priced against the
  // log's own days: the releases and commits from that day on, when the ask
  // carried them (M9 fix 885).
  const from = counts.since === undefined ? null : releasesSince(counts);
  sheet.yieldLine =
    start !== null && startsBeforeHistory(start, totals.historyFrom) && counts.since !== undefined && from !== null
      ? yieldText(totals.total.usd, totals.total.estimated, from, counts.since.commits, counts.since.from, now)
      : yieldText(totals.total.usd, totals.total.estimated, sheet.releases, counts.commits);
  sheetOf.set(answer, sheet);
  const k = keyOf(folder);
  sheets.set(k, (sheets.get(k) ?? 0) + 1);
  return sheet;
}

export function resetStatsAnswers(): void {
  kept.clear();
  failures.clear();
  asks.clear();
  sheets.clear();
  started.clear();
  listeners.clear();
}
