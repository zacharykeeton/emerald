import { useSyncExternalStore } from 'react';
import type { UsageWindow } from '../../preload/api.ts';
import { windowLengthMs } from './usage-model.ts';

// The account's usage windows as the strip last showed them (M9 fix
// 321), lifted out of the strip so the activity view's five-hour unit
// can map itself onto the window being paid for. The strip keeps its
// polling and its schedule and writes here whatever it has on show: the
// answer's windows, or the kept reading while an answer is unavailable,
// or null when there is no reading to show (signed out, loading). The
// store is read-only for everyone else; nothing here asks the endpoint.

let windows: readonly UsageWindow[] | null = null;
const listeners = new Set<() => void>();

export function setUsageReading(next: readonly UsageWindow[] | null): void {
  if (next === windows) return;
  windows = next;
  for (const l of listeners) l();
}

export function usageReading(): readonly UsageWindow[] | null {
  return windows;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUsageReading(): readonly UsageWindow[] | null {
  return useSyncExternalStore(subscribe, usageReading);
}

// The reading's age beside it (M9 fix 766), so the activity view's usage
// row can say what the strip says of it: the strip's stale text while an
// answer is unavailable, and, once the strip has unmounted under a folded
// sidebar, that the reading is kept and nobody is asking. The strip
// writes it; the row reads it and never asks the endpoint itself.
export interface UsageAge {
  fetchedAt: number | null;
  stale: string | null;
  folded: boolean;
}

export const USAGE_FOLDED_TEXT = 'Kept: the sidebar is folded, so the strip is not asking; open the sidebar to refresh.';

const NO_AGE: UsageAge = { fetchedAt: null, stale: null, folded: false };
let age: UsageAge = NO_AGE;

function setAge(next: UsageAge): void {
  if (next.fetchedAt === age.fetchedAt && next.stale === age.stale && next.folded === age.folded) return;
  age = next;
  for (const l of listeners) l();
}

export function setUsageAge(fetchedAt: number | null, stale: string | null): void {
  setAge({ fetchedAt, stale, folded: false });
}

export function markUsageFolded(): void {
  setAge({ ...age, folded: true });
}

export function usageAge(): UsageAge {
  return age;
}

export function useUsageAge(): UsageAge {
  return useSyncExternalStore(subscribe, usageAge);
}

// The text a row of the reading carries as its stale note: the strip's
// own, else the folded note, else none.
export function usageAgeText(a: UsageAge): string | null {
  if (a.stale !== null) return a.stale;
  return a.folded ? USAGE_FOLDED_TEXT : null;
}

// The five-hour window off a reading, and its bounds: the reset less
// the window's length to the reset; null with no reading or no
// five-hour window in it. Pure, so the view and its tests read it off
// any list.
export function fiveHourUsage(reading: readonly UsageWindow[] | null): UsageWindow | null {
  if (reading === null) return null;
  const win = reading.find((w) => w.key === 'five_hour');
  return win === undefined || windowLengthMs(win.key) === null ? null : win;
}

export function fiveHourBounds(reading: readonly UsageWindow[] | null): { from: number; to: number } | null {
  const win = fiveHourUsage(reading);
  return win === null ? null : { from: win.resetsAt - windowLengthMs(win.key)!, to: win.resetsAt };
}

export function fiveHourWindow(): { from: number; to: number } | null {
  return fiveHourBounds(windows);
}

export function useFiveHourUsage(): UsageWindow | null {
  return fiveHourUsage(useUsageReading());
}

export function useFiveHourWindow(): { from: number; to: number } | null {
  return fiveHourBounds(useUsageReading());
}

// For tests: forget the reading.
export function resetUsageReading(): void {
  windows = null;
  age = NO_AGE;
}
