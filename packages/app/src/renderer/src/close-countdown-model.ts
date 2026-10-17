import { findPane, parentSplit, replaceTab, switchTab, tabHolding } from '@emerald/shared';
import type { IdGenerator, Layout, LayoutNode, LayoutTab, SplitDirection, SplitPlace } from '@emerald/shared';

// M9 fix 787: how long a closed Claude session's Exited row counts down before it is removed; long enough to reach Resume, short enough that the row is gone before a person goes looking to clear it.
export const REMOVE_AFTER_MS = 10_000;

// Where a closed pane sat, kept so Resume during the count can put the
// session back into the same spot: the sibling that took its place, and
// the split it made with it. A lone root pane has no sibling; closing it
// emptied the pane in place, so the pane itself is the spot.
export interface ClosedSpot {
  tabId: string;
  paneId: string;
  siblingId: string | null;
  direction: SplitDirection;
  place: SplitPlace;
  ratio: number;
}

// One Exited row's count. started is false until the session reads exited;
// runningSince is null while paused (a hover) or not yet started.
export interface RemovalCount {
  spot: ClosedSpot | null;
  started: boolean;
  leftMs: number;
  runningSince: number | null;
}

export function closedSpot(layout: Layout, paneId: string): ClosedSpot | null {
  const tab = tabHolding(layout, paneId);
  if (tab === null) return null;
  const parent = parentSplit(tab, paneId);
  if (parent === null) return { tabId: tab.id, paneId, siblingId: null, direction: 'row', place: 'after', ratio: 0.5 };
  const first = parent.first.id === paneId;
  return {
    tabId: tab.id,
    paneId,
    siblingId: first ? parent.second.id : parent.first.id,
    direction: parent.direction,
    place: first ? 'before' : 'after',
    ratio: parent.ratio,
  };
}

// tree.ts keeps its replaceNode private and is not this fix's file.
function replaceNode(node: LayoutNode, id: string, replacement: LayoutNode): LayoutNode {
  if (node.id === id) return replacement;
  if (node.kind === 'pane') return node;
  const first = replaceNode(node.first, id, replacement);
  const second = replaceNode(node.second, id, replacement);
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  if (node.kind === 'pane') return null;
  return findNode(node.first, id) ?? findNode(node.second, id);
}

// The layout with the session back in the spot, or null when the spot has
// gone (the tab closed, the sibling closed, the lone pane taken again) and
// the caller falls back to a pane beside the focused one.
export function reopenAt(layout: Layout, spot: ClosedSpot, sessionId: string, newId: IdGenerator): Layout | null {
  const tab = layout.tabs.find((t) => t.id === spot.tabId);
  if (tab === undefined) return null;
  if (spot.siblingId === null) {
    const pane = findPane(tab, spot.paneId);
    if (pane === null || pane.sessionId !== null || pane.view !== null) return null;
    const next: LayoutTab = { ...tab, root: replaceNode(tab.root, pane.id, { ...pane, sessionId }), focusedPaneId: pane.id };
    return switchTab(replaceTab(layout, next), tab.id);
  }
  const sibling = findNode(tab.root, spot.siblingId);
  if (sibling === null) return null;
  const pane: LayoutNode = { kind: 'pane', id: newId(), sessionId, view: null };
  const [first, second] = spot.place === 'before' ? [pane, sibling] : [sibling, pane];
  const split: LayoutNode = { kind: 'split', id: newId(), direction: spot.direction, ratio: spot.ratio, first, second };
  const next: LayoutTab = { ...tab, root: replaceNode(tab.root, spot.siblingId, split), focusedPaneId: pane.id };
  return switchTab(replaceTab(layout, next), tab.id);
}

// The time run is clamped at zero (M9 fix 814): the sidebar's clock is the
// last tick's, up to a second older than a count's start, so an unclamped
// read opened at 11s.
export function secondsLeft(count: RemovalCount, now: number): number {
  const left = count.runningSince === null ? count.leftMs : count.leftMs - Math.max(0, now - count.runningSince);
  return Math.max(1, Math.ceil(left / 1000));
}

// M9 fix 814: a pointer already on the row when its count starts holds it,
// since no mouseenter comes for a pointer that has not moved.
export function holdsOnStart(count: RemovalCount | undefined, hovered: boolean): boolean {
  return count !== undefined && count.started && count.runningSince !== null && hovered;
}

export function removalWords(seconds: number): string {
  return `removing in ${seconds}s`;
}
