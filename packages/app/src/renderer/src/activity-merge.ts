import { activityRowKey } from '@emerald/shared';
import type { ActivityRequest, ActivitySession } from '@emerald/shared';

// The answer's rows with the held rows' earlier points in front of their
// own (M9 fix 217), by the row's key; a point the answer carries again
// (one a streaming line updated) replaces the held copy. A row the
// answer lacks left the window and goes. A point is keyed by its time and
// its agent (M9 fix 1189): an agent's point and the session's own opened
// in one millisecond, or two agents read at one Stop (both carry the
// Stop's time), are different points. Out of activity-data.ts so a test
// can import it without React and the store.
export function mergeRequests(held: readonly ActivitySession[], fresh: readonly ActivitySession[]): ActivitySession[] {
  const before = new Map(held.map((s) => [activityRowKey(s), s.requests ?? []]));
  const keyOf = (r: ActivityRequest): string => `${r.at}\0${r.agent ?? ''}`;
  return fresh.map((s) => {
    const earlier = before.get(activityRowKey(s));
    const own = s.requests ?? [];
    if (earlier === undefined || earlier.length === 0) return own === s.requests ? s : { ...s, requests: own };
    const byKey = new Map<string, ActivityRequest>();
    for (const r of earlier) byKey.set(keyOf(r), r);
    for (const r of own) byKey.set(keyOf(r), r);
    return { ...s, requests: [...byKey.values()].sort((a, b) => a.at - b.at) };
  });
}
