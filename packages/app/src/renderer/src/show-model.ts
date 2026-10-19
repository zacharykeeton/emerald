import { currentTab, findPane, folderTitle, paneShowingIn, unitBounds, windowName } from '@emerald/shared';
import type { Layout, PaneView, SessionInfo } from '@emerald/shared';
import { tabName } from './tabs-model.ts';

// M9 fix 91: a click on a sidebar row whose session is on no pane used
// to put it in the focused pane without a word, and what was there went
// off screen, which read as losing it. The row asks first (Sidebar.tsx's
// chooser), unless the person has said once what they want.
export type ShowOffscreen = 'ask' | 'replace' | 'beside';

export const SHOW_OFFSCREEN: readonly ShowOffscreen[] = ['ask', 'replace', 'beside'];

// What a view pane is called wherever a name is needed (M69): the
// replace question, the drag ghost, the pane title. A commits view is
// its folder, an activity view its window, named as the tab names it,
// a file view (M9 fix 180) its file's name, a browser view (M9 fix 659)
// its page's host.
export function viewName(view: PaneView): string {
  if (view.kind === 'commits') return `Commits · ${folderTitle(view.folder)}`;
  if (view.kind === 'file') return tabName(view.path);
  if (view.kind === 'browser') return view.url === '' ? 'Browser' : `Browser · ${new URL(view.url).host}`;
  const window = unitBounds(view.window);
  return `Activity · ${window === null ? view.window : windowName(window)}`;
}

export function isShowOffscreen(value: unknown): value is ShowOffscreen {
  return typeof value === 'string' && (SHOW_OFFSCREEN as readonly string[]).includes(value);
}

// What a plain click on this row would push off screen (M9 fix 95): a
// live session, which stays running and can be shown again, or an M52
// view, which is not kept anywhere and simply goes.
export type Replaced = { kind: 'session'; sessionId: string } | { kind: 'view'; name: string };

// The occupant of the focused pane a plain click on this row would push
// off screen: the one in the focused pane of the tab on show, when the
// clicked session is on no pane of any tab (a session already on a pane
// is jumped to, M50) and the focused pane holds a session that has not
// exited (an exited one is gone rather than at rest, and an empty pane is
// simply filled) or a view.
export function wouldReplace(layout: Layout | null, sessions: ReadonlyMap<string, Pick<SessionInfo, 'state'>>, sessionId: string): Replaced | null {
  if (layout === null) return null;
  if (paneShowingIn(layout, sessionId, layout.currentTabId) !== null) return null;
  const tab = currentTab(layout);
  const focused = findPane(tab, tab.focusedPaneId);
  if (focused === null) return null;
  if (focused.view !== null) return { kind: 'view', name: viewName(focused.view) };
  if (focused.sessionId === null || focused.sessionId === sessionId) return null;
  const there = sessions.get(focused.sessionId);
  return there === undefined || there.state === 'exited' ? null : { kind: 'session', sessionId: focused.sessionId };
}

// The name of the tab Open in a new tab makes (M9 fix 578): the session's
// folder heading as the sidebar shows it (groupSessions' title rule), so
// the tab and the heading's own tab button (M50) agree. An exited session
// is named by its folder, not by the Exited group; a folder that names
// nothing falls back to the session's name, since a tab name cannot be empty.
export function newTabNameFor(session: Pick<SessionInfo, 'groupCwd' | 'name'>, labels: ReadonlyMap<string, string>): string {
  const title = labels.get(session.groupCwd) ?? folderTitle(session.groupCwd);
  return title.trim() === '' ? session.name : title;
}

// The name of the tab a folder from outside opens (M9 fix 886): the
// folder's sidebar label when it has one, else its own name, fix 578's
// rule for a folder with no session yet.
export function folderTabName(folder: string, labels: ReadonlyMap<string, string>): string {
  const title = labels.get(folder) ?? folderTitle(folder);
  return title.trim() === '' ? folder : title;
}
