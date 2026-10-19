import type { Layout, LayoutTab, LayoutWindow } from './layout.ts';
import { findTab, nextTabName } from './layout-tabs.ts';
import { LayoutError, newTab, randomId } from './tree.ts';
import type { IdGenerator } from './tree.ts';

// Pure operations on the layout's windows (M9 fix 865), the way
// layout-tabs.ts holds the ones on its tabs. A window owns its tabs (a tab
// is in exactly one window) and shows one of them. A layout with one
// window whose id is FIRST_WINDOW_ID carries no windows field at all, so
// every client and script that never opens a second window reads and
// writes the shape it always has. Every function returns a new Layout and
// never mutates its input; the revision is carried through untouched.

export const FIRST_WINDOW_ID = 'first';

// The windows, with the implied one when the field is absent.
export function windowsOf(layout: Layout): LayoutWindow[] {
  return layout.windows ?? [{ id: FIRST_WINDOW_ID, tabIds: layout.tabs.map((t) => t.id), currentTabId: layout.currentTabId }];
}

export function windowHolding(layout: Layout, tabId: string): LayoutWindow | null {
  return windowsOf(layout).find((w) => w.tabIds.includes(tabId)) ?? null;
}

// The window in front: the one holding layout.currentTabId.
export function frontWindow(layout: Layout): LayoutWindow {
  return windowHolding(layout, layout.currentTabId) ?? windowsOf(layout)[0]!;
}

// What one window shows, as a Layout of its own tabs: the layout itself
// while it has no windows field, so a one-window client renders exactly
// as before. A null or unknown id reads the first window.
export function windowView(layout: Layout, windowId: string | null): Layout {
  if (layout.windows === undefined) return layout;
  const w = layout.windows.find((x) => x.id === windowId) ?? layout.windows[0]!;
  const tabs = w.tabIds.map((id) => findTab(layout, id)).filter((t): t is LayoutTab => t !== null);
  return { tabs, currentTabId: w.currentTabId, revision: layout.revision };
}

// A window's view, edited, folded back into the whole: its record rebuilt
// from the view, the other windows untouched, and the view's current tab
// the layout's, since an edit made in a window makes it the front one.
export function mergeWindowView(layout: Layout, view: Layout, windowId: string | null): Layout {
  if (layout.windows === undefined) return view;
  const target = layout.windows.find((x) => x.id === windowId) ?? layout.windows[0]!;
  const viewIds = new Set(view.tabs.map((t) => t.id));
  const windows = layout.windows.map((w) =>
    w === target ? { id: w.id, tabIds: view.tabs.map((t) => t.id), currentTabId: view.currentTabId } : { ...w, tabIds: w.tabIds.filter((id) => !viewIds.has(id)) },
  );
  const pool = new Map<string, LayoutTab>(layout.tabs.map((t) => [t.id, t]));
  for (const t of view.tabs) pool.set(t.id, t);
  return collapse(rebuild(pool, windows, view.currentTabId, view.revision));
}

// The daemon's repair of a proposed layout against the one it holds, so a
// client that sends no windows (the CLI, an older app, a verify script's
// layout.set) keeps them and its new tab lands in the front window.
export function fitWindows(next: Layout, prev: Layout | null): Layout {
  const source = next.windows ?? prev?.windows;
  if (source === undefined) return next;
  const known = new Set(next.tabs.map((t) => t.id));
  const placed = new Set<string>();
  const wins = source.map((w) => {
    const tabIds: string[] = [];
    for (const id of w.tabIds) {
      if (!known.has(id) || placed.has(id)) continue;
      placed.add(id);
      tabIds.push(id);
    }
    return { old: w, tabIds, currentTabId: w.currentTabId };
  });
  const unplaced = next.tabs.filter((t) => !placed.has(t.id)).map((t) => t.id);
  if (unplaced.length > 0) {
    const home = (prev === null ? undefined : wins.find((w) => w.old.tabIds.includes(prev.currentTabId))) ?? wins[0]!;
    home.tabIds.push(...unplaced);
  }
  const kept: LayoutWindow[] = [];
  for (const w of wins) {
    if (w.tabIds.length === 0) continue;
    let current = w.currentTabId;
    if (!w.tabIds.includes(current)) {
      const at = w.old.tabIds.indexOf(current);
      const left = at < 0 ? [] : w.old.tabIds.slice(0, at).reverse();
      current = left.find((id) => w.tabIds.includes(id)) ?? w.tabIds[0]!;
    }
    if (w.tabIds.includes(next.currentTabId)) current = next.currentTabId;
    kept.push({ id: w.old.id, tabIds: w.tabIds, currentTabId: current });
  }
  const pool = new Map<string, LayoutTab>(next.tabs.map((t) => [t.id, t]));
  return collapse(rebuild(pool, kept, next.currentTabId, next.revision));
}

// A new window in front, holding the tab named (moved out of its window,
// which lands on the tab to its left else its right, closeTab's rule) or
// a new empty tab.
export function openWindow(layout: Layout, windowId: string, tabId: string | null, newId: IdGenerator = randomId): Layout {
  const wins = windowsOf(layout).map((w) => ({ ...w, tabIds: [...w.tabIds] }));
  const pool = new Map<string, LayoutTab>(layout.tabs.map((t) => [t.id, t]));
  if (tabId !== null) {
    const from = wins.find((w) => w.tabIds.includes(tabId));
    if (findTab(layout, tabId) === null || from === undefined) throw new LayoutError(`no tab ${tabId}`);
    if (from.tabIds.length === 1) throw new LayoutError('the only tab of a window cannot move to a new window');
    const i = from.tabIds.indexOf(tabId);
    from.tabIds.splice(i, 1);
    if (from.currentTabId === tabId) from.currentTabId = (from.tabIds[i - 1] ?? from.tabIds[i])!;
    wins.push({ id: windowId, tabIds: [tabId], currentTabId: tabId });
    return rebuild(pool, wins, tabId, layout.revision);
  }
  const tab = newTab(nextTabName(layout), newId);
  pool.set(tab.id, tab);
  wins.push({ id: windowId, tabIds: [tab.id], currentTabId: tab.id });
  return rebuild(pool, wins, tab.id, layout.revision);
}

// Removes a window and its tabs; the sessions in their panes are
// untouched, as closeTab's are. The last window cannot close.
export function closeWindow(layout: Layout, windowId: string): Layout {
  if (layout.windows === undefined) return layout;
  const w = layout.windows.find((x) => x.id === windowId);
  if (w === undefined) return layout;
  if (layout.windows.length === 1) throw new LayoutError('the last window cannot close');
  const windows = layout.windows.filter((x) => x !== w);
  const gone = new Set(w.tabIds);
  const pool = new Map<string, LayoutTab>(layout.tabs.filter((t) => !gone.has(t.id)).map((t) => [t.id, t]));
  const current = gone.has(layout.currentTabId) ? windows[0]!.currentTabId : layout.currentTabId;
  return collapse(rebuild(pool, windows, current, layout.revision));
}

// Puts a window in front: its current tab becomes the layout's.
export function setFrontWindow(layout: Layout, windowId: string): Layout {
  if (layout.windows === undefined) return layout;
  const w = layout.windows.find((x) => x.id === windowId);
  if (w === undefined || w.tabIds.includes(layout.currentTabId)) return layout;
  return { ...layout, currentTabId: w.currentTabId };
}

// The tabs window by window, each in its strip order, so a client that
// reads the tabs alone sees window one's strip then window two's.
function rebuild(pool: Map<string, LayoutTab>, windows: LayoutWindow[], currentTabId: string, revision: number): Layout {
  const tabs = windows.flatMap((w) => w.tabIds.map((id) => pool.get(id)).filter((t): t is LayoutTab => t !== undefined));
  return { tabs, currentTabId, revision, windows };
}

// One window that is the first carries no field, the shape before fix 865.
function collapse(layout: Layout): Layout {
  const w = layout.windows;
  if (w === undefined || w.length !== 1 || w[0]!.id !== FIRST_WINDOW_ID) return layout;
  const { windows: _windows, ...rest } = layout;
  return rest;
}
