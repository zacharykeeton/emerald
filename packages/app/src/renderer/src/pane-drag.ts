import { currentTab, findPane } from '@emerald/shared';
import type { PaneContent, PaneView } from '@emerald/shared';
import { dropOnLayoutTab, dropOnNewTab, dropSessionOn, dropViewOn } from './actions.ts';
import { tabDropTarget, zoneAt } from './drop-zone-model.ts';
import type { TabDropTarget } from './drop-zone-model.ts';
import { viewName } from './show-model.ts';
import { getState } from './store.ts';
import { beginSessionDrag, beginViewDrag, endSessionDrag, getUiState, revealInPane, setSessionDropTarget, setTabDropTarget } from './ui.ts';
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

// Pixels of movement before a press becomes a drag.
export const DRAG_THRESHOLD = 4;

// What a drag carries: a session, from a row or a pane's title, or a
// view (M52), from the rail's Commits tab or a view pane's title.
// A file view from a contents hit carries the hit's line and column (M9
// fix 437), which the pane it lands on reveals.
export type DragPayload = { kind: 'session'; sessionId: string } | { kind: 'view'; view: PaneView; line?: number; column?: number };

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

  const teardown = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('blur', cancel);
    document.body.classList.remove('dragging-session');
    ghost?.remove();
    ghost = null;
    endSessionDrag();
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
    const tab = tabTargetAt(e.clientX, e.clientY);
    if (tab !== null) setTabDropTarget(tab);
    else setSessionDropTarget(targetFor(payload, targetAt(e.clientX, e.clientY)));
  };

  const onUp = () => {
    const target = getUiState().sessionDrag?.target ?? null;
    const tabTarget = getUiState().sessionDrag?.tabTarget ?? null;
    const dropped = dragging;
    teardown();
    if (dropped && tabTarget !== null) {
      // A contents hit's line is not revealed here: the file opens at its
      // top on a tab not on show.
      const content: PaneContent = payload.kind === 'session' ? { sessionId: payload.sessionId, view: null } : { sessionId: null, view: payload.view };
      const drop = 'tabId' in tabTarget ? dropOnLayoutTab(content, tabTarget.tabId, fromPaneId) : dropOnNewTab(content, fromPaneId);
      void drop.catch((err: unknown) => console.warn('[emerald] drop failed', err));
      return;
    }
    if (!dropped || target === null) return;
    if (payload.kind === 'session') {
      void dropSessionOn(payload.sessionId, target.paneId, target.zone, fromPaneId).catch((err: unknown) => console.warn('[emerald] drop failed', err));
      return;
    }
    const { view, line, column } = payload;
    void dropViewOn(view, target.paneId, target.zone, fromPaneId)
      .then((landed) => {
        if (landed !== null && line !== undefined && view.kind === 'file') revealInPane(landed, view.path, line, column);
      })
      .catch((err: unknown) => console.warn('[emerald] drop failed', err));
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

// A view dropped on the centre of a pane holding a session or a view
// would take that off screen for a thing the rail already shows, so a
// view offers only the edges there; an empty pane takes it whole. A
// session's targets are as they were.
function targetFor(payload: DragPayload, target: DropTarget | null): DropTarget | null {
  if (payload.kind !== 'view' || target === null || target.zone !== 'center') return target;
  const layout = getState().layout;
  const pane = layout === null ? null : findPane(currentTab(layout), target.paneId);
  return pane !== null && pane.sessionId === null && pane.view === null ? target : null;
}

// The pane under the point and the half of it the mouse is in. The overlay
// and the ghost have pointer-events none, so they never hide the pane, and
// a pane hidden by zoom is never under the point.
function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane-id]') ?? null;
  const paneId = el?.dataset['paneId'];
  if (el === null || paneId === undefined) return null;
  const zone = zoneAt(el.getBoundingClientRect(), { x, y });
  return zone === null ? null : { paneId, zone };
}

// The layout tab or the + under the point (M9 fix 651). The strip's tab
// is named by .tab-panes, since data-tab-id is also on the layout tab's
// body and its split view.
function tabTargetAt(x: number, y: number): TabDropTarget | null {
  const el = document.elementFromPoint(x, y);
  const tabId = el?.closest<HTMLElement>('.tab-panes[data-tab-id]')?.dataset['tabId'] ?? null;
  const onAdd = el?.closest('.tab-add') != null;
  return tabDropTarget(tabId, onAdd, getState().layout?.currentTabId ?? null);
}
