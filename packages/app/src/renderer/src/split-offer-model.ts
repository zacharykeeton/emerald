// The one-time split offer (M9 fix 1132): a person who splits to an empty
// pane and starts a Claude in it within a few seconds, three times in one
// local day, is asked once whether a split should start a Claude itself.
// The pure half, covered by node:test; ui.ts holds the stored count and the
// pane showing the offer.

import { dayKey } from '@emerald/shared';
import type { SplitKind } from './pane-menu-model.ts';

// A split to a Claude start within this long is one act.
export const SPLIT_OFFER_WITHIN_MS = 10_000;
// Pairs in one local day before the offer.
export const SPLIT_OFFER_AFTER = 3;

export interface SplitPairs {
  day: string;
  count: number;
}

export function parsePairs(raw: string | null): SplitPairs | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { day, count } = v as Record<string, unknown>;
    if (typeof day !== 'string' || typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;
    return { day, count };
  } catch {
    return null;
  }
}

// The day's count after a Claude start in a pane split empty at splitAt,
// or null when the start does not pair with a split.
export function pairAfterStart(stored: SplitPairs | null, splitAt: number | undefined, now: number): SplitPairs | null {
  if (splitAt === undefined || now - splitAt > SPLIT_OFFER_WITHIN_MS) return null;
  const day = dayKey(now);
  return { day, count: stored?.day === day ? stored.count + 1 : 1 };
}

export function offerDue(stored: SplitPairs | null, shown: boolean, splitKind: SplitKind, now: number): boolean {
  return !shown && splitKind === 'empty' && stored !== null && stored.day === dayKey(now) && stored.count >= SPLIT_OFFER_AFTER;
}
