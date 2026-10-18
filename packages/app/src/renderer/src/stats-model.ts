import { formatSpanLength, formatTokens, historyFromText } from '@emerald/shared';
import type { ActivityTotals } from '@emerald/shared';
import type { GitProjectCounts } from '../../preload/api.ts';

// The Statistics tab's words and sums (M9 fix 837), pure so a test can
// read them; StatsView.tsx draws them. The totals are the daemon's fold of
// the folder's whole log (activity.totals, fix 836), the counts the main
// process's read of the repository (gitProjectCounts).

// How often the tab asks again while it is shown.
export const STATS_REFRESH_MS = 60_000;

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function countText(n: number): string {
  return n.toLocaleString('en-US');
}

// formatTokens with billions, since a whole life runs past a thousand
// million: `3.2B`, `3B`.
export function tokensText(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  return formatTokens(n);
}

// Dollars with the thousands marked and two decimals, `~` first when part
// of the sum was priced from the rates: `~$5,012.33`.
export function usdText(n: number, estimated = false): string {
  return `${estimated ? '~' : ''}$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// `Oct 2026` for `2026-10`; the key itself when it is not that form.
export function monthName(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m === null) return key;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

// What the Releases figure counted: the tags on the default branch when
// there are any, else the version bumps of a package.json on it.
export function releasesOf(counts: GitProjectCounts): { count: number; note: string } {
  const branch = counts.branch ?? 'HEAD';
  if (counts.tags > 0) return { count: counts.tags, note: `tags on ${branch}` };
  if (counts.bumps !== null && counts.bumps > 0) return { count: counts.bumps, note: `version bumps of ${counts.bumpsFile ?? 'package.json'}` };
  if (counts.bumps === null) return { count: 0, note: 'the version history did not read in 5 s' };
  return { count: 0, note: `no tags and no version bump on ${branch}` };
}

function midnight(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// `Sep 10`, with the year after it when it is not this year's.
function dayText(at: number, now: number): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

// The span's start: the earlier of the first commit and the folder's
// first activity line, null with neither.
export function spanStart(firstCommitAt: number | null, firstAt: number | null): number | null {
  if (firstCommitAt === null) return firstAt;
  if (firstAt === null) return firstCommitAt;
  return Math.min(firstCommitAt, firstAt);
}

// The local calendar days from the start's day to today, both counted.
export function spanDays(start: number, now: number): number {
  return Math.round((midnight(now) - midnight(start)) / DAY_MS) + 1;
}

// `38 days, from Sep 10 to today`; `nothing yet` with neither start.
export function spanText(firstCommitAt: number | null, firstAt: number | null, now: number): string {
  const start = spanStart(firstCommitAt, firstAt);
  if (start === null) return 'nothing yet';
  const days = spanDays(start, now);
  return `${days} ${days === 1 ? 'day' : 'days'}, from ${dayText(start, now)} to today`;
}

export function spanTitle(firstCommitAt: number | null, firstAt: number | null, inRepo: boolean, now: number): string {
  if (firstCommitAt !== null && firstAt !== null) return `The earlier of the first commit (${dayText(firstCommitAt, now)}) and the first activity line (${dayText(firstAt, now)})`;
  if (firstCommitAt !== null) return `The first commit (${dayText(firstCommitAt, now)}); no activity line for this folder`;
  if (firstAt !== null) return `The first activity line (${dayText(firstAt, now)}); ${inRepo ? 'no commit yet' : 'not a git repository'}`;
  return inRepo ? 'No commit and no activity line for this folder yet' : 'Not a git repository, and no activity line for this folder yet';
}

// The yield: the price per release and per hundred commits, and the
// releases per $1,000, each dollar figure marked when estimated.
export function yieldText(usd: number, estimated: boolean, releases: number, commits: number): string {
  if (usd <= 0) return 'no spend recorded';
  const parts: string[] = [];
  if (releases > 0) parts.push(`${usdText(usd / releases, estimated)} per release`);
  if (commits > 0) parts.push(`${usdText((usd / commits) * 100, estimated)} per hundred commits`);
  parts.push(`${((releases / usd) * 1000).toFixed(1)} releases per $1,000`);
  return parts.join(' · ');
}

// The history line under the months: how far back the log reaches, and,
// when the span starts on an earlier day, that the activity figures stop
// there.
export function historyText(historyFrom: number | null, start: number | null, now: number): string {
  if (historyFrom === null) return 'no activity log yet';
  const head = historyFromText(historyFrom, now);
  return start !== null && startsBeforeHistory(start, historyFrom) ? `${head}; the requests, tokens, price and agent time before it are not in the log` : head;
}

// Whether the span starts on a day before the log's first, so the
// activity figures miss its first days.
export function startsBeforeHistory(start: number, historyFrom: number | null): boolean {
  return historyFrom !== null && midnight(start) < midnight(historyFrom);
}

export interface StatsFigure {
  key: 'commits' | 'releases' | 'requests' | 'tokens-in' | 'tokens-out' | 'usd' | 'agent';
  label: string;
  value: string;
  note: string | null;
  title: string;
}

// The seven figures in the order the tab draws them.
export function statsFigures(totals: ActivityTotals, counts: GitProjectCounts): StatsFigure[] {
  const t = totals.total;
  const releases = releasesOf(counts);
  const inRepo = counts.root !== null;
  return [
    {
      key: 'commits',
      label: 'Commits',
      value: inRepo ? countText(counts.commits) : 'none',
      note: inRepo ? null : 'not a git repository',
      title: `git rev-list --count HEAD in ${counts.root ?? totals.folder}; the commits the sessions are credited with are in the months below`,
    },
    {
      key: 'releases',
      label: 'Releases',
      value: countText(releases.count),
      note: releases.note,
      title: 'A release is a tag on the default branch when the repository has any, else each new value of the version field of a package.json on it.',
    },
    { key: 'requests', label: 'Requests', value: countText(t.requests), note: null, title: `The requests Claude made in sessions started in ${totals.folder} or under it; a worktree beside it is a folder of its own` },
    { key: 'tokens-in', label: 'Tokens in', value: tokensText(t.up), note: null, title: `${tokensText(t.fresh)} fresh · ${tokensText(t.cacheWrite)} cache write · ${tokensText(t.cached)} cache read` },
    { key: 'tokens-out', label: 'Tokens out', value: tokensText(t.down), note: null, title: 'The tokens Claude wrote in those requests' },
    {
      key: 'usd',
      label: 'At API prices',
      value: usdText(t.usd, t.estimated),
      note: null,
      title: t.estimated ? `Claude Code's own figure where it gave one, priced from the rates where it gave none, over ${countText(t.requests)} requests` : `Claude Code's own figure summed over ${countText(t.requests)} requests`,
    },
    { key: 'agent', label: 'Agent time', value: formatSpanLength(t.agentMs), note: null, title: 'The working time of every session and agent in the folder, summed' },
  ];
}
