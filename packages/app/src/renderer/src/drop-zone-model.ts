import type { DropSplit } from '@emerald/shared';

// Where a session dragged from the sidebar would land on the pane under the
// mouse, kept free of DOM types so node:test can pin the geometry. The pane
// draws the matching half (or all of it) while the drag is over it, so what
// this says is what the overlay shows and what the drop does.

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The share of the pane, from each edge, that counts as that edge. A share
// rather than a pixel band because panes run from about 100 px to the whole
// window: a fixed band would leave a small pane with no center and a large
// one with a sliver.
export const EDGE_BAND = 0.25;

// The zone for a point over the box, or null outside it. A point in the
// middle half both ways is center. Otherwise the nearer edge wins, so a
// corner is deterministic: on the exact diagonal the horizontal edge takes
// it, which matters only to the tests.
export function zoneAt(box: Box, p: Point): DropZone | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const u = (p.x - box.left) / box.width;
  const v = (p.y - box.top) / box.height;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const du = Math.min(u, 1 - u);
  const dv = Math.min(v, 1 - v);
  if (du >= EDGE_BAND && dv >= EDGE_BAND) return 'center';
  if (du <= dv) return u < 0.5 ? 'left' : 'right';
  return v < 0.5 ? 'top' : 'bottom';
}

// The split a zone asks for: after is right or below, before is left or
// above. Center is no split at all.
export function zoneToSplit(zone: DropZone): DropSplit | null {
  switch (zone) {
    case 'left':
      return { direction: 'row', place: 'before' };
    case 'right':
      return { direction: 'row', place: 'after' };
    case 'top':
      return { direction: 'column', place: 'before' };
    case 'bottom':
      return { direction: 'column', place: 'after' };
    case 'center':
      return null;
  }
}

// A layout tab or the + under a pane's title or a row being dragged (M9
// fix 651): the drop puts the pane at the far right of that tab, or in a
// tab of its own at the end of the strip.
export type TabDropTarget = { tabId: string } | { newTab: true };

// The tab on show is never a target, for a title (a drop on its own tab
// is nothing) and for a row alike, since its panes are the targets
// there; with no layout yet nothing is.
export function tabDropTarget(tabId: string | null, onAdd: boolean, currentTabId: string | null): TabDropTarget | null {
  if (currentTabId === null) return null;
  if (onAdd) return { newTab: true };
  if (tabId !== null && tabId !== currentTabId) return { tabId };
  return null;
}

// The pointer is past the window's own edge (M9 fix 927), where a drag
// goes to the window under it.
export function pastEdge(p: Point, width: number, height: number): boolean {
  return p.x < 0 || p.y < 0 || p.x >= width || p.y >= height;
}

// M9 fix 1162: what a drag carries, as far as a pane's overlay says it:
// file, a file from Explorer known by its type; unknown, one from Explorer
// that may be a folder (fix 388); file-view, a Files row or a file tab;
// other, a session, a pane's title or the Commits tab.
export type PaneDragKind = 'file' | 'unknown' | 'file-view' | 'other';

// The ui store's SessionDrag fits this as it is, so this file imports
// nothing from ui.ts and stays free of the DOM.
export interface PaneDragRead {
  target: { paneId: string; zone: DropZone } | null;
  explorer: boolean;
  file: boolean;
  view: { kind: string } | null;
}

export function paneDragKind(drag: PaneDragRead): PaneDragKind {
  return drag.explorer ? (drag.file ? 'file' : 'unknown') : drag.view?.kind === 'file' ? 'file-view' : 'other';
}

// The words on the lit part of a pane. A file from Explorer on a pane with
// a session has its path typed whatever the zone; a folder there starts a
// shell by zone, and while it hovers it cannot be told from a file of no
// registered type, so that drag names both outcomes. On an empty pane or a
// view everything opens, here at the centre and beside at an edge.
export function paneDropWord(kind: PaneDragKind, hasSession: boolean, zone: DropZone): string | null {
  const here = zone === 'center';
  switch (kind) {
    case 'file':
      if (hasSession) return 'Type the path';
      return here ? 'Open the file here' : 'Open the file beside';
    case 'unknown':
      if (hasSession) return here ? 'Open here, or type the path' : 'Open beside, or type the path';
      return here ? 'Open here' : 'Open beside';
    case 'file-view':
      return here ? 'Open the file here' : 'Open the file beside';
    case 'other':
      return null;
  }
}

// M9 fix 1162: the part of a pane a drag lights and what a drop there does,
// in emerald's words; Windows' own Copy beside the pointer is the drop
// effect's label and cannot be worded or hidden.
export function paneDropLight(drag: PaneDragRead | null, paneId: string, hasSession: boolean): { zone: DropZone | 'file'; word: string | null } | null {
  if (drag === null || drag.target === null || drag.target.paneId !== paneId) return null;
  const kind = paneDragKind(drag);
  return { zone: kind === 'file' && hasSession ? 'file' : drag.target.zone, word: paneDropWord(kind, hasSession, drag.target.zone) };
}
