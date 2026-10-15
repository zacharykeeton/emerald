import { currentTab, findPane, listPanes } from '@emerald/shared';
import type { Layout, PaneView, SessionInfo } from '@emerald/shared';
import { useStore } from './store.ts';

// Which sessions are on screen, and which one is in the focused pane, so a
// sidebar row or a palette row can say so: after Hide it is the one thing
// that tells a listed session from a shown one. On screen means in the
// layout tab on show (M36); a session in a pane of another tab is not,
// and since M9 fix 249 it is marked elsewhere with that tab's name, so a
// row on no pane of any tab (the orphans Hide and a closed tab leave)
// reads apart from one a tab away. A session on several tabs takes the
// first tab in order that holds it. Whether the layout tab on show is on
// screen at all is the strip's business, not the daemon's (M9 fix 269):
// with a file, commits or What's New tab in front no pane is visible, so
// every session on the current tab reads elsewhere with that tab's name
// too, and focused is never said of a pane nobody can see.
//
// Under the Focus zoom (M9 fix 728) the other panes of the current tab are
// in the layout but hidden, so their sessions read covered, behind the
// Focus. The zoom always sits on the focused pane of the current tab, so
// a zoom id that is not a pane of that tab is ignored.
export type ShownPlace = 'focused' | 'shown' | 'covered' | 'elsewhere';
export type Shown = { place: 'focused' | 'shown' | 'covered' } | { place: 'elsewhere'; tab: string };

const FOCUSED: Shown = { place: 'focused' };
const SHOWN: Shown = { place: 'shown' };
const COVERED: Shown = { place: 'covered' };

export function shownSessions(layout: Layout | null, panesShown: boolean, zoomedPaneId: string | null = null): ReadonlyMap<string, Shown> {
  const out = new Map<string, Shown>();
  if (layout === null) return out;
  const tab = currentTab(layout);
  for (const other of layout.tabs) {
    if (other === tab && panesShown) continue;
    for (const pane of listPanes(other)) {
      if (pane.sessionId !== null && !out.has(pane.sessionId)) out.set(pane.sessionId, { place: 'elsewhere', tab: other.name });
    }
  }
  if (!panesShown) return out;
  const zoomed = zoomedPaneId === null ? null : findPane(tab, zoomedPaneId);
  for (const pane of listPanes(tab)) {
    if (pane.sessionId !== null && zoomed !== null && pane.id !== zoomed.id) out.set(pane.sessionId, COVERED);
    else if (pane.sessionId !== null) out.set(pane.sessionId, SHOWN);
  }
  if (zoomed?.sessionId != null) out.set(zoomed.sessionId, SHOWN);
  const focused = findPane(tab, tab.focusedPaneId);
  if (focused?.sessionId != null) out.set(focused.sessionId, FOCUSED);
  return out;
}

// The word a row prints for where a session is: focused, on screen, on
// the tab that holds it, or on no pane at all; null for an exited
// session, which is on no pane by nature and has its own sweep.
export function shownWords(where: Shown | undefined, exited: boolean): string | null {
  if (exited) return null;
  if (where === undefined) return 'on no pane';
  if (where.place === 'focused') return 'focused';
  if (where.place === 'elsewhere') return `on ${where.tab}`;
  if (where.place === 'covered') return 'behind the Focus';
  return 'on screen';
}

// The value the row carries for the scripts and the CSS: the place, or
// none for a live session on no pane.
export function shownData(where: Shown | undefined, exited: boolean): ShownPlace | 'none' | undefined {
  if (exited) return undefined;
  return where === undefined ? 'none' : where.place;
}

// The session in the focused pane of the tab on show, null for an empty
// pane: the files rail's root (M10), the Timeline's split (M45) and the
// Sessions panel's fold (M9 fix 84) all follow it. An exited session
// still counts, since it still has a folder.
export function useFocusedSession(): SessionInfo | null {
  const { layout, sessions } = useStore('layout', 'sessions');
  if (layout === null) return null;
  const tab = currentTab(layout);
  const pane = findPane(tab, tab.focusedPaneId);
  if (pane?.sessionId == null) return null;
  return sessions.get(pane.sessionId) ?? null;
}

// The view in the focused pane of the tab on show (M52), null for a pane
// holding a session or nothing: the files rail takes its folder as the
// root, so a focused commits view has the repo's files beside it rather
// than an empty rail.
export function useFocusedView(): PaneView | null {
  const { layout } = useStore('layout');
  if (layout === null) return null;
  const tab = currentTab(layout);
  return findPane(tab, tab.focusedPaneId)?.view ?? null;
}
