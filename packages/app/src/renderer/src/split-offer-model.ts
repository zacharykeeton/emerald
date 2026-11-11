// The one-time split offer (M9 fix 1132): a person who splits to an empty
// pane and starts a Claude in it within a few seconds, three times over any
// days, is asked once whether a split should start a Claude itself.
// The pure half, covered by node:test; ui.ts holds the stored count and the
// pane showing the offer.

import type { SplitKind } from './pane-menu-model.ts';

// A split to a Claude start within this long is one act (45 s since fix 1145; 10 s missed half the person's real pairs).
export const SPLIT_OFFER_WITHIN_MS = 45_000;
// Pairs, over any days, before the offer.
export const SPLIT_OFFER_AFTER = 3;

export interface SplitPairs {
  count: number;
}

export function parsePairs(raw: string | null): SplitPairs | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    // An older profile's {"day":...,"count":N} reads as its count; the day is ignored.
    const { count } = v as Record<string, unknown>;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
    return { count };
  } catch {
    return null;
  }
}

// The count after a Claude start in a pane split empty at splitAt,
// or null when the start does not pair with a split.
export function pairAfterStart(stored: SplitPairs | null, splitAt: number | undefined, now: number): SplitPairs | null {
  if (splitAt === undefined || now - splitAt > SPLIT_OFFER_WITHIN_MS) return null;
  return { count: (stored?.count ?? 0) + 1 };
}

export function offerDue(stored: SplitPairs | null, shown: boolean, splitKind: SplitKind): boolean {
  return !shown && splitKind === 'empty' && stored !== null && stored.count >= SPLIT_OFFER_AFTER;
}
