import { listPanes } from '@emerald/shared';
import type { Layout, LayoutNode, LayoutTab, UseFrom, UseLineIn, UseView } from '@emerald/shared';
import type { PaneMenuRun } from './pane-menu-model.ts';
import { PANES, activityWindow, commitsFolder, isDocument, isTranscript, isWhatsNew, tabKey } from './tabs-model.ts';
import type { TabsModel } from './tabs-model.ts';

// The pure half of the usage record (M9 fix 676): what kind of view a tab
// or a pane is, which views are open, what changed between two looks, and
// the one-record-per-turn gate. use-record.ts wires these to the store.

// The name each pane menu run records under, typed so a new run fails the
// typecheck until it has one (and a USE_FEATURES row in shared).
export const PANE_USE: Readonly<Record<PaneMenuRun, string>> = {
  'split-right': 'pane-split-right',
  'split-down': 'pane-split-down',
  zoom: 'pane-zoom',
  'text-reset': 'pane-text-reset',
  'new-shell': 'pane-new-shell',
  'new-claude': 'pane-new-claude',
  rename: 'pane-rename',
  pick: 'pane-pick',
  find: 'pane-find',
  review: 'pane-review',
  hide: 'pane-hide',
  'close-session': 'pane-close-session',
  'open-as-tab': 'pane-open-as-tab',
  'toggle-chrome': 'pane-toggle-chrome',
  'set-folder': 'pane-set-folder',
};

export function tabKind(path: string): UseView {
  if (activityWindow(path) !== null) return 'activity-tab';
  if (commitsFolder(path) !== null) return 'commits-tab';
  if (path.startsWith('emerald://review/')) return 'review-tab';
  if (isWhatsNew(path)) return 'whats-new-tab';
  if (isDocument(path)) return 'other-tab';
  if (isTranscript(path)) return 'transcript-tab';
  return 'file-tab';
}

type PaneNode = Extract<LayoutNode, { kind: 'pane' }>;

export function paneKind(pane: PaneNode): UseView {
  const view = pane.view;
  if (view !== null) {
    switch (view.kind) {
      case 'commits':
        return 'commits-pane';
      case 'activity':
        return 'activity-pane';
      case 'file':
        return 'file-pane';
      case 'browser':
        return 'browser-pane';
      default:
        return 'other-pane';
    }
  }
  return pane.sessionId !== null ? 'session-pane' : 'empty-pane';
}

// What is in front: the strip tab when it is not the panes, else the
// focused pane of the layout tab on show, else nothing.
export function frontView(tabs: TabsModel, shown: LayoutTab | null): UseView | undefined {
  if (tabs.active !== PANES) return tabKind(tabs.active);
  if (shown === null) return undefined;
  const pane = listPanes(shown).find((p) => p.id === shown.focusedPaneId);
  return pane === undefined ? undefined : paneKind(pane);
}

// Every view open now, by a key that stays put while it does: the panes
// with a view in every layout tab, every strip tab, and the cheat sheet.
// Session and empty panes are not views.
export function openViews(layout: Layout | null, tabs: TabsModel, cheatSheetOpen: boolean): Map<string, UseView> {
  const out = new Map<string, UseView>();
  if (layout !== null) {
    for (const tab of layout.tabs) {
      for (const pane of listPanes(tab)) {
        if (pane.view !== null) out.set(`pane:${pane.id}`, paneKind(pane));
      }
    }
  }
  for (const path of tabs.files) out.set(`tab:${tabKey(path)}`, tabKind(path));
  if (cheatSheetOpen) out.set('cheat-sheet', 'cheat-sheet');
  return out;
}

// The lines between two looks and the open times after them. A null
// `before` is the baseline: nothing is sent, every view starts its clock.
// A key whose kind changed is a close and an open.
export function viewDiff(
  before: ReadonlyMap<string, UseView> | null,
  after: ReadonlyMap<string, UseView>,
  openedAt: ReadonlyMap<string, number>,
  now: number,
): { lines: UseLineIn[]; openedAt: Map<string, number> } {
  const lines: UseLineIn[] = [];
  const next = new Map<string, number>();
  if (before === null) {
    for (const key of after.keys()) next.set(key, now);
    return { lines, openedAt: next };
  }
  const close = (key: string, view: UseView) => {
    const at = openedAt.get(key) ?? now;
    lines.push({ ev: 'view-close', view, ms: Math.max(0, Math.round(now - at)) });
  };
  for (const [key, view] of before) {
    const still = after.get(key);
    if (still === undefined || still !== view) close(key, view);
  }
  for (const [key, view] of after) {
    const was = before.get(key);
    if (was === view) {
      next.set(key, openedAt.get(key) ?? now);
      continue;
    }
    lines.push({ ev: 'view-open', view });
    next.set(key, now);
  }
  return { lines, openedAt: next };
}

// One record per synchronous turn: the first take passes, every later one
// before the scheduled clear is refused. A menu pick that runs splitHere
// which runs another recorded function is one line, not two.
export function createTurnGate(schedule: (fn: () => void) => void): { take(): boolean } {
  let taken = false;
  return {
    take(): boolean {
      if (taken) return false;
      taken = true;
      schedule(() => {
        taken = false;
      });
      return true;
    },
  };
}

// A file from outside the window (M9 fix 700): a launch with one (a
// double-click in Explorer) is recorded apart from emmer open.
export function outsideOpenUse(extra: { launch?: boolean }): { name: 'file-launch' | 'cli-open'; from: UseFrom } {
  return extra.launch === true ? { name: 'file-launch', from: 'click' } : { name: 'cli-open', from: 'cli' };
}
