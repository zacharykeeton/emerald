// The main process's windows as the layout names them (M9 fix 866), the
// parts with no electron in them so node:test runs them: which windows to
// bind, open and close for a layout, where a harness window sits, where a
// person's next window opens, and the union of what every window watches.

export interface WindowPlan {
  // The layout window the startup window takes, while it has none.
  bind: string | null;
  open: string[];
  close: string[];
}

// layoutIds: windowsOf(layout)'s ids in order; openIds: the ids open
// windows already hold; startupUnbound: the window made at ready has no
// id yet; mayOpen: this process holds the single-instance lock. A process
// that went on without the lock binds its startup window and opens or
// closes nothing, since another process owns the layout's windows.
export function planWindows(layoutIds: readonly string[], openIds: readonly string[], startupUnbound: boolean, mayOpen: boolean): WindowPlan {
  const bind = startupUnbound ? (layoutIds.find((id) => !openIds.includes(id)) ?? null) : null;
  if (!mayOpen) return { bind, open: [], close: [] };
  const open = layoutIds.filter((id) => !openIds.includes(id) && id !== bind);
  const close = openIds.filter((id) => !layoutIds.includes(id));
  return { bind, open, close };
}

// A harness window's spot past every display (M9 fixes 48 and 866): the
// startup window at index 0 keeps the spot it always had, and each later
// one sits a window's width and a gap further right, so two harness
// windows never cover each other.
export const BACKGROUND_STEP = 1300;
export function backgroundSpot(right: number, index: number): [number, number] {
  return [right + 50 + index * BACKGROUND_STEP, 50];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A person's new window: 32 px right and down of the anchor (the focused
// window), back to the work area's top left when it would cross its right
// or bottom edge.
export const CASCADE_STEP = 32;
export function cascadeBounds(anchor: Rect, workArea: Rect): Rect {
  const x = anchor.x + CASCADE_STEP;
  const y = anchor.y + CASCADE_STEP;
  const fits = x + anchor.width <= workArea.x + workArea.width && y + anchor.height <= workArea.y + workArea.height;
  return fits ? { x, y, width: anchor.width, height: anchor.height } : { x: workArea.x, y: workArea.y, width: anchor.width, height: anchor.height };
}

// What each window asks to watch (folders, repositories), by its
// webContents id, answered as the union in first-seen order, so one
// watcher serves every window and a window's close drops its own alone.
export class WindowSets {
  private readonly sets = new Map<number, string[]>();

  set(contentsId: number, items: readonly string[]): string[] {
    this.sets.set(contentsId, [...items]);
    return this.union();
  }

  drop(contentsId: number): string[] {
    this.sets.delete(contentsId);
    return this.union();
  }

  private union(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const items of this.sets.values()) {
      for (const item of items) {
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  }
}
