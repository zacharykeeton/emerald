import type { UsageEdge } from '@emerald/shared';
import type { UsageWindow } from '../preload/api.ts';

// The usage edges (M9 fix 285): the main process reads the account's
// usage windows on the renderer's schedule (usage.ts) and posts to the
// daemon when one reaches 100 percent (capped, with its reset) or drops
// under (freed), so the activity view can draw the stretch nobody could
// continue. Pure, so the test needs no fetch: `last` is the previous
// reading keyed by window, null before the first, and `next` the new
// one. A window at 100 on the first reading is capped from now, since
// the daemon knows nothing before the app came up; a capped window the
// next reading no longer lists is freed, as the daemon would otherwise
// hold its band open to the reset; a reading that failed is not a
// reading and the caller keeps `last`.
export const CAPPED_PERCENT = 100;

export function cappedEdges(last: ReadonlyMap<string, UsageWindow> | null, next: readonly UsageWindow[]): UsageEdge[] {
  const edges: UsageEdge[] = [];
  const seen = new Set<string>();
  for (const win of next) {
    seen.add(win.key);
    const before = last?.get(win.key);
    const wasCapped = before !== undefined && before.percent >= CAPPED_PERCENT;
    if (win.percent >= CAPPED_PERCENT && !wasCapped) edges.push({ kind: 'capped', window: win.key, resetsAt: win.resetsAt });
    else if (win.percent < CAPPED_PERCENT && wasCapped) edges.push({ kind: 'freed', window: win.key });
  }
  if (last !== null) {
    for (const [key, before] of last) {
      if (!seen.has(key) && before.percent >= CAPPED_PERCENT) edges.push({ kind: 'freed', window: key });
    }
  }
  return edges;
}

// The reading as the next call's `last`.
export function usageByKey(windows: readonly UsageWindow[]): Map<string, UsageWindow> {
  return new Map(windows.map((w) => [w.key, w]));
}

// The windows still capped in a reading, for a reconnect: the daemon
// that came up meanwhile has no band open, and recordCapped on one that
// has is nothing.
export function cappedNow(last: ReadonlyMap<string, UsageWindow> | null): UsageEdge[] {
  if (last === null) return [];
  const edges: UsageEdge[] = [];
  for (const win of last.values()) {
    if (win.percent >= CAPPED_PERCENT) edges.push({ kind: 'capped', window: win.key, resetsAt: win.resetsAt });
  }
  return edges;
}
