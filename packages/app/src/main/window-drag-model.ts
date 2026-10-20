import type { Rect } from './window-plan.ts';

// Where a drag that has left its window is (M9 fix 927): which window is
// under a screen point, and a page's client point in screen terms and
// back. Pure, so node:test runs it.

export interface Point {
  x: number;
  y: number;
}

// A window a drag can land on, keyed by its webContents id; focusedAt is
// when it last took focus, which picks the one on top where two overlap.
export interface DragCandidate {
  key: number;
  bounds: Rect;
  focusedAt: number;
}

// The window under the point, the one keyed `except` (the drag's source)
// left out: left and top edges in, right and bottom edges out, so two
// windows side by side never both hold a point; of several, the one
// focused last, the first listed on a tie.
export function windowAt(windows: readonly DragCandidate[], p: Point, except: number | null): number | null {
  let best: DragCandidate | null = null;
  for (const w of windows) {
    if (w.key === except) continue;
    const b = w.bounds;
    if (p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) continue;
    if (best === null || w.focusedAt > best.focusedAt) best = w;
  }
  return best?.key ?? null;
}

// A client point of a page whose content sits at `content` on the screen.
// The zoom is the page's own (fix 900's window zoom), which scales a
// client pixel.
export function toScreen(content: Rect, zoom: number, client: Point): Point {
  return { x: content.x + client.x * zoom, y: content.y + client.y * zoom };
}

export function toClient(content: Rect, zoom: number, p: Point): Point {
  return { x: (p.x - content.x) / zoom, y: (p.y - content.y) / zoom };
}

// Where the pointer sits on a window a drop opens (M9 fix 928): on its
// title row, about where its first tab is.
export const DROP_GRAB_X = 120;
export const DROP_GRAB_Y = 13;

// The bounds of a window a drop outside every window opens at the screen
// point p: its top left the grab offset up and left of the point, moved
// back so the window sits inside the work area of the display under it.
export function dropWindowBounds(p: Point, size: { width: number; height: number }, workArea: Rect): Rect {
  const x = Math.max(workArea.x, Math.min(p.x - DROP_GRAB_X, workArea.x + workArea.width - size.width));
  const y = Math.max(workArea.y, Math.min(p.y - DROP_GRAB_Y, workArea.y + workArea.height - size.height));
  return { x, y, width: size.width, height: size.height };
}
