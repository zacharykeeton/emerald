import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { anchorRect } from './popover-model.ts';
import type { Rect } from './popover-model.ts';

// A card that opens off a small reading in a row or a title bar: the
// context card (M9 fix 67, ContextPopover.tsx) was the first, and the
// roster's card and the needs-input answer card open the same way, so
// the mechanics live here. Same shape as the menus (Menu.tsx): fixed,
// kept inside the window, closed by Escape or a press outside, and a
// press inside keeps the terminal's focus.

// The hover that opens the card waits this long, so a mouse crossing the
// reading on its way somewhere opens nothing; a click opens it at once
// and pins it, so it stays until Escape or a press outside.
export const HOVER_DELAY_MS = 400;
// Leaving an unpinned card, or the reading that opened it, closes it
// after this grace, long enough to cross the gap into the card.
export const LEAVE_GRACE_MS = 200;

// What the anchor hands the card it opens.
export interface CardProps {
  // The anchor's rect, or its children's union when its own is empty
  // (a `display: contents` anchor, M9 fix 307).
  anchor: Rect;
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}

interface AnchorProps {
  // Names the anchor for the card's outside-press check, so the click
  // that pins the card is not also the press that closes it. Unique
  // among the anchors open at once: a session id, a group key.
  id: string;
  className: string;
  // More attributes on the anchor span (data-size and the like), when
  // the anchor is the element the caller's CSS already keys on.
  data?: Record<string, string | undefined> | undefined;
  title?: string | undefined;
  // A style on the anchor span, for a caller whose CSS reads a custom
  // property off it (a lane's --lane colour).
  style?: CSSProperties | undefined;
  // Hover opens the card after the delay; false leaves only the click.
  hover?: boolean | undefined;
  // Fired alongside the click that pins the card, for a caller whose
  // anchor is also a control of its own (M9 fix 344: the roster's click
  // unfolds the row's team); the card's own opening is untouched.
  onClick?: (() => void) | undefined;
  card: (props: CardProps) => ReactNode;
  children: ReactNode;
}

// The opening and closing of one anchor's card: the hover delay, the
// pin, the leave grace. A hook rather than part of the span so an
// element a span cannot wrap, an SVG lane on the commit graph (M60), can
// anchor a card with the same manners; `open` is what to write on the
// anchor, `handlers` what to spread on it, and `card` renders the card
// off the anchor's rect once it is open.
export interface AnchorState {
  open: 'hover' | 'pinned' | undefined;
  handlers: {
    onClick: (ev: { stopPropagation: () => void }) => void;
    onMouseDown: (ev: { preventDefault: () => void; stopPropagation: () => void }) => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  // The click that pins the card, for an anchor whose own click does
  // something else (a pill that folds its branch) and pins by hover only.
  pin: () => void;
  card: (el: Element | null, render: (props: CardProps) => ReactNode) => ReactNode;
}

export function usePopoverAnchor(hover = true): AnchorState {
  const [open, setOpen] = useState<{ pinned: boolean } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    hoverTimer.current = null;
    leaveTimer.current = null;
  };
  useEffect(() => clearTimers, []);
  const startLeave = () => {
    if (open === null || open.pinned) return;
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setOpen(null), LEAVE_GRACE_MS);
  };
  const cancelLeave = () => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const pin = () => {
    clearTimers();
    setOpen({ pinned: true });
  };
  return {
    open: open === null ? undefined : open.pinned ? 'pinned' : 'hover',
    pin,
    handlers: {
      onClick: (ev) => {
        ev.stopPropagation();
        pin();
      },
      onMouseDown: (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      },
      onMouseEnter: () => {
        cancelLeave();
        if (!hover || open !== null || hoverTimer.current !== null) return;
        hoverTimer.current = setTimeout(() => {
          hoverTimer.current = null;
          setOpen({ pinned: false });
        }, HOVER_DELAY_MS);
      },
      onMouseLeave: () => {
        if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
        startLeave();
      },
    },
    card: (el, render) => (open !== null && el !== null ? render({ anchor: anchorRect(el), onClose: () => setOpen(null), onEnter: cancelLeave, onLeave: startLeave }) : null),
  };
}

// The reading itself: the caller's spans in a span that opens the card.
// A press on it goes no further, so the row does not start a drag or
// show the session and the title bar does not take focus (the terminal
// keeps it).
export function PopoverAnchor({ id, className, data, title, style, hover = true, card, onClick, children }: AnchorProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = usePopoverAnchor(hover);
  return (
    <>
      <span
        ref={ref}
        className={className}
        {...data}
        title={title}
        style={style}
        role="button"
        data-popover-for={id}
        data-popover-open={state.open}
        {...state.handlers}
        onClick={(ev) => {
          state.handlers.onClick(ev);
          onClick?.();
        }}
      >
        {children}
      </span>
      {state.card(ref.current, card)}
    </>
  );
}

interface PopoverCardProps extends CardProps {
  // The anchor's id, for the outside-press check.
  id: string;
  className: string;
  data?: Record<string, string> | undefined;
  // M9 fix 848: Escape closes the card and goes no further.
  holdEscape?: boolean | undefined;
  children: ReactNode;
}

// The card: a portal to the body, placed under its anchor, closed by
// Escape or a press outside it and its anchor.
export function PopoverCard({ id, className, data, anchor, onClose, onEnter, onLeave, holdEscape, children }: PopoverCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Under the reading, left edges aligned, nudged inside the window once
  // measured; above it when there is no room below (a row near the
  // bottom of the sidebar). Placed again after every render, since a
  // card's content can grow while it is open (a working agent's activity
  // line, M9 fix 445's card widening to 320px to fit it) and a card
  // measured only at its first layout ran past the window's right edge;
  // the same place twice leaves the state alone, so this settles in one
  // pass. A ResizeObserver beside it catches growth React did not cause
  // (a font landing), though it reports only when the window draws a
  // frame, which is why it is not the main path.
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 4 });
  const place = (): void => {
    const el = ref.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    const below = anchor.bottom + 4;
    const top = below + r.height <= window.innerHeight - 4 ? below : Math.max(4, anchor.top - 4 - r.height);
    const left = Math.max(4, Math.min(anchor.left, window.innerWidth - r.width - 4));
    setPos((p) => (p.left === left && p.top === top ? p : { left, top }));
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => {
    placeRef.current();
  });
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(() => placeRef.current());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Registered once and read through a ref, as Menu does: the capture
  // phase acknowledge can re-render the caller before this runs.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const holdRef = useRef(holdEscape === true);
  holdRef.current = holdEscape === true;
  useEffect(() => {
    // An answer card (holdEscape) keeps its Escape from the focused
    // terminal too: there Escape means close, and the session's Escape is
    // the Cancel button (M9 fix 848).
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (holdRef.current) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      onCloseRef.current();
    };
    const onDown = (ev: MouseEvent) => {
      if (ref.current !== null && ev.target instanceof Node && ref.current.contains(ev.target)) return;
      // A press on the reading that opened the card is the click that pins it.
      if (ev.target instanceof Element && ev.target.closest(`[data-popover-for=${JSON.stringify(id)}]`) !== null) return;
      onCloseRef.current();
    };
    window.addEventListener('mousedown', onDown, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('mousedown', onDown, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [id]);

  return createPortal(
    <div
      className={className}
      {...data}
      style={pos}
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // The terminal keeps keyboard focus; the card is for reading.
      onMouseDown={(ev) => ev.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}
