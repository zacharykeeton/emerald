import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Swatches } from './Swatches.tsx';
import type { MenuSwatches } from './Swatches.tsx';

export type { MenuSwatches } from './Swatches.tsx';

export interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  title?: string | undefined;
  // The key that does the same thing, shown at the right.
  hint?: string | undefined;
  // Draws a rule above this item.
  separator?: boolean | undefined;
  // A setting rather than an action (M9 fix 91): a tick before the label
  // when true, an empty slot when false, so the labels stay aligned. Its
  // onClick toggles it and leaves the menu open.
  checked?: boolean | undefined;
  // A row that opens a list of its own at its right edge (M9 fix 624);
  // its onClick is not called.
  submenu?: MenuItem[] | undefined;
}

// How long the pointer rests on a row before its list opens, or before
// resting on another row closes it (M9 fix 624).
const SUBMENU_HOVER_MS = 300;

// A labelled row of colour swatches (M29, the session's colour) is a
// MenuSwatches, drawn by Swatches.tsx (M9 fix 134, which put the same
// row on the lane card); a pick closes the menu through its own handler
// like an item does.
export function isSwatches(item: MenuItem | MenuSwatches | MenuHeading): item is MenuSwatches {
  return 'swatches' in item;
}

// A section's heading (M9 fix 567): not clickable and not a disabled
// action; drawn with the disabled colour under a rule.
export interface MenuHeading {
  heading: string;
  title?: string | undefined;
}

export function isHeading(item: MenuItem | MenuSwatches | MenuHeading): item is MenuHeading {
  return 'heading' in item;
}

const BARE_MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

// How many menus are mounted (M9 fix 589). A window capture listener added
// before a menu's runs first and cannot be stopped by it, so a listener
// that must leave a menu's Escape alone asks this; the count drops in the
// effect's cleanup, after React commits the close, so it is still up for
// every listener of the Escape that closed the menu.
let openMenus = 0;
export function menuOpen(): boolean {
  return openMenus > 0;
}

interface Props {
  x: number;
  y: number;
  items: Array<MenuItem | MenuSwatches | MenuHeading>;
  onClose: () => void;
  className?: string;
  // Extra data-* attributes for the verify scripts.
  data?: Record<string, string>;
  // The button that opened the menu (M9 fix 234, the app menu's Z mark):
  // a press on it is left to its own handler, which toggles the menu, so
  // a second click closes it rather than closing and reopening it.
  anchor?: HTMLElement | null;
}

// A plain DOM context menu rather than Electron's native one: it needs no
// IPC and the verify scripts can click it. A key or a press anywhere
// outside closes it; choosing an item closes it through the item's own
// handler. It is nudged back inside the window when opened near an edge.
// It renders into document.body through a portal (M9 fix 299), as the
// popover cards do: mounted where it is opened, a pane's menu sat inside
// the panes view, which is its own stacking context since fix 149, so
// the files rail after it in the DOM painted over a menu opened near it,
// whatever the menu's z-index. From the body it floats over everything
// in the page below the dialogs.
export function Menu({ x, y, items, onClose, className, data, anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // The open submenu (M9 fix 624): its row's label and element. Its list
  // is a portal of its own, so the press listener below counts a press
  // in it as inside the menu through subRef.
  const [sub, setSub] = useState<{ label: string; row: HTMLElement } | null>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const clearHover = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => clearHover, []);
  const restOn = (item: MenuItem, row: HTMLElement) => {
    clearHover();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (item.submenu !== undefined) setSub({ label: item.label, row });
      else setSub(null);
    }, SUBMENU_HOVER_MS);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(0, Math.min(y, window.innerHeight - r.height - 4)),
    });
  }, [x, y]);

  // The listeners are registered once for the life of the menu and read
  // onClose through a ref. Callers pass a fresh closure every render, and
  // another capture listener on the same key or press (the attention
  // acknowledge) can re-render the caller before this one runs; a listener
  // swapped out in that gap is never called and the menu stays open.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const anchorRef = useRef(anchor ?? null);
  anchorRef.current = anchor ?? null;
  useEffect(() => {
    openMenus += 1;
    // Any key closes the menu, not Escape alone (M9 fix 299): a menu
    // left open while a file tab comes to the front by Ctrl+PageDown
    // would float over the file view from the body. A bare modifier is
    // the start of a chord, so it is not a key here. Escape alone stops
    // here (M9 fix 589): it means close the menu and nothing else, so it
    // never reaches the terminal, an editor or a box under the menu; every
    // other key goes on as fix 299 needs.
    const onKey = (ev: KeyboardEvent) => {
      if (BARE_MODIFIERS.has(ev.key)) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
      }
      onCloseRef.current();
    };
    // Capture phase so a click on a terminal, which stops propagation, still
    // closes the menu. A press inside the menu is the item being chosen.
    const onDown = (ev: MouseEvent) => {
      if (!(ev.target instanceof Node)) return onCloseRef.current();
      if (ref.current !== null && ref.current.contains(ev.target)) return;
      if (subRef.current !== null && subRef.current.contains(ev.target)) return;
      if (anchorRef.current !== null && anchorRef.current.contains(ev.target)) return;
      onCloseRef.current();
    };
    window.addEventListener('mousedown', onDown, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('mousedown', onDown, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      openMenus -= 1;
    };
  }, []);

  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) attrs[`data-${k}`] = v;
  const subItems = sub === null ? undefined : items.find((i): i is MenuItem => !isHeading(i) && !isSwatches(i) && i.label === sub.label)?.submenu;
  return (
    <>
      {createPortal(
    <div className={className === undefined ? 'menu' : `menu ${className}`} style={pos} ref={ref} {...attrs}>
      {items.map((item) =>
        isHeading(item) ? (
          <div key={`heading:${item.heading}`} className="menu-item menu-sep menu-heading" role="presentation" title={item.title}>
            <span className="menu-label">{item.heading}</span>
          </div>
        ) : isSwatches(item) ? (
          <Swatches key={item.label} item={item} />
        ) : (
          <button
            key={item.label}
            className={item.separator ? 'menu-item menu-sep' : 'menu-item'}
            onClick={
              item.submenu === undefined
                ? item.onClick
                : (ev) => {
                    clearHover();
                    const row = ev.currentTarget;
                    setSub((open) => (open?.label === item.label ? null : { label: item.label, row }));
                  }
            }
            onMouseEnter={(ev) => restOn(item, ev.currentTarget)}
            onMouseLeave={clearHover}
            disabled={item.disabled}
            title={item.title}
            data-checked={item.checked === undefined ? undefined : String(item.checked)}
            data-submenu={item.submenu === undefined ? undefined : ''}
            aria-haspopup={item.submenu === undefined ? undefined : 'menu'}
            aria-expanded={item.submenu === undefined ? undefined : sub?.label === item.label}
            // The terminal or the pane under the menu keeps keyboard focus.
            onMouseDown={(ev) => ev.preventDefault()}
          >
            <span className="menu-label">
              {item.checked !== undefined && <span className="menu-check">{item.checked ? '✓' : ''}</span>}
              {item.label}
            </span>
            {item.submenu !== undefined ? <span className="menu-hint">{item.hint === undefined ? '›' : `${item.hint} ›`}</span> : item.hint !== undefined && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>,
        document.body,
      )}
      {sub !== null && subItems !== undefined && <SubMenu items={subItems} parent={sub.label} row={sub.row} subRef={subRef} />}
    </>
  );
}

// A submenu's list (M9 fix 624), a second portal into the body at its
// row's right edge, its top 5 px above the row's (the menu's 4 px padding
// and 1 px border) so its first item sits level with the row; flipped to
// the row's left when it would pass the window's right edge, and kept
// inside the window's height. It is not a child of the parent's element on
// purpose: the scripts' whole-menu reads (.pane-menu .menu-item) never
// count its items. No key handling of its own: any key closes the whole
// menu through the parent's listener.
function SubMenu({ items, parent, row, subRef }: { items: MenuItem[]; parent: string; row: HTMLElement; subRef: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = subRef.current;
    if (el === null) return;
    const r = row.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    const left = r.right + own.width > window.innerWidth - 4 ? r.left - own.width : r.right;
    const top = Math.max(0, Math.min(r.top - 5, window.innerHeight - own.height - 4));
    setPos({ left: Math.max(0, left), top });
  }, [row, subRef]);
  return createPortal(
    <div className="menu menu-sub" data-parent={parent} ref={subRef} style={pos === null ? { position: 'fixed', visibility: 'hidden', left: 0, top: 0 } : { position: 'fixed', left: pos.left, top: pos.top }}>
      {items.map((item) => (
        <button
          key={item.label}
          className={item.separator ? 'menu-item menu-sep' : 'menu-item'}
          onClick={item.onClick}
          disabled={item.disabled}
          title={item.title}
          data-checked={item.checked === undefined ? undefined : String(item.checked)}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          <span className="menu-label">
            {item.checked !== undefined && <span className="menu-check">{item.checked ? '✓' : ''}</span>}
            {item.label}
          </span>
          {item.hint !== undefined && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
