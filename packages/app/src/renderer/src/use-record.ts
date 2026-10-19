import { currentTab } from '@emerald/shared';
import type { Layout, UseFrom, UseLineIn, UseView } from '@emerald/shared';
import { getState, subscribe } from './store.ts';
import type { TabsModel } from './tabs-model.ts';
import { getUiState, subscribeUi } from './ui.ts';
import { createTurnGate, frontView, openViews, viewDiff } from './use-record-model.ts';

// The usage record's calls (M9 fix 676). Nothing is sent while the switch
// on the app menu (fix 887) is off, which is the default. An action is
// recorded by the first statement of the function its input reached, one
// per synchronous turn; views are read by a diff of the open set, so every
// route that opens one is seen once.

const gate = createTurnGate((fn) => queueMicrotask(fn));
let inMenu = false;

function send(line: UseLineIn): void {
  window.emerald.useRecord.write(line);
}

function shown() {
  const layout = getState().layout;
  return layout === null ? null : currentTab(layout);
}

export function recordUse(name: string, from?: UseFrom): void {
  if (!getUiState().usageRecord) return;
  if (!gate.take()) return;
  const view = frontView(getUiState().tabs, shown());
  const source: UseFrom = from ?? (inMenu ? 'menu' : 'click');
  send(view === undefined ? { ev: 'action', name, from: source } : { ev: 'action', name, from: source, view });
}

// Runs a menu row's handler with its source marked as the menu for the
// rest of the turn, so the recorded function it reaches reads `menu`.
export function asMenu(fn: () => void): void {
  if (!inMenu) {
    inMenu = true;
    queueMicrotask(() => {
      inMenu = false;
    });
  }
  fn();
}

export function installUseRecord(): () => void {
  let before: Map<string, UseView> | null = null;
  let openedAt = new Map<string, number>();
  let seen: { layout: Layout | null; tabs: TabsModel; cheat: boolean } | null = null;
  const look = () => {
    const ui = getUiState();
    if (!ui.usageRecord) {
      before = null;
      seen = null;
      openedAt = new Map();
      return;
    }
    const layout = getState().layout;
    // The first layout is the baseline's; until it arrives there is
    // nothing to compare, and a restore must not read as twenty opens.
    if (layout === null) return;
    if (seen !== null && seen.layout === layout && seen.tabs === ui.tabs && seen.cheat === ui.cheatSheetOpen) return;
    seen = { layout, tabs: ui.tabs, cheat: ui.cheatSheetOpen };
    const after = openViews(layout, ui.tabs, ui.cheatSheetOpen);
    const diff = viewDiff(before, after, openedAt, Date.now());
    before = after;
    openedAt = diff.openedAt;
    for (const line of diff.lines) send(line);
  };
  const offStore = subscribe(look);
  const offUi = subscribeUi(look);
  look();
  return () => {
    offStore();
    offUi();
  };
}
