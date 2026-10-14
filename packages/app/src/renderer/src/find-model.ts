// The pure part of the find bar (M26), with no DOM so node:test can cover
// it. The search addon reports the active match's index (0-based, -1 when
// nothing is selected or the highlight limit was passed) and the count;
// the bar shows them as people read them.

export interface FindResults {
  index: number;
  count: number;
}

// Nothing typed yet gives no text at all, so the bar is quiet until there
// is something to say.
export function findCountText(results: FindResults | null): string {
  if (results === null) return '';
  if (results.count === 0) return 'No matches';
  if (results.index < 0) return `${results.count} matches`;
  return `${results.index + 1} of ${results.count}`;
}
