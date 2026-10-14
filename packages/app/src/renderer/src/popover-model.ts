// The rect a card is placed off (M9 fix 307). An anchor that is
// `display: contents` (the usage strip's window in its stacked form)
// has an empty rect of its own, so the card was clamped to the window's
// corner; its children's rects, unioned, are where the reading is.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function unionRect(rects: readonly Rect[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    if (out === null) {
      out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      continue;
    }
    out.left = Math.min(out.left, r.left);
    out.top = Math.min(out.top, r.top);
    out.right = Math.max(out.right, r.right);
    out.bottom = Math.max(out.bottom, r.bottom);
    out.width = out.right - out.left;
    out.height = out.bottom - out.top;
  }
  return out;
}

// The element's own rect when it has one, else the union of its
// children's; an anchor with neither (nothing drawn yet) keeps the empty
// rect so the card still opens somewhere.
export function anchorRect(el: Element): Rect {
  const own = el.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) return own;
  return unionRect(Array.from(el.children, (c) => c.getBoundingClientRect())) ?? own;
}
