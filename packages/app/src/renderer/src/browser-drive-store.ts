import { useSyncExternalStore } from 'react';
import type { BrowserDriveState } from '../../preload/api.ts';

// M9 fix 672: emmer browser's mark on a browser pane. The main process
// pushes each pane's state while a command runs (and for a few seconds
// after) as emerald:browser-drive; this keeps it per pane for the title
// row. Nothing touches window at import, so node:test reaches driveMark;
// the subscription starts on the first useBrowserDrive.

let states: ReadonlyMap<string, BrowserDriveState> = new Map();
const listeners = new Set<() => void>();
let wired = false;

function wire(): void {
  if (wired) return;
  wired = true;
  window.emerald.browser.onDrive((paneId, state) => {
    const next = new Map(states);
    if (state === null) next.delete(paneId);
    else next.set(paneId, state);
    states = next;
    for (const l of listeners) l();
  });
}

function subscribe(l: () => void): () => void {
  wire();
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useBrowserDrive(paneId: string): BrowserDriveState {
  return useSyncExternalStore(subscribe, () => states.get(paneId) ?? null);
}

// The mark's words: who drives, or (M9 fix 673) whose commands a click or
// a key of the person's paused. null is no mark.
export function driveMark(state: BrowserDriveState): { text: string; title: string } | null {
  if (state === null) return null;
  if (state.paused) return { text: `${state.by} paused`, title: `A click or a key of yours paused ${state.by}'s commands` };
  return { text: `${state.by} is driving`, title: `${state.by} is driving this page with emmer browser; a click or a key in the page pauses it` };
}

// The page element of a browser pane, wired for the driver. On each
// attach the guest is registered for the pane in the main process. A key
// or a fill reaches a guest only while its page holds the window's
// keyboard (a CDP key on a guest goes to the window's focused widget), so
// before one main asks this page to take the focus, and the element that
// held it when the command started gets it back the moment the command
// ends: the person's keyboard is away for the command alone. A click or
// a snapshot leaves the focus alone, and a person's own click into the
// page between commands keeps it there.
export function wireDrivenPage(page: HTMLElement & { getWebContentsId(): number }, paneId: () => string): () => void {
  const onAttach = () => {
    try {
      window.emerald.browser.guest(paneId(), page.getWebContentsId());
    } catch {
      // Not attached after all; the next did-attach registers it.
    }
  };
  let held: Element | null = null;
  let running = false;
  const onState = () => {
    const now = states.get(paneId())?.running === true;
    if (now && !running) {
      const active = document.activeElement;
      held = active !== null && active !== page ? active : null;
    }
    if (!now && running && held !== null && held.isConnected && document.activeElement === page) {
      (held as HTMLElement).focus({ preventScroll: true });
    }
    if (!now) held = null;
    running = now;
  };
  // Main's ask before a key or a fill.
  const offTake = window.emerald.browser.onTakeFocus((asked, token) => {
    if (asked !== paneId()) return;
    page.focus();
    window.emerald.browser.tookFocus(token, document.activeElement === page);
  });
  wire();
  listeners.add(onState);
  page.addEventListener('did-attach', onAttach);
  return () => {
    offTake();
    listeners.delete(onState);
    page.removeEventListener('did-attach', onAttach);
  };
}
