import type { Layout, LayoutTab } from './layout.ts';
import { FIRST_TAB_NAME, LayoutError, dropAtRight, gridTree, listPanes, newTab, randomId } from './tree.ts';
import type { IdGenerator, PaneContent, PaneNode } from './tree.ts';

// Pure operations on the list of tabs (M36), the way tree.ts holds the
// ones on a tree. Every function returns a new Layout and never mutates
// its input; the revision is carried through untouched, as in tree.ts.

export function findTab(layout: Layout, tabId: string): LayoutTab | null {
  return layout.tabs.find((t) => t.id === tabId) ?? null;
}

// The tab the window shows. Validated layouts always have it.
export function currentTab(layout: Layout): LayoutTab {
  const tab = findTab(layout, layout.currentTabId);
  if (tab === null) throw new LayoutError(`current tab ${layout.currentTabId} is not a tab`);
  return tab;
}

// The tab holding the pane, which is one tab at most since pane ids are
// unique across the layout.
export function tabHolding(layout: Layout, paneId: string): LayoutTab | null {
  return layout.tabs.find((t) => listPanes(t).some((p) => p.id === paneId)) ?? null;
}

// Every pane in every tab, tab order then tree order.
export function allPanes(layout: Layout): PaneNode[] {
  return layout.tabs.flatMap((t) => listPanes(t));
}

// Every session in a pane of any tab (M9 fix 249): the sidebar's "on no
// pane" mark and the activity view's panes scope (fix 250) read the same
// set, so a session on another tab counts as on a pane and one hidden
// from every tab does not.
export function sessionsOnPanes(layout: Layout): Set<string> {
  const out = new Set<string>();
  for (const tab of layout.tabs) {
    for (const id of sessionsOnTab(tab)) out.add(id);
  }
  return out;
}

// Every session in a pane of one tab (M9 fix 261): the activity pane's
// `here` scope, the panes of the tab holding it.
export function sessionsOnTab(tab: LayoutTab): Set<string> {
  const out = new Set<string>();
  for (const pane of listPanes(tab)) {
    if (pane.sessionId !== null) out.add(pane.sessionId);
  }
  return out;
}

// Where a session is shown, or null when no pane has it. A session can be
// in several panes (M50), so the tab named is looked at first, the tab on
// show by default: a click on a row jumps to the pane in front of you
// before one on another tab, and the first pane in tree order within it.
export function paneShowingIn(layout: Layout, sessionId: string, preferTabId: string = layout.currentTabId): { tab: LayoutTab; pane: PaneNode } | null {
  const preferred = findTab(layout, preferTabId);
  const tabs = preferred === null ? layout.tabs : [preferred, ...layout.tabs.filter((t) => t !== preferred)];
  for (const tab of tabs) {
    const pane = listPanes(tab).find((p) => p.sessionId === sessionId);
    if (pane !== undefined) return { tab, pane };
  }
  return null;
}

// Swaps in the edited tab by id. The same object back means the layout
// itself comes back, so a caller can skip the round trip.
export function replaceTab(layout: Layout, tab: LayoutTab): Layout {
  const i = layout.tabs.findIndex((t) => t.id === tab.id);
  if (i < 0) throw new LayoutError(`no tab ${tab.id}`);
  if (layout.tabs[i] === tab) return layout;
  const tabs = layout.tabs.slice();
  tabs[i] = tab;
  return { ...layout, tabs };
}

// Panes 2, Panes 3 and so on: the first number past the count that no
// tab already has, so a rename to Panes 2 does not give two of them.
// With the whole layout as well (M9 fix 924), every window's tabs count,
// so two windows never hold a tab of the same name.
export function nextTabName(layout: Layout, whole: Layout = layout): string {
  const taken = new Set([...layout.tabs, ...whole.tabs].map((t) => t.name));
  for (let n = Math.max(layout.tabs.length, whole.tabs.length) + 1; ; n++) {
    const name = `${FIRST_TAB_NAME} ${n}`;
    if (!taken.has(name)) return name;
  }
}

// An empty tab at the end of the strip, shown at once, as tmux's c does.
export function addTab(layout: Layout, newId: IdGenerator = randomId, whole: Layout = layout): Layout {
  const tab = newTab(nextTabName(layout, whole), newId);
  return { ...layout, tabs: [...layout.tabs, tab], currentTabId: tab.id };
}

// The name itself when no tab has it, else the first of name 2, name 3
// and so on that none has: nextTabName's rule for any base.
export function freeTabName(layout: Layout, name: string, whole: Layout = layout): string {
  const taken = new Set([...layout.tabs, ...whole.tabs].map((t) => t.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const numbered = `${name} ${n}`;
    if (!taken.has(numbered)) return numbered;
  }
}

// A tab named after a group holding one pane per session in a grid
// (M50), at the end of the strip and shown at once. The sessions'
// panes elsewhere are untouched: a session can be in several panes.
export function addGroupTab(layout: Layout, name: string, sessionIds: readonly string[], newId: IdGenerator = randomId, whole: Layout = layout): Layout {
  const trimmed = name.trim();
  if (trimmed === '') throw new LayoutError('a tab name cannot be empty');
  const tab: LayoutTab = { id: newId(), name: freeTabName(layout, trimmed, whole), ...gridTree(sessionIds, newId) };
  return { ...layout, tabs: [...layout.tabs, tab], currentTabId: tab.id };
}

// A tab holding one pane with the content, at the end of the strip (M9
// fix 651, a pane or a row dropped on the +). Unlike addTab and
// addGroupTab it is not shown: the window stays on the tab the drag
// started from.
export function addTabHolding(layout: Layout, name: string, content: PaneContent, newId: IdGenerator = randomId, whole: Layout = layout): Layout {
  const trimmed = name.trim();
  if (trimmed === '') throw new LayoutError('a tab name cannot be empty');
  const tab = dropAtRight(newTab(freeTabName(layout, trimmed, whole), newId), content, newId);
  return { ...layout, tabs: [...layout.tabs, tab] };
}

export function renameTab(layout: Layout, tabId: string, name: string): Layout {
  const tab = findTab(layout, tabId);
  if (tab === null) throw new LayoutError(`no tab ${tabId}`);
  const trimmed = name.trim();
  if (trimmed === '') throw new LayoutError('a tab name cannot be empty');
  return trimmed === tab.name ? layout : replaceTab(layout, { ...tab, name: trimmed });
}

// Closing the shown tab lands on the one to its left, else the one to its
// right, as browsers do. The last tab cannot close: the window always
// shows a tree. Sessions are untouched; a closed tab only hid its panes.
export function closeTab(layout: Layout, tabId: string): Layout {
  const i = layout.tabs.findIndex((t) => t.id === tabId);
  if (i < 0) throw new LayoutError(`no tab ${tabId}`);
  if (layout.tabs.length === 1) throw new LayoutError('the last tab cannot close');
  const tabs = layout.tabs.filter((t) => t.id !== tabId);
  const currentTabId = layout.currentTabId === tabId ? (tabs[i - 1] ?? tabs[i])!.id : layout.currentTabId;
  return { ...layout, tabs, currentTabId };
}

export function switchTab(layout: Layout, tabId: string): Layout {
  if (findTab(layout, tabId) === null) throw new LayoutError(`no tab ${tabId}`);
  return layout.currentTabId === tabId ? layout : { ...layout, currentTabId: tabId };
}

// The tab `step` places after the shown one, wrapping around: tmux's n
// and p. One tab has nowhere to go and comes back unchanged.
export function cycleTabs(layout: Layout, step: number): Layout {
  const i = layout.tabs.findIndex((t) => t.id === layout.currentTabId);
  if (i < 0) throw new LayoutError(`current tab ${layout.currentTabId} is not a tab`);
  const n = layout.tabs.length;
  const next = layout.tabs[(((i + step) % n) + n) % n]!;
  return switchTab(layout, next.id);
}
