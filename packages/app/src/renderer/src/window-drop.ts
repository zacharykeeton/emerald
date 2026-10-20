import { moveTabToWindow, tabHolding } from '@emerald/shared';
import type { PaneContent } from '@emerald/shared';
import type { WindowDrag } from '../../preload/api.ts';
import { dropOnNewTab } from './actions.ts';
import { dropPayload, tabTargetAt, targetAt, targetFor } from './pane-drag.ts';
import { markDropAt } from './tab-drag.ts';
import { layoutTabKey } from './tab-order.ts';
import { PANES } from './tabs-model.ts';
import { editAllLayout, getState } from './store.ts';
import { beginSessionDrag, beginViewDrag, endSessionDrag, getUiState, moveTabKey, revealInPane, setSessionDropTarget, setTabDropTarget, showTab } from './ui.ts';

// This window as the target of another window's drag (M9 fix 927). Main
// forwards the moves of a drag that has left its window (window-drag.ts)
// at this page's client points: a pane drag draws its zones here as a
// drag of this window's own would (the ui store's sessionDrag, which the
// panes and the strip draw from), a layout tab's draws its line in this
// strip, and the release makes the drop as a whole-layout edit, since the
// pane or the tab it moves is another window's.

// The strip's tab that holds the line now.
let marked: HTMLElement | null = null;

const clearMark = () => {
  if (marked !== null) delete marked.dataset['drop'];
  marked = null;
};

const stripEl = () => document.querySelector<HTMLElement>('.tab-strip-scroll');

// The zone or tab under a pane drag's point, set in the ui store.
function lightPane(drag: Extract<WindowDrag, { kind: 'pane' }>, x: number, y: number): void {
  if (getUiState().sessionDrag === null) {
    const { payload } = drag;
    if (payload.kind === 'session') beginSessionDrag(payload.sessionId);
    else beginViewDrag(payload.view);
    // The browser pages give the pointer up while something is dragged,
    // so the hit test reaches the pane under a page (M9 fix 669).
    document.body.classList.add('dragging-session');
  }
  const tab = tabTargetAt(x, y);
  if (tab !== null) setTabDropTarget(tab);
  else setSessionDropTarget(targetFor(drag.payload, targetAt(x, y)));
}

function clearAll(): void {
  if (getUiState().sessionDrag !== null) endSessionDrag();
  document.body.classList.remove('dragging-session');
  clearMark();
}

function lineAt(x: number): string | null {
  clearMark();
  const strip = stripEl();
  if (strip === null) return null;
  const at = markDropAt(strip, x, null);
  marked = at.marked;
  return at.before;
}

// A drag released outside every window (M9 fix 928): a tab, or a new tab
// holding the pane, opens a window of its own there, as a browser does.
// The pane's tab is made in this window first and moved by window.open,
// so it is never a window's only tab and the daemon never refuses it; a
// window's only tab dragged out is refused there and stays.
export async function dropOutsideWindows(drag: WindowDrag, x: number, y: number): Promise<void> {
  if (drag.kind === 'tab') {
    await window.emerald.windowDrag.open(drag.tabId, x, y);
    return;
  }
  const { payload } = drag;
  const content: PaneContent = payload.kind === 'session' ? { sessionId: payload.sessionId, view: null } : { sessionId: null, view: payload.view };
  const landed = await dropOnNewTab(content, drag.fromPaneId);
  const all = getState().allLayout;
  const tab = landed === null || all === null ? null : tabHolding(all, landed);
  if (landed === null || tab === null) return;
  await window.emerald.windowDrag.open(tab.id, x, y);
  if (payload.kind === 'view' && payload.line !== undefined && payload.view.kind === 'file') revealInPane(landed, payload.view.path, payload.line, payload.column);
}

export function startWindowDropTarget(): void {
  window.emerald.windowDrag.onTarget((msg) => {
    if (msg.type === 'leave') {
      clearAll();
      return;
    }
    const { drag, x, y } = msg;
    if (msg.type === 'over') {
      if (drag.kind === 'pane') lightPane(drag, x, y);
      else lineAt(x);
      return;
    }
    // The drop: the lookup made fresh at its point, then everything this
    // window lit cleared before the edit.
    if (drag.kind === 'pane') {
      const tabTarget = tabTargetAt(x, y);
      const target = tabTarget === null ? targetFor(drag.payload, targetAt(x, y)) : null;
      clearAll();
      void dropPayload(drag.payload, drag.fromPaneId, target, tabTarget, editAllLayout).catch((err: unknown) => console.warn('[emerald] drop failed', err));
      return;
    }
    const before = lineAt(x);
    clearAll();
    const windowId = getState().windowId;
    if (windowId === null) return;
    const { tabId } = drag;
    void editAllLayout((l) => moveTabToWindow(l, tabId, windowId))
      .then(() => {
        const layout = getState().layout;
        if (layout === null) return;
        moveTabKey(layoutTabKey(tabId), before, layout.tabs.map((t) => t.id));
        showTab(PANES);
      })
      .catch((err: unknown) => console.warn('[emerald] drop failed', err));
  });
}
