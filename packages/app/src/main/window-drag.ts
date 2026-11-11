import { BrowserWindow, ipcMain, screen } from 'electron';
import type { WebContents } from 'electron';
import { windowsOf } from '@emerald/shared';
import type { Layout } from '@emerald/shared';
import type { WindowDrag, WindowDragEnd, WindowDragTarget } from '../preload/api.ts';
import { dropWindowBounds, handOut, toClient, toScreen, windowAt } from './window-drag-model.ts';
import type { Point } from './window-drag-model.ts';
import type { Rect } from './window-plan.ts';

// How long a drop's place waits for its window (M9 fix 928): the
// layout's push that opens it comes in milliseconds.
const DROP_PLACEMENT_MS = 10_000;

// A drag carried across windows (M9 fix 927). A pane's, a row's or a
// layout tab's drag is hand-rolled in its renderer (pane-drag.ts,
// tab-drag.ts); once the pointer is past the window's edge the renderer
// hands each move here, this finds the window under the point and
// forwards the move to it at its own client point, where it draws its
// drop zones, and the release there makes the drop. Every window's tabs
// are on the daemon's one layout, so the drop is a layout edit and no pty
// moves.

export interface WindowDragOptions {
  log(msg: string): void;
  windows(): BrowserWindow[];
  idOf(contents: WebContents): string | null;
  lift(w: BrowserWindow): void;
  // M9 fix 928: main's last layout, whether the daemon keeps windows
  // (level 73), and a layout tab moved to a window of its own, answering
  // the new window's id.
  layout(): Layout | null;
  kept(): boolean;
  openTab(tabId: string): Promise<string>;
  // M9 fix 1122: the OS file drag (file-drag-out.ts), answering the paths it took, none when every one is gone.
  dragOut(contents: WebContents, files: readonly string[]): string[];
}

interface Flight {
  source: BrowserWindow;
  drag: WindowDrag;
  target: BrowserWindow | null;
}

export function wireWindowDrag(opts: WindowDragOptions): { attach(win: BrowserWindow): void; placementFor(windowId: string): Rect | null } {
  let flight: Flight | null = null;
  // A drop outside every window waiting for the window it opens (M9 fix
  // 928), by its tab, so whichever of the reply and the push opens the
  // window first finds it.
  const pending = new Map<string, { point: Point; at: number }>();
  const focusedAt = new Map<number, number>();
  // The windows a drop was sent to, lifted once the drop's edit has
  // settled (M9 fix 947): lifted at the release, a window's focus wrote
  // window.front and took the revision its drop was based on.
  const lifts = new Set<number>();
  // The webContents ids whose drag main handed out to the OS. Moves a
  // window sent before it heard of its hand-over are dropped (M9 fix
  // 1122): its back, sent once on the push, clears it.
  const handed = new Set<number>();
  const live = (w: BrowserWindow | null): w is BrowserWindow => w !== null && !w.isDestroyed();
  const send = (w: BrowserWindow | null, msg: WindowDragTarget) => {
    if (live(w)) w.webContents.send('emerald:window-drag-target', msg);
  };
  const nameOf = (w: BrowserWindow) => (live(w) ? opts.idOf(w.webContents) : null) ?? 'startup';
  const what = (drag: WindowDrag) => (drag.kind === 'tab' ? 'a tab' : drag.kind === 'files' ? 'a set' : 'a pane');

  // The sender's window, when it is one of ours.
  const sourceOf = (contents: WebContents): BrowserWindow | null => {
    const w = BrowserWindow.fromWebContents(contents);
    return w !== null && opts.windows().includes(w) ? w : null;
  };

  // The screen point of a client point of the source's page, and the
  // window under it other than the source.
  const locate = (source: BrowserWindow, x: number, y: number): { point: Point; target: BrowserWindow | null } => {
    const point = toScreen(source.getContentBounds(), source.webContents.getZoomFactor(), { x, y });
    const candidates = opts.windows().filter(live).map((w) => ({ win: w, key: w.webContents.id, bounds: w.getContentBounds(), focusedAt: focusedAt.get(w.webContents.id) ?? 0 }));
    const key = windowAt(candidates, point, source.webContents.id);
    return { point, target: candidates.find((c) => c.key === key)?.win ?? null };
  };
  const clientOf = (w: BrowserWindow, p: Point): Point => toClient(w.getContentBounds(), w.webContents.getZoomFactor(), p);

  const end = () => {
    if (flight !== null) send(flight.target, { type: 'leave' });
    flight = null;
  };

  ipcMain.on('emerald:window-drag-move', (e, drag: WindowDrag, x: number, y: number) => {
    if (handed.has(e.sender.id)) return;
    const source = sourceOf(e.sender);
    if (source === null) return;
    if (flight !== null && flight.source !== source) end();
    const { point, target } = locate(source, x, y);
    // M9 fix 1122: a drag carrying files with no window of ours under the
    // point leaves for the OS. The push goes before the OS drag starts,
    // since dragOut awaits the file's icon first. With no path left on
    // disk the move goes on as before and the release opens fix 928's
    // window.
    const files = handOut(drag, target === null ? null : target.webContents.id);
    if (files !== null) {
      const took = opts.dragOut(source.webContents, files);
      if (took.length > 0) {
        if (flight !== null) send(flight.target, { type: 'leave' });
        flight = null;
        handed.add(e.sender.id);
        source.webContents.send('emerald:file-drag-out');
        opts.log(`window drag: ${took.length === 1 ? 'a file' : `${took.length} files`} from window ${nameOf(source)} handed to the OS at ${Math.round(point.x)},${Math.round(point.y)}`);
        return;
      }
    }
    const prev = flight?.target ?? null;
    if (prev !== target) send(prev, { type: 'leave' });
    flight = { source, drag, target };
    // A folder or a set reaches no pane, so the window under it draws no zones.
    if (target !== null && drag.kind !== 'files') send(target, { type: 'over', drag, ...clientOf(target, point) });
  });

  ipcMain.on('emerald:window-drag-back', (e) => {
    handed.delete(e.sender.id);
    if (flight !== null && sourceOf(e.sender) === flight.source) end();
  });

  ipcMain.handle('emerald:window-drag-end', (e, x: number, y: number): WindowDragEnd => {
    const source = sourceOf(e.sender);
    const f = flight;
    // No drag of this window's in flight (its target closed under it, or
    // a move never came): nothing to drop, so nothing is opened either.
    if (source === null || f === null || f.source !== source) return { to: 'window' };
    const { drag } = f;
    const { point, target } = locate(source, x, y);
    if (f.target !== target) send(f.target, { type: 'leave' });
    flight = null;
    if (target !== null) {
      send(target, { type: 'drop', drag, ...clientOf(target, point) });
      opts.log(`window drag: ${what(drag)} from window ${nameOf(source)} dropped on window ${nameOf(target)}`);
      lifts.add(target.webContents.id);
      return { to: 'window' };
    }
    opts.log(`window drag: ${what(drag)} from window ${nameOf(source)} released outside every window at ${Math.round(point.x)},${Math.round(point.y)}`);
    return { to: 'none', x: point.x, y: point.y };
  });

  // M9 fix 947: the target's drop has settled, landed or failed, so its
  // window comes to the front now.
  ipcMain.on('emerald:window-drag-landed', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!live(w) || !lifts.delete(e.sender.id)) return;
    opts.log(`window drag: the drop on window ${nameOf(w)} settled; lifting it`);
    opts.lift(w);
  });

  // M9 fix 928: a layout tab to a window of its own whose title row is at
  // the screen point. The daemon refuses a window's only tab, which is
  // logged and changes nothing.
  ipcMain.handle('emerald:window-drag-open', async (_e, tabId: string, x: number, y: number): Promise<void> => {
    if (!opts.kept()) {
      opts.log(`window drag: emmerd is below level 73; no new window for tab ${tabId}`);
      return;
    }
    // A place no window took (a harness window never reads one) goes stale.
    for (const [id, p] of pending) if (Date.now() - p.at > DROP_PLACEMENT_MS) pending.delete(id);
    pending.set(tabId, { point: { x, y }, at: Date.now() });
    try {
      const windowId = await opts.openTab(tabId);
      opts.log(`window drag: tab ${tabId} opens window ${windowId} at ${Math.round(x)},${Math.round(y)}`);
    } catch (err) {
      pending.delete(tabId);
      opts.log(`window drag: a new window for tab ${tabId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return {
    placementFor(windowId: string): Rect | null {
      const layout = opts.layout();
      const record = layout === null ? undefined : windowsOf(layout).find((w) => w.id === windowId);
      const tabId = record?.tabIds[0];
      const drop = tabId === undefined ? undefined : pending.get(tabId);
      if (tabId === undefined || drop === undefined) return null;
      pending.delete(tabId);
      if (Date.now() - drop.at > DROP_PLACEMENT_MS) return null;
      return dropWindowBounds(drop.point, { width: 1200, height: 800 }, screen.getDisplayNearestPoint(drop.point).workArea);
    },
    attach(win: BrowserWindow): void {
      const key = win.webContents.id;
      win.on('focus', () => focusedAt.set(key, Date.now()));
      win.on('closed', () => {
        focusedAt.delete(key);
        lifts.delete(key);
        handed.delete(key);
        if (flight !== null && (flight.source === win || flight.target === win)) {
          if (flight.target === win) flight.target = null;
          end();
        }
      });
    },
  };
}
