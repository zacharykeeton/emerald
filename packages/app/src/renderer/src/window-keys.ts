import { FIRST_WINDOW_ID } from '@emerald/shared';

// The document tabs per window (M9 fix 867). Every window of a profile
// shares its localStorage, so each window's file tabs live under a key of
// its own; the first window keeps the key every verify fixture writes.

// The window a page shows, from the `window` query main put on its URL
// (fix 866); the first window's page has none.
export function windowIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('window');
  return id === null || id === '' ? null : id;
}

export const TABS_KEY = 'emerald.tabs';

export function tabsKeyFor(windowId: string | null): string {
  return windowId === null || windowId === FIRST_WINDOW_ID ? TABS_KEY : `${TABS_KEY}:${windowId}`;
}

// A page that moves off the bare key to a window's own, with no first window
// in the layout, leaves the bare key behind for nobody (M9 fix 1144).
export function dropsBareKey(from: string, to: string, liveIds: ReadonlySet<string>): boolean {
  return from === TABS_KEY && to !== TABS_KEY && !liveIds.has(FIRST_WINDOW_ID);
}

// The window id a per-window key belongs to, null for any other key.
export function windowOfTabsKey(key: string): string | null {
  return key.startsWith(`${TABS_KEY}:`) ? key.slice(TABS_KEY.length + 1) : null;
}
