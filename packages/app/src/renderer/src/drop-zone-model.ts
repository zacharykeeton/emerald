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
