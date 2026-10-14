import { useEffect, useRef, useState } from 'react';
import { PROMPT_NAME_MAX } from '@emerald/shared';
import { RenameBox } from './RenameBox.tsx';
import { stepHistory } from './prompt-history.ts';
import type { HistoryEntry } from './prompt-history.ts';

interface Props {
  className: string;
  placeholder: string;
  // Shown under the box, in the error colour, when the send was refused;
  // the box stays open for the person to read it and try again or leave.
  error: string | null;
  // What the arrows cycle: the saved prompts, then the recent ones.
  history: readonly HistoryEntry[];
  // Enter with text in the box. The caller decides whether the box closes.
  onSubmit: (text: string) => void;
  // Escape, or focus leaving the box.
  onCancel: () => void;
  // Ctrl+S with text in the box, once a name has been given for it;
  // absent when the daemon has no saved prompts (an older build).
  onSave: ((name: string, text: string) => void) | null;
}

// M56: the one-line box under a sidebar row that types a prompt into the
// session (the rename and comment boxes' shape, RenameBox.tsx, with a
// placeholder and an error line). Enter sends, Escape or clicking
// elsewhere closes; an empty Enter does nothing. Up and Down walk the
// history, a saved prompt's name as a hint beside the box and the line
// being typed kept for the way back; Ctrl+S asks a name in a second box
// and saves the text under it.
export function PromptBox({ className, placeholder, error, history, onSubmit, onCancel, onSave }: Props) {
  const [value, setValue] = useState('');
  // -1 is the typed line; draft is that line while the arrows are away from it.
  const [index, setIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [naming, setNaming] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!naming) ref.current?.focus();
  }, [naming]);
  const entry = index >= 0 ? (history[index] ?? null) : null;
  const walk = (delta: -1 | 1) => {
    const next = stepHistory(index, delta, history.length);
    if (next === index) return;
    if (index === -1) setDraft(value);
    setIndex(next);
    setValue(next === -1 ? draft : (history[next]?.text ?? ''));
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') {
      const text = value.trim();
      if (text !== '') onSubmit(text);
    } else if (ev.key === 'Escape') {
      onCancel();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      walk(1);
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      walk(-1);
    } else if (ev.key === 's' && ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
      ev.preventDefault();
      if (onSave !== null && value.trim() !== '') setNaming(true);
    }
    // None of these should reach the picker's Escape handler or a chord.
    ev.stopPropagation();
  };
  return (
    <div className={`${className}-wrap`} data-history-index={index >= 0 ? index : undefined} data-history-name={entry?.name ?? undefined}>
      <div className={`${className}-line`}>
        <input
          ref={ref}
          className={className}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            // Typing leaves the history: the line is the person's again.
            setIndex(-1);
            setValue(e.target.value);
          }}
          onKeyDown={onKeyDown}
          // A blur into the name box is not leaving.
          onBlur={() => {
            if (!naming) onCancel();
          }}
          onClick={(ev) => ev.stopPropagation()}
          onDoubleClick={(ev) => ev.stopPropagation()}
          spellCheck={false}
          data-error={error !== null || undefined}
        />
        {entry !== null && <span className={`${className}-hint`}>{entry.name ?? 'recent'}</span>}
      </div>
      {naming && (
        <div className={`${className}-line`}>
          <span className={`${className}-hint`}>save as</span>
          <RenameBox
            initial=""
            className={`${className} ${className}-name`}
            maxLength={PROMPT_NAME_MAX}
            onDone={(name) => {
              setNaming(false);
              if (name !== null && name !== '' && onSave !== null) onSave(name, value.trim());
            }}
          />
        </div>
      )}
      {error !== null && <div className={`${className}-error`}>{error}</div>}
    </div>
  );
}
