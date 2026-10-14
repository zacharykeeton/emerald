// M9 fix 184: where the eye has been. A per-window list of the places the
// keyboard focus landed, a pane on a layout tab or a file tab, walked by
// the strip's back and forward chevrons the way a browser's are. Pure and
// unit tested; ui.ts holds the current value and focus-history.ts feeds
// it every change of the focused pane, the current tab or the active
// file tab.

export type FocusEntry = { kind: 'pane'; tabId: string; paneId: string } | { kind: 'file'; path: string };

export interface FocusHistory {
  entries: readonly FocusEntry[];
  // The entry the focus is on now, or -1 before the first.
  at: number;
}

// Fifty is a browser's order of history; nobody walks back further.
export const FOCUS_HISTORY_CAP = 50;

export function emptyFocusHistory(): FocusHistory {
  return { entries: [], at: -1 };
}

export function sameEntry(a: FocusEntry, b: FocusEntry): boolean {
  if (a.kind === 'pane') return b.kind === 'pane' && a.tabId === b.tabId && a.paneId === b.paneId;
  return b.kind === 'file' && a.path === b.path;
}

// A move the person made (not a back or forward step): the browser rule,
// what was ahead of the current entry is dropped, the new place goes on
// the end and becomes current. The same place twice in a row folds, so a
// layout push that changes nothing about the focus adds nothing.
export function recordFocus(h: FocusHistory, entry: FocusEntry): FocusHistory {
  const current = h.entries[h.at];
  if (current !== undefined && sameEntry(current, entry)) return h;
  const kept = h.entries.slice(0, h.at + 1);
  kept.push(entry);
  const overflow = Math.max(0, kept.length - FOCUS_HISTORY_CAP);
  const entries = overflow === 0 ? kept : kept.slice(overflow);
  return { entries, at: entries.length - 1 };
}

// The nearest entry before (step -1) or after (step 1) the current one
// that is still somewhere to go, or null. An entry whose pane was hidden
// or whose file tab closed stays in the list and is stepped over: a
// hidden pane can come back (fix 129's Show) and its place with it. So is
// an entry for the place the focus is on now (a file tab closed lands
// the focus back where it was, on top of the dead entry), since a step
// that goes nowhere is no step.
export function nextStop(h: FocusHistory, step: 1 | -1, alive: (entry: FocusEntry) => boolean): number | null {
  const here = h.entries[h.at];
  for (let i = h.at + step; i >= 0 && i < h.entries.length; i += step) {
    const entry = h.entries[i];
    if (entry === undefined || !alive(entry)) continue;
    if (here !== undefined && sameEntry(here, entry)) continue;
    return i;
  }
  return null;
}

export function stepFocus(h: FocusHistory, at: number): FocusHistory {
  return at === h.at ? h : { entries: h.entries, at };
}
