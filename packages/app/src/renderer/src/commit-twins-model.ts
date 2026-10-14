import type { GraphCommit } from '../../preload/api.ts';
import { twinOriginal } from './git-changes-model.ts';

// A cherry-picked twin on the graph (M9 fix 304): the log's patch ids
// (git-status.ts) put the other copies' hashes on each commit's
// `twins`; this is what the row and the card make of them. The original
// is the copy with the earliest committer time, and its row reads the
// count of every copy, itself included; a pick's row reads `picked`.
// The card lists the other copies one a line with the branch each sits
// on, the original first on a pick's card.
export interface TwinLine {
  hash: string;
  branch: string;
  original: boolean;
}

export interface TwinInfo {
  original: boolean;
  // Every copy including this one.
  count: number;
  // The other copies' hashes, in the log's order.
  others: string[];
  lines: TwinLine[];
}

export function twinInfo(commit: GraphCommit, commits: readonly GraphCommit[], branchOf: (hash: string) => string): TwinInfo | null {
  const others = commit.twins;
  if (others === undefined || others.length === 0) return null;
  const original = twinOriginal([commit.hash, ...others], commits) ?? commit.hash;
  const line = (hash: string): TwinLine => ({ hash, branch: branchOf(hash), original: hash === original });
  const lines = others.map(line);
  // A pick's card names the original before the other picks.
  lines.sort((a, b) => Number(b.original) - Number(a.original));
  return { original: original === commit.hash, count: others.length + 1, others, lines };
}

// The line's words: `picked onto main` for a pick, `original on first`
// for the original on a pick's card.
export function twinLineText(line: TwinLine): string {
  return line.original ? `original on ${line.branch}` : `picked onto ${line.branch}`;
}

// The row's pill: `×3` on the original, `picked` on a copy.
export function twinPillText(info: TwinInfo): string {
  return info.original ? `×${info.count}` : 'picked';
}

// The pill's tooltip.
export function twinPillTitle(info: TwinInfo): string {
  if (info.original) return `cherry-picked ${info.count - 1} ${info.count === 2 ? 'time' : 'times'}; hover to see where`;
  return 'a cherry-pick of another commit on the graph; hover to see which';
}
