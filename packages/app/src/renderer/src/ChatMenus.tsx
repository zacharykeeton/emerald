import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SlashRow } from './chat-model.ts';
import { TerminalIcon } from './icons.tsx';

// The chat box's menus (M9 fixes 719 and 720), over the box and wearing
// the window menu's look (.menu, its rows .menu-item). Not Menu.tsx's
// Menu: that one closes on any key (fix 299), and these are typeaheads,
// so the box keeps the keyboard and drives the highlight; this takes no
// keys of its own and is not counted in Menu.tsx's openMenus. From the
// body, as Menu is, so the panes view's stacking context cannot cover it.

// The floating list, its left edge at the box's and its bottom 4 px over
// the box's top. A press outside it and the box closes it; its rows keep
// the box's focus by refusing their mousedown.
export function ChatMenu({ box, kind, onClose, children }: { box: HTMLTextAreaElement | null; kind: 'slash' | 'mention'; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const t = ev.target;
      if (t instanceof Node && (ref.current?.contains(t) || box?.contains(t))) return;
      onCloseRef.current();
    };
    window.addEventListener('mousedown', onDown, { capture: true });
    return () => window.removeEventListener('mousedown', onDown, { capture: true });
  }, [box]);
  // The highlighted row kept in sight as the arrows move it.
  useLayoutEffect(() => {
    ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  });
  if (box === null) return null;
  const r = box.getBoundingClientRect();
  return createPortal(
    <div className="menu chat-menu" data-menu={kind} ref={ref} style={{ left: r.left, bottom: window.innerHeight - r.top + 4 }}>
      {children}
    </div>,
    document.body,
  );
}

const SECTION_HEADINGS: Record<SlashRow['section'], string> = {
  sent: 'Sent to the session',
  terminal: 'Open in the terminal',
};

// The `/` menu's rows under their two headings; `active` indexes `rows`.
export function SlashMenu({ box, rows, active, onPick, onClose }: { box: HTMLTextAreaElement | null; rows: readonly SlashRow[]; active: number; onPick: (row: SlashRow) => void; onClose: () => void }) {
  const items: ReactNode[] = [];
  rows.forEach((row, i) => {
    if (i === 0 || rows[i - 1]!.section !== row.section) {
      items.push(
        <div key={`heading:${row.section}`} className="menu-item menu-sep menu-heading chat-menu-heading" role="presentation">
          <span className="menu-label">{SECTION_HEADINGS[row.section]}</span>
        </div>,
      );
    }
    items.push(
      <button
        key={`${row.section}:${row.name}`}
        type="button"
        className="menu-item chat-menu-row"
        data-section={row.section}
        data-name={row.name}
        data-skill={row.skill ? '' : undefined}
        data-active={i === active ? 'true' : undefined}
        title={row.description === '' ? undefined : row.description}
        onMouseDown={(ev) => ev.preventDefault()}
        onClick={() => onPick(row)}
      >
        <span className="chat-menu-name">{row.name}</span>
        {row.section === 'terminal' ? <TerminalIcon /> : <span className="chat-menu-desc">{row.description}</span>}
      </button>,
    );
  });
  return (
    <ChatMenu box={box} kind="slash" onClose={onClose}>
      {items}
    </ChatMenu>
  );
}

// The chat box's attach button (M9 fix 721): a paperclip.
export function PaperclipIcon() {
  return (
    <svg className="chat-attach-icon" viewBox="0 0 16 16" width={13} height={13} aria-hidden="true">
      <path d="M10.5 4.5 5.8 9.2a1.3 1.3 0 0 0 1.8 1.8l5-5a2.6 2.6 0 0 0-3.7-3.7l-5 5a3.9 3.9 0 0 0 5.5 5.5l4.2-4.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface MentionRow {
  name: string;
  kind: 'dir' | 'file';
}

// The `@` menu (M9 fix 720): the entries of the one folder the typed
// path names, a folder's name with its slash, the folder the row sits in
// beside it, and a line saying the keys under them.
export function MentionMenu({ box, dir, rows, active, onPick, onClose }: { box: HTMLTextAreaElement | null; dir: string; rows: readonly MentionRow[]; active: number; onPick: (row: MentionRow) => void; onClose: () => void }) {
  return (
    <ChatMenu box={box} kind="mention" onClose={onClose}>
      {rows.map((row, i) => (
        <button
          key={`${row.kind}:${row.name}`}
          type="button"
          className="menu-item chat-menu-row"
          data-kind={row.kind}
          data-path={`${dir}${row.name}${row.kind === 'dir' ? '/' : ''}`}
          data-active={i === active ? 'true' : undefined}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(row)}
        >
          <span className="chat-mention-name">{row.kind === 'dir' ? `${row.name}/` : row.name}</span>
          <span className="chat-mention-folder">{dir === '' ? './' : dir}</span>
        </button>
      ))}
      <div className="chat-menu-foot">Tab or Enter adds the path · Esc closes</div>
    </ChatMenu>
  );
}
