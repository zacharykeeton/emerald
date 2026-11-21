import { paneShowingIn, type Layout } from '@emerald/shared';

// Where emmer open puts a pane (M9 fix 1197): beside the session a typed
// --beside names, else beside the session that ran the command (the opener,
// sent for a URL or --browser), on whichever tab holds that session's pane.
// typed says the reply names the pane and tab (fix 404); inFront says
// whether that tab is the one on show, since an opener's tab is never put
// in front. Null when neither names a session on a pane of this layout.
export interface BesideTarget {
  paneId: string;
  tabId: string;
  tabName: string;
  inFront: boolean;
  typed: boolean;
}

export function besideTarget(layout: Layout | null, beside: string | undefined, opener: string | undefined): BesideTarget | null {
  const sessionId = beside ?? opener;
  if (layout === null || sessionId === undefined) return null;
  const shown = paneShowingIn(layout, sessionId);
  if (shown === null) return null;
  return { paneId: shown.pane.id, tabId: shown.tab.id, tabName: shown.tab.name, inFront: shown.tab.id === layout.currentTabId, typed: beside !== undefined };
}
