import { useSyncExternalStore } from 'react';

// The browser layer's model (M9 fix 669). Every browser pane's page lives
// in one window-level layer (BrowserLayer.tsx) rather than inside its
// pane, since a <webview> taken out of the document drops its guest and a
// re-inserted one loads a new page: a split, a close beside the pane or
// a move re-parents the pane in the tree, and the page used to load again
// each time. The pane keeps a slot where the page shows; the layer lays
// the page over it. This file holds the pure rules (which frame a pane
// gets, where a frame sits), the slots the panes register and the page
// state the toolbar and the title row read.

// The renderer's tsconfig has no electron types, so the element is typed
// by the methods used here alone.
export interface WebviewLike extends HTMLElement {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  reload(): void;
  reloadIgnoringCache(): void;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
}

// The pane's focus ring is `.pane::after`'s 3px border (style.css), at
// z-index 3 inside the pane; the layer sits above every pane, so a frame
// laid over the whole slot would cover the ring's left, right and bottom
// edges. The slot starts under the toolbar, so the top needs no inset.
export const RING_PX = 3;

export interface FrameBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Where a frame sits, relative to the layer's host (`.panes-view`), for a
// slot at `slot` in window coordinates.
export function frameRect(slot: DOMRectReadOnly, host: DOMRectReadOnly): FrameBox {
  return {
    left: slot.left - host.left + RING_PX,
    top: slot.top - host.top,
    width: Math.max(0, slot.width - 2 * RING_PX),
    height: Math.max(0, slot.height - RING_PX),
  };
}

// Which frame each browser pane gets after a layout change: pane id to
// frame id. A pane already holding a frame keeps it (a split, a close
// beside it). A move makes a new pane id and drops the old one in the same
// edit (fix 651's drag across tabs, a drop on a pane), so a vanished pane
// and a new one on the same URL are one pane moved and the new id takes
// the old frame, the first match in `panes` order. Any other vanished
// pane loses its frame; any other new pane gets a new one.
export function adoptFrames(
  prev: ReadonlyMap<string, string>,
  panes: readonly { id: string; url: string }[],
  prevUrls: ReadonlyMap<string, string>,
  newFrameId: () => string,
): Map<string, string> {
  const live = new Set(panes.map((p) => p.id));
  const vanished = [...prev.keys()].filter((id) => !live.has(id));
  const next = new Map<string, string>();
  for (const pane of panes) {
    const kept = prev.get(pane.id);
    if (kept !== undefined) {
      next.set(pane.id, kept);
      continue;
    }
    const at = vanished.findIndex((id) => prevUrls.get(id) === pane.url);
    if (at !== -1) {
      next.set(pane.id, prev.get(vanished[at]!)!);
      vanished.splice(at, 1);
    } else {
      next.set(pane.id, newFrameId());
    }
  }
  return next;
}

// The slots: each browser pane's `.browser-body`, registered by its ref
// callback, which the layer reads to place the pane's frame.
const slots = new Map<string, HTMLElement>();
const slotListeners = new Set<() => void>();

export function registerBrowserSlot(paneId: string, el: HTMLElement | null): void {
  if (el === null) {
    if (!slots.has(paneId)) return;
    slots.delete(paneId);
  } else {
    if (slots.get(paneId) === el) return;
    slots.set(paneId, el);
  }
  for (const fn of slotListeners) fn();
}

export function browserSlot(paneId: string): HTMLElement | null {
  return slots.get(paneId) ?? null;
}

export function allBrowserSlots(): HTMLElement[] {
  return [...slots.values()];
}

export function subscribeSlots(fn: () => void): () => void {
  slotListeners.add(fn);
  return () => slotListeners.delete(fn);
}

// What the toolbar and the title row show of a pane's page. Kept by frame
// and read by pane id through the layer's map, so a moved pane's new id
// reads the state its page already had.
export interface PageState {
  back: boolean;
  forward: boolean;
  error: string | null;
  title: string;
  // The page's own address after its last navigation, '' before one.
  url: string;
  ready: boolean;
}

const EMPTY: PageState = { back: false, forward: false, error: null, title: '', url: '', ready: false };
const pages = new Map<string, PageState>();
const elements = new Map<string, WebviewLike>();
let paneFrames: ReadonlyMap<string, string> = new Map();
const pageListeners = new Set<() => void>();

function notifyPages(): void {
  for (const fn of pageListeners) fn();
}

function subscribePages(fn: () => void): () => void {
  pageListeners.add(fn);
  return () => pageListeners.delete(fn);
}

// The layer's pane-to-frame map, set on each layout change.
export function setPaneFrames(map: ReadonlyMap<string, string>): void {
  paneFrames = map;
  notifyPages();
}

export function paneOfFrame(frameId: string): string | null {
  for (const [paneId, f] of paneFrames) if (f === frameId) return paneId;
  return null;
}

export function setFrameElement(frameId: string, el: WebviewLike | null): void {
  if (el === null) elements.delete(frameId);
  else elements.set(frameId, el);
}

export function framePageState(frameId: string): PageState {
  return pages.get(frameId) ?? EMPTY;
}

export function patchPageState(frameId: string, patch: Partial<PageState>): void {
  pages.set(frameId, { ...framePageState(frameId), ...patch });
  notifyPages();
}

export function dropPageState(frameId: string): void {
  pages.delete(frameId);
  elements.delete(frameId);
  notifyPages();
}

function pageStateOf(paneId: string): PageState {
  const frameId = paneFrames.get(paneId);
  return frameId === undefined ? EMPTY : framePageState(frameId);
}

export function useBrowserPage(paneId: string): PageState {
  return useSyncExternalStore(subscribePages, () => pageStateOf(paneId));
}

export function useFramePage(frameId: string): PageState {
  return useSyncExternalStore(subscribePages, () => framePageState(frameId));
}

// The pane's page once it has reached dom-ready (its methods throw
// before), for the toolbar's buttons; null before then or with no page.
export function browserPage(paneId: string): WebviewLike | null {
  const frameId = paneFrames.get(paneId);
  if (frameId === undefined || !framePageState(frameId).ready) return null;
  return elements.get(frameId) ?? null;
}

// The pane whose page is the guest with this web contents id (fix 670's
// click into a page), or null.
export function paneOfWebContents(webContentsId: number): string | null {
  for (const [frameId, el] of elements) {
    if (!framePageState(frameId).ready) continue;
    try {
      if (el.getWebContentsId() === webContentsId) return paneOfFrame(frameId);
    } catch {
      // A page part way through its teardown.
    }
  }
  return null;
}
