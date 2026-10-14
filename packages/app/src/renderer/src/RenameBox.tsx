import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

interface Props {
  initial: string;
  className: string;
  style?: CSSProperties;
  // name null means the rename was cancelled or nothing changed; an empty
  // string means "back to the folder's name", which the daemon understands.
  onDone: (name: string | null) => void;
  // Answer the text even when it is the initial one (M9 fix 309: the
  // rail's name box comes back holding a name that was turned down, and
  // Enter on it must ask again rather than read as nothing changed).
  // null is then Escape alone.
  answerSame?: boolean;
  // The daemon's bound on what this box sets, in UTF-16 code units (M9
  // fix 568). maxLength counts before the trim, so the box is stricter by
  // the surrounding spaces only; a paste past it is cut silently.
  maxLength?: number | undefined;
  // Select the text from 0 to here on mount rather than all of it (M9 fix
  // 574: a file's stem, not its extension).
  selectEnd?: number | undefined;
}

// Inline rename, shared by the sidebar rows, the pane titles, the layout
// tabs and the prompt box: Enter or a click elsewhere keeps what was
// typed (M9 fix 93; a click away used to discard, and a name typed then
// clicked out of was lost), Escape discards.
export function RenameBox({ initial, className, style, onDone, answerSame, maxLength, selectEnd }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  // The box answers once: Enter unmounts it, and if the browser fires a
  // blur for the element going away that must not answer a second time.
  const answered = useRef(false);
  const finish = (name: string | null) => {
    if (answered.current) return;
    answered.current = true;
    onDone(name);
  };
  const keep = () => {
    const name = value.trim();
    finish(name === initial && answerSame !== true ? null : name);
  };
  useEffect(() => {
    ref.current?.focus();
    if (selectEnd === undefined) ref.current?.select();
    else ref.current?.setSelectionRange(0, selectEnd);
  }, []);
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') {
      keep();
    } else if (ev.key === 'Escape') {
      finish(null);
    }
    // Neither key should reach the picker's Escape handler or a chord.
    ev.stopPropagation();
  };
  return (
    <input
      ref={ref}
      className={className}
      style={style}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={keep}
      onClick={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
      spellCheck={false}
      maxLength={maxLength}
    />
  );
}
