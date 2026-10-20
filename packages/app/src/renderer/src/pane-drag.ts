import { currentTab, findPane } from '@emerald/shared';
import type { Layout, PaneContent } from '@emerald/shared';
import type { DragPayload } from '../../preload/api.ts';
import { dropOnLayoutTab, dropOnNewTab, dropSessionOn, dropViewOn } from './actions.ts';
import { pastEdge, tabDropTarget, zoneAt } from './drop-zone-model.ts';
import type { TabDropTarget } from './drop-zone-model.ts';
import { viewName } from './show-model.ts';
import { editLayout, getState } from './store.ts';
import { beginSessionDrag, beginViewDrag, endSessionDrag, getUiState, revealInPane, setSessionDropTarget, setTabDropTarget } from './ui.ts';
import { dropOutsideWindows } from './window-drop.ts';
import type { DropTarget } from './ui.ts';

// Dragging a sidebar row, a pane by its title bar (M9 fix 73), or the
// rail's Commits tab as a view (M52), onto a pane. Hand-rolled on window mousemove and
// mouseup like the gutter drag in SplitView.tsx: nothing here uses HTML5
// drag and drop, the row's mousedown already calls preventDefault (which
// would stop a native dragstart anyway), and the CDP harness behind the
// verify scripts can drive mouse events but not native drags.
//
// The press installs the listeners and nothing shows until the mouse has
// moved a few pixels, so a plain click on the row is unchanged. From then
// on a ghost with the session's name follows the mouse on the DOM directly
// (no React), and only the pane and half under the mouse go through the ui
// store, where the pane draws its overlay from them. Release over a pane
// drops; so does a release over another layout tab, which puts a pane at
// its far right, or over the +, which makes a tab of its own at the end
// of the strip, the window staying where it was (M9 fix 651); anywhere
// else, Escape or the window losing focus cancels.
//
// Past the window's own edge (M9 fix 927) nothing of this window stays
// lit and each move goes to main, which forwards it to the window under
// the pointer (window-drag.ts); that window draws its zones and makes the
// drop on the release (window-drop.ts).

// Pixels of movement before a press becomes a drag.
export const DRAG_THRESHOLD = 4;

// What a drag carries, in the preload's types since M9 fix 927 so main
// reads it too.
export type { DragPayload } from '../../preload/api.ts';

const GHOST_OFFSET = 12;

let active = false;

// onBegin is called once, when the press turns into a drag, so the row can
// swallow the click that follows a drag released inside it. fromPaneId is
// the pane a title drag picked up (M9 fix 73), which the drop closes so
// the pane moves; a row drag has none and the drop adds a pane (M50).
// Both hold over a layout tab or the + too (M9 fix 651).
export function startSessionDrag(sessionId: string, press: MouseEvent, onBegin: () => void, fromPaneId: string | null = null): void {
  startDrag({ kind: 'session', sessionId }, press, onBegin, fromPaneId);
}

export function startDrag(payload: DragPayload, press: MouseEvent, onBegin: () => void, fromPaneId: string | null = null): void {
  if (active || press.button !== 0) return;
  active = true;
  const startX = press.clientX;
  const startY = press.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  // The pointer is past the window's edge, the drag handed to main (M9 fix 927).
  let out = false;

  const teardown = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('blur', cancel);
    document.body.classList.remove('dragging-session');
    ghost?.remove();
    ghost = null;
    endSessionDrag();
    // Escape or the blur ends the other window's zones too.
    if (out) window.emerald.windowDrag.back();
    out = false;
    active = false;
  };

  const begin = () => {
    dragging = true;
    onBegin();
    if (payload.kind === 'session') beginSessionDrag(payload.sessionId);
    else beginViewDrag(payload.view);
    document.body.classList.add('dragging-session');
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = payload.kind === 'session' ? (getState().sessions.get(payload.sessionId)?.name ?? payload.sessionId) : viewName(payload.view);
    document.body.appendChild(ghost);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('blur', cancel);
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) {
      if (Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY)) < DRAG_THRESHOLD) return;
      begin();
    }
    if (ghost !== null) ghost.style.transform = `translate(${e.clientX + GHOST_OFFSET}px, ${e.clientY + GHOST_OFFSET}px)`;
    if (pastEdge({ x: e.clientX, y: e.clientY }, window.innerWidth, window.innerHeight)) {
      if (!out) setSessionDropTarget(null);
      out = true;
      window.emerald.windowDrag.move({ kind: 'pane', payload, fromPaneId }, e.clientX, e.clientY);
      return;
    }
    if (out) {
      window.emerald.windowDrag.back();
      out = false;
    }
    const tab = tabTargetAt(e.clientX, e.clientY);
    if (tab !== null) setTabDropTarget(tab);
    else setSessionDropTarget(targetFor(payload, targetAt(e.clientX, e.clientY)));
  };

  const onUp = (e: MouseEvent) => {
    const target = getUiState().sessionDrag?.target ?? null;
    const tabTarget = getUiState().sessionDrag?.tabTarget ?? null;
    const dropped = dragging;
    const handed = out;
    // Cleared first, so the teardown sends no back for a drag main is ending.
    out = false;
    teardown();
    if (dropped && handed) {
      // Another window made the drop, or none was under the pointer and
      // a window opens there (M9 fix 928).
      const drag = { kind: 'pane', payload, fromPaneId } as const;
      void window.emerald.windowDrag
        .end(e.clientX, e.clientY)
        .then((end) => (end.to === 'none' ? dropOutsideWindows(drag, end.x, end.y) : undefined))
        .catch((err: unknown) => console.warn('[emerald] drop failed', err));
      return;
    }
    if (!dropped) return;
    void dropPayload(payload, fromPaneId, target, tabTarget).catch((err: unknown) => console.warn('[emerald] drop failed', err));
  };

  const cancel = () => teardown();

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// The drop a release makes on a layout tab, the + or a pane's zone, with
// the edit of this window (editLayout) or, for a drag from another window,
// the whole layout's (editAllLayout, M9 fix 927). Nothing under the
// pointer is nothing.
export async function dropPayload(payload: DragPayload, fromPaneId: string | null, target: DropTarget | null, tabTarget: TabDropTarget | null, edit: (fn: (l: Layout) => Layout) => Promise<Layout> = editLayout): Promise<void> {
  if (tabTarget !== null) {
    const content: PaneContent = payload.kind === 'session' ? { sessionId: payload.sessionId, view: null } : { sessionId: null, view: payload.view };
    const landed = await ('tabId' in tabTarget ? dropOnLayoutTab(content, tabTarget.tabId, fromPaneId, edit) : dropOnNewTab(content, fromPaneId, edit));
    if (landed !== null && payload.kind === 'view' && payload.line !== undefined && payload.view.kind === 'file') revealInPane(landed, payload.view.path, payload.line, payload.column);
    return;
  }
  if (target === null) return;
  if (payload.kind === 'session') {
    await dropSessionOn(payload.sessionId, target.paneId, target.zone, fromPaneId, edit);
    return;
  }
  const { view, line, column } = payload;
  const landed = await dropViewOn(view, target.paneId, target.zone, fromPaneId, edit);
  if (landed !== null && line !== undefined && view.kind === 'file') revealInPane(landed, view.path, line, column);
}

// A view dropped on the centre of a pane holding a session or a view
// would take that off screen for a thing the rail already shows, so a
// view offers only the edges there; an empty pane takes it whole. A
// session's targets are as they were.
export function targetFor(payload: DragPayload, target: DropTarget | null): DropTarget | null {
  if (payload.kind !== 'view' || target === null || target.zone !== 'center') return target;
  const layout = getState().layout;
  const pane = layout === null ? null : findPane(currentTab(layout), target.paneId);
  return pane !== null && pane.sessionId === null && pane.view === null ? target : null;
}

// The pane under the point and the half of it the mouse is in. The overlay
// and the ghost have pointer-events none, so they never hide the pane, and
// a pane hidden by zoom is never under the point.
export function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane-id]') ?? null;
  const paneId = el?.dataset['paneId'];
  if (el === null || paneId === undefined) return null;
  const zone = zoneAt(el.getBoundingClientRect(), { x, y });
  return zone === null ? null : { paneId, zone };
}

// The layout tab or the + under the point (M9 fix 651). The strip's tab
// is named by .tab-panes, since data-tab-id is also on the layout tab's
// body and its split view.
export function tabTargetAt(x: number, y: number): TabDropTarget | null {
  const el = document.elementFromPoint(x, y);
  const tabId = el?.closest<HTMLElement>('.tab-panes[data-tab-id]')?.dataset['tabId'] ?? null;
  const onAdd = el?.closest('.tab-add') != null;
  return tabDropTarget(tabId, onAdd, getState().layout?.currentTabId ?? null);
}
