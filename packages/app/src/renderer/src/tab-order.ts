// The order of the tabs on the strip (M9 fix 182), pure so node:test can
// cover it. Before this the strip drew the layout tabs in the daemon's
// order and then the file tabs in the tabs model's, and nothing could
// reorder either. Now the renderer keeps one mixed list of keys, a layout
// tab under `tab:<id>` and a file under its path, persisted with the tabs
// (ui.ts), so a file tab can sit between two panes tabs. The daemon's own
// tab order is left alone: once the renderer keeps the order it is a set
// to the strip, and a window of its own keeps an order of its own.
//
// The kept list may be stale or short: a layout tab made from another
// window, or a file opened before the list existed, is not in it, and a
// key whose tab has closed may still be. `stripOrder` reads the list
// against what exists and is the order the strip draws and the keys walk;
// a move writes that materialized order back, which prunes the stale keys.

const LAYOUT_PREFIX = 'tab:';

export function layoutTabKey(id: string): string {
  return LAYOUT_PREFIX + id;
}

// The layout tab id a key names, or null for a file key. A file path is
// absolute (`C:\...`) or an `emerald://` document, so neither starts `tab:`.
export function layoutTabOf(key: string): string | null {
  return key.startsWith(LAYOUT_PREFIX) ? key.slice(LAYOUT_PREFIX.length) : null;
}

// The kept order filtered to what exists; a layout tab not in it usually
// joins right after the last layout tab that is, in the daemon's order,
// today's placement. But a window with nothing kept, or one from before
// the order existed (only files kept, no layout tab named yet), keeps
// that same placement at the front instead (M9 fix 182's law: the panes
// tabs first, then the files), while a window whose kept order has
// already named a layout tab and has nothing kept trailing the last one
// it still holds (M9 fix 346) sends a tab it does not know (the + or
// another window's) to the end instead, after every file, so a fresh
// layout tab never lands ahead of a file joining the same strip for the
// first time. A file not in the kept order always joins at the end.
export function stripOrder(order: readonly string[], layoutTabIds: readonly string[], files: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of order) {
    const id = layoutTabOf(key);
    const exists = id === null ? files.includes(key) : layoutTabIds.includes(id);
    if (exists && !out.includes(key)) out.push(key);
  }
  const missing = layoutTabIds.map(layoutTabKey).filter((key) => !out.includes(key));
  let at = 0;
  for (let i = 0; i < out.length; i++) if (layoutTabOf(out[i]!) !== null) at = i + 1;
  const knowsLayoutTabs = order.some((key) => layoutTabOf(key) !== null);
  const atEnd = missing.length > 0 && at === out.length && knowsLayoutTabs;
  if (missing.length > 0 && !atEnd) out.splice(at, 0, ...missing);
  for (const file of files) {
    if (!out.includes(file)) out.push(file);
  }
  if (atEnd) out.push(...missing);
  return out;
}

// A tab the person just asked for, the + or the group button (M9 fix
// 363), names its own place: last, after every file, whatever the two
// starting cases above give a tab stripOrder only guesses at (a fresh
// profile among them, where a guessed tab lands with the panes tabs
// first, ahead of a file already open). `order` is the strip already
// materialized against the tabs that existed before the add (stripOrder,
// via tabOrderFor), so a tab another window made keeps stripOrder's
// guess and only the one just pressed is forced to the end.
export function orderWithNew(order: readonly string[], files: readonly string[], key: string): string[] {
  const out = order.filter((k) => k !== key);
  for (const file of files) if (!out.includes(file)) out.push(file);
  out.push(key);
  return out;
}

// `key` moved to sit before `before`, or at the end for null. The same
// list comes back when nothing moves, so a caller can skip a write.
export function moveKey(order: readonly string[], key: string, before: string | null): readonly string[] {
  if (!order.includes(key) || key === before || (before !== null && !order.includes(before))) return order;
  const rest = order.filter((k) => k !== key);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at === order.indexOf(key)) return order;
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

// A key that took another's place (M9 fix 203: the preview tab's path
// replaced by the next file previewed) keeps its spot on the strip. The
// same list comes back when `from` is not in it.
export function replaceKey(order: readonly string[], from: string, to: string): readonly string[] {
  if (from === to || !order.includes(from)) return order;
  return order.filter((k) => k !== to).map((k) => (k === from ? to : k));
}

// The key the strip counts as current: the active file tab, or the layout
// tab on show while the panes are in front.
export function currentKey(active: string, panes: string, currentTabId: string | null): string | null {
  if (active !== panes) return active;
  return currentTabId === null ? null : layoutTabKey(currentTabId);
}

// Next or previous key on the strip with wrap-around (Ctrl+PageDown and
// PageUp): a panes tab and a file tab are each one stop, in the order the
// strip reads. Null when there is nowhere to go.
export function cycleKeys(order: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (order.length < 2) return null;
  const i = current === null ? -1 : order.indexOf(current);
  if (i < 0) return delta === 1 ? (order[0] ?? null) : (order[order.length - 1] ?? null);
  return order[(i + delta + order.length) % order.length] ?? null;
}

// Ctrl+B n and p: the next layout tab in the strip's order, the file
// tabs skipped, with wrap-around. Null with one layout tab or none.
export function nextLayoutTab(order: readonly string[], currentTabId: string, delta: 1 | -1): string | null {
  const ids = order.map(layoutTabOf).filter((id): id is string => id !== null);
  if (ids.length < 2) return null;
  const i = ids.indexOf(currentTabId);
  if (i < 0) return delta === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[(i + delta + ids.length) % ids.length]!;
}

// Where a drag lands: the slots are the tabs' key and horizontal extent in
// strip order, and the drop goes before the first slot whose middle the
// pointer is left of, else at the end. The + and the filler after the
// last tab are past every middle, so a drop there is the end.
export function dropBefore(slots: readonly { key: string; left: number; right: number }[], x: number): string | null {
  for (const slot of slots) {
    if (x < (slot.left + slot.right) / 2) return slot.key;
  }
  return null;
}

// The kept order from localStorage: strings only, a layout key as it is
// and a file key normalized by the caller's rule, duplicates dropped.
export function orderFromJson(json: unknown, normalize: (path: string) => string): string[] {
  if (!Array.isArray(json)) return [];
  const out: string[] = [];
  for (const k of json) {
    if (typeof k !== 'string' || k === '') continue;
    const key = layoutTabOf(k) === null ? normalize(k) : k;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}
