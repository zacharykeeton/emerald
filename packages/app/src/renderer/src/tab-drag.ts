import { DRAG_THRESHOLD } from './pane-drag.ts';
import { dropBefore } from './tab-order.ts';

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

const GHOST_OFFSET = 12;
const LEAVE_MARGIN = 16;

let active = false;

export function startTabDrag(strip: HTMLElement, tab: HTMLElement, key: string, name: string, press: MouseEvent, onDrop: (before: string | null) => void, onLeave?: (from: MouseEvent) => void): void {
  if (active || press.button !== 0) return;
  active = true;
  const startX = press.clientX;
  const startY = press.clientY;
  let dragging = false;
  let ghost: HTMLDivElement | null = null;
  let before: string | null = null;
  let marked: HTMLElement | null = null;

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
    const tabs = [...strip.querySelectorAll<HTMLElement>('.tab[data-key]')];
    const slots = tabs.map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.dataset['key']!, left: r.left, right: r.right };
    });
    before = dropBefore(slots, e.clientX);
    clearMark();
    // The line sits before the target, or after the last tab for the end;
    // a line beside the dragged tab itself says nothing and is not drawn.
    const target = before === null ? (tabs[tabs.length - 1] ?? null) : (tabs.find((el) => el.dataset['key'] === before) ?? null);
    if (target !== null && target !== tab) {
      target.dataset['drop'] = before === null ? 'after' : 'before';
      marked = target;
    }
  };

  const onUp = () => {
    const dropped = dragging;
    const at = before;
    teardown();
    if (!dropped) return;
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
