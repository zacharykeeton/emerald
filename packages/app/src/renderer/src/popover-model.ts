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

// Whether a pointer's move over an anchor arms its hover card (M9 fix
// 1154). The enter alone missed when the rows shifted under a still
// pointer (a re-render moved the node away and back, or remounted the
// lane under it), and nothing armed the card again until the pointer
// left and came back. A move arms it as the enter does, but not after
// the card was closed on purpose (Escape, a press outside, a card's own
// action) until the pointer leaves or enters again, so a nudge of the
// mouse does not bring back a card the person just dismissed.
export function armsOnMove(s: { hover: boolean; open: boolean; pending: boolean; quiet: boolean }): boolean {
  return s.hover && !s.open && !s.pending && !s.quiet;
}
