import { pastEdge } from './drop-zone-model.ts';
import { DRAG_THRESHOLD } from './pane-drag.ts';
import { dropBefore, layoutTabOf } from './tab-order.ts';
import { dropOutsideWindows } from './window-drop.ts';

// Dragging a tab along the strip to reorder it (M9 fix 182), hand-rolled
// on window mousemove and mouseup like pane-drag.ts: every tab's mousedown
// already calls preventDefault, so a native dragstart never fires, and
// the CDP harness drives mouse events, not native drags. The press
// installs the listeners and nothing shows until the mouse has moved a
// few pixels, so a plain click is the click it is today. From then on a
// ghost with the tab's name follows the mouse, the tab itself dims, and
// the tab the drop would land before carries data-drop="before" (the last
// tab data-drop="after" for a drop at the end), which the CSS draws as an
// insertion line. Release moves; Escape or the window losing focus
// cancels. The + and the filler are never a target: a release over them
// lands at the end.
//
// A file tab can also be dropped on a pane (M9 fix 180), and one press
// cannot start both drags, so the reorder owns it while the pointer stays
// near the strip; once it has gone LEAVE_MARGIN below the strip's box the
// reorder cancels and hands the pointer to onLeave, which starts the pane
// drag from there. A drag along the strip never leaves it.
//
// A layout tab dragged past the window's own edge (M9 fix 927) goes to
// main, which forwards it to the window under the pointer; that window
// draws the same line in its strip (markDropAt) and the release moves the
// tab there (window-drop.ts). A file tab never crosses as a tab: below
// the strip it is already a pane drag, which crosses as one.

const GHOST_OFFSET = 12;
const LEAVE_MARGIN = 16;

let active = false;

// Where a tab dropped at x would land on the strip, and the tab that
// draws the line: before that tab, or after the last for the end. A line
// beside the dragged tab itself says nothing and is not drawn. The caller
// clears the last mark first.
export function markDropAt(strip: HTMLElement, x: number, dragged: HTMLElement | null): { before: string | null; marked: HTMLElement | null } {
  const tabs = [...strip.querySelectorAll<HTMLElement>('.tab[data-key]')];
  const slots = tabs.map((el) => {
    const r = el.getBoundingClientRect();
    return { key: el.dataset['key']!, left: r.left, right: r.right };
  });
  const before = dropBefore(slots, x);
  const target = before === null ? (tabs[tabs.length - 1] ?? null) : (tabs.find((el) => el.dataset['key'] === before) ?? null);
  if (target === null || target === dragged) return { before, marked: null };
  target.dataset['drop'] = before === null ? 'after' : 'before';
  return { before, marked: target };
}

export function startTabDrag(strip: HTMLElement, tab: HTMLElement, key: string, name: string, press: MouseEvent, onDrop: (before: string | null) => void, onLeave?: (from: MouseEvent) => void): void {
  if (active || press.button !== 0) return;
  active = true;
  const startX = press.clientX;
  const startY = press.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  let before: string | null = null;
  let marked: HTMLElement | null = null;
  // The layout tab a drag past the edge carries (M9 fix 927), and whether
  // the pointer is out there now.
  const crossTabId = layoutTabOf(key);
  let out = false;

  const clearMark = () => {
    if (marked !== null) delete marked.dataset['drop'];
    marked = null;
  };

  const teardown = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('keydown', onKey, { capture: true });
    window.removeEventListener('blur', cancel);
    document.body.classList.remove('dragging-tab');
    delete tab.dataset['dragging'];
    clearMark();
    ghost?.remove();
    ghost = null;
    // Escape or the blur ends the other window's line too.
    if (out) window.emerald.windowDrag.back();
    out = false;
    active = false;
  };

  const begin = () => {
    dragging = true;
    document.body.classList.add('dragging-tab');
    tab.dataset['dragging'] = '';
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = name;
    document.body.appendChild(ghost);
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('blur', cancel);
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) {
      if (Math.max(Math.abs(e.clientX - startX), Math.abs(e.clientY - startY)) < DRAG_THRESHOLD) return;
      begin();
    }
    if (onLeave !== undefined && e.clientY > strip.getBoundingClientRect().bottom + LEAVE_MARGIN) {
      teardown();
      onLeave(e);
      return;
    }
    if (ghost !== null) ghost.style.transform = `translate(${e.clientX + GHOST_OFFSET}px, ${e.clientY + GHOST_OFFSET}px)`;
    if (crossTabId !== null && pastEdge({ x: e.clientX, y: e.clientY }, window.innerWidth, window.innerHeight)) {
      clearMark();
      before = null;
      out = true;
      window.emerald.windowDrag.move({ kind: 'tab', tabId: crossTabId }, e.clientX, e.clientY);
      return;
    }
    if (out) {
      window.emerald.windowDrag.back();
      out = false;
    }
    clearMark();
    ({ before, marked } = markDropAt(strip, e.clientX, tab));
  };

  const onUp = (e: MouseEvent) => {
    const dropped = dragging;
    const at = before;
    const handed = out;
    // Cleared first, so the teardown sends no back for a drag main is ending.
    out = false;
    teardown();
    if (!dropped) return;
    if (handed && crossTabId !== null) {
      // Another window made the drop, or none was under the pointer and
      // the tab opens a window of its own there (M9 fix 928).
      const drag = { kind: 'tab', tabId: crossTabId } as const;
      void window.emerald.windowDrag
        .end(e.clientX, e.clientY)
        .then((end) => (end.to === 'none' ? dropOutsideWindows(drag, end.x, end.y) : undefined))
        .catch((err: unknown) => console.warn('[emerald] drop failed', err));
      return;
    }
    // The click the release fires, on the tab or on the strip when the
    // release was over another tab, is swallowed before it reaches
    // anything, so a moved tab is not also switched to; the guard goes
    // on the next tick, since a click follows its mouseup at once.
    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    onDrop(at);
  };

  const cancel = () => teardown();

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
