import { currentTab, findPane, findTab, focusPane, replaceTab, switchTab } from '@emerald/shared';
import type { Layout, SessionInfo } from '@emerald/shared';
import { nextStop, sameEntry } from './focus-history-model.ts';
import type { FocusEntry } from './focus-history-model.ts';
import { focusTerminal } from './focus.ts';
import { editLayout, getState, subscribe } from './store.ts';
import { PANES, tabName } from './tabs-model.ts';
import type { TabsModel } from './tabs-model.ts';
import { getUiState, recordFocusHistory, showTab, stepFocusHistory, subscribeUi } from './ui.ts';

// M9 fix 184: the focus history behind the strip's back and forward. The
// history is read off the changes of the focused pane, the current tab
// and the active file tab rather than hooked into each mover (a row
// click, the arrows, a tab click, a notification), so every way of moving
// counts. A step back or forward is a move too, so while one is under
// way the places the focus passes through (the panes tab on the way to
// a pane on another layout tab) are not recorded; the target's arrival
// ends the step, or a deadline does when the daemon never brings it.

const STEP_DEADLINE_MS = 3000;

let pending: FocusEntry | null = null;
let pendingUntil = 0;

// Where the focus is now: the active file tab, else the focused pane of
// the current layout tab; null before the first layout.
export function currentFocus(layout: Layout | null, tabs: TabsModel): FocusEntry | null {
  if (tabs.active !== PANES) return { kind: 'file', path: tabs.active };
  if (layout === null) return null;
  const tab = currentTab(layout);
  return { kind: 'pane', tabId: tab.id, paneId: tab.focusedPaneId };
}

// Whether an entry is still somewhere to go: its file tab is open, or its
// pane is in its tab. A hidden pane is out of the tree and so skipped.
export function entryAlive(entry: FocusEntry, layout: Layout | null, tabs: TabsModel): boolean {
  if (entry.kind === 'file') return tabs.files.includes(entry.path);
  if (layout === null) return false;
  const tab = findTab(layout, entry.tabId);
  return tab !== null && findPane(tab, entry.paneId) !== null;
}

// The index of the entry a step would land on, or null when there is
// nothing that way; what the chevrons read for their disabled state.
export function historyStop(step: 1 | -1): number | null {
  const { layout } = getState();
  const { tabs, focusHistory } = getUiState();
  return nextStop(focusHistory, step, (e) => entryAlive(e, layout, tabs));
}

// "emerald in demo 2" for a pane on a session, the file's tab name for a
// file, for the chevrons' titles.
export function describeEntry(entry: FocusEntry, layout: Layout | null, sessions: ReadonlyMap<string, SessionInfo>, titles: ReadonlyMap<string, string>): string {
  if (entry.kind === 'file') return tabName(entry.path, titles);
  const tab = layout === null ? null : findTab(layout, entry.tabId);
  const pane = tab === null ? null : findPane(tab, entry.paneId);
  const session = pane === null || pane.sessionId === null ? undefined : sessions.get(pane.sessionId);
  const what = session !== undefined ? session.name : pane?.view !== null && pane?.view !== undefined ? `the ${pane.view.kind} pane` : 'an empty pane';
  return tab === null ? what : `${what} in ${tab.name}`;
}

export function stepHistory(step: 1 | -1): Promise<void> {
  const i = historyStop(step);
  if (i === null) return Promise.resolve();
  const entry = getUiState().focusHistory.entries[i];
  if (entry === undefined) return Promise.resolve();
  pending = entry;
  pendingUntil = Date.now() + STEP_DEADLINE_MS;
  stepFocusHistory(i);
  return apply(entry);
}

async function apply(entry: FocusEntry): Promise<void> {
  if (entry.kind === 'file') {
    showTab(entry.path);
    return;
  }
  showTab(PANES);
  const layout = getState().layout;
  if (layout === null) return;
  const tab = findTab(layout, entry.tabId);
  if (tab === null) return;
  if (layout.currentTabId !== tab.id || tab.focusedPaneId !== entry.paneId) {
    await editLayout((l) => {
      const t = findTab(l, entry.tabId);
      if (t === null || findPane(t, entry.paneId) === null) return l;
      return switchTab(replaceTab(l, focusPane(t, entry.paneId)), t.id);
    });
  }
  // A tab switch alone does not change any pane's focused flag, so the
  // pane's own focus effect does not run; put the keyboard there once
  // React has drawn the tab.
  setTimeout(focusTerminal, 0);
}

export function installFocusHistory(): () => void {
  const onChange = () => {
    const now = currentFocus(getState().layout, getUiState().tabs);
    if (now === null) return;
    if (pending !== null) {
      if (sameEntry(pending, now)) pending = null;
      else if (Date.now() < pendingUntil) return;
      else pending = null;
    }
    recordFocusHistory(now);
  };
  // The mouse's back and forward buttons over the strip and the panes,
  // as in a browser. auxclick, since mousedown on a pane is its focus.
  const onAux = (ev: MouseEvent) => {
    if (ev.button !== 3 && ev.button !== 4) return;
    if (!(ev.target instanceof Element) || ev.target.closest('.app-center') === null) return;
    ev.preventDefault();
    void stepHistory(ev.button === 3 ? -1 : 1).catch((err: unknown) => console.warn('[emerald] focus history step failed', err));
  };
  const unsubStore = subscribe(onChange);
  const unsubUi = subscribeUi(onChange);
  document.addEventListener('auxclick', onAux);
  onChange();
  return () => {
    unsubStore();
    unsubUi();
    document.removeEventListener('auxclick', onAux);
  };
}
