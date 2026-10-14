import { useEffect, useMemo, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import { findCountText } from './find-model.ts';
import type { FindResults } from './find-model.ts';
import { closeFind } from './ui.ts';
import { useSkin } from './skin.ts';

interface Props {
  paneId: string;
  term: Terminal;
  search: SearchAddon;
  // Goes up on every open, so a press while the bar is showing puts the
  // keyboard back in the box (ui.ts).
  focusSeq: number;
}

// The colours are the skin's find tokens (--find-match and the rest in
// style.css). The addon takes hex, not a var(), so the bar reads the
// tokens (M9 fix 569) and reads them again on a skin flip, finding again
// in place (M9 fix 594). The overview ruler is off, so those two are
// never drawn but the option type wants them.
function findDecorations(): NonNullable<ISearchOptions['decorations']> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    matchBackground: read('--find-match'),
    matchBorder: read('--find-match-border'),
    matchOverviewRuler: read('--find-match-border'),
    activeMatchBackground: read('--find-active'),
    activeMatchBorder: read('--find-active-border'),
    activeMatchColorOverviewRuler: read('--find-active-border'),
  };
}

// Find in the scrollback (M26): a box over the top of the terminal, the
// count beside it, next and previous. The searching is xterm's search
// addon, which walks the buffer and decorates every hit; this is only the
// box around it. Typing searches as it goes, Enter and Shift+Enter step,
// Escape and the × close the bar and hand the keyboard back to the
// terminal. The count comes from the addon's own event, which fires on
// every find, so nothing here waits for a frame.
export function FindBar({ paneId, term, search, focusSeq }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [results, setResults] = useState<FindResults | null>(null);
  const skin = useSkin();
  // skin is the dependency, not read: findDecorations reads the tokens
  // setSkin has already put on <html> (M9 fix 594).
  const options = useMemo<ISearchOptions>(() => ({ caseSensitive: false, decorations: findDecorations() }), [skin]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  // The addon is the terminal's, built with it; the bar only listens
  // while it is open and takes its highlights with it when it goes.
  useEffect(() => {
    const sub = search.onDidChangeResults((ev) => setResults({ index: ev.resultIndex, count: ev.resultCount }));
    return () => {
      sub.dispose();
      search.clearDecorations();
    };
  }, [search]);

  // A skin flip with the bar open (M9 fix 594): options is re-made with
  // the new colours, but the addon re-highlights only when the term or a
  // search flag changes, so the old highlights are cleared and the term
  // found again. Clearing drops the cached term, so the search starts at
  // the selected hit and the same hit stays selected.
  useEffect(() => {
    if (text === '') return;
    search.clearDecorations();
    search.findNext(text, { ...options, incremental: true });
  }, [options, search]);

  // A pane that goes away with its bar open must not leave the entry
  // behind, or the bar would come back with the next session shown there.
  useEffect(() => () => closeFind(paneId), [paneId]);

  const onChange = (value: string) => {
    setText(value);
    if (value === '') {
      search.clearDecorations();
      setResults(null);
      return;
    }
    // Incremental: the selection grows with the term instead of jumping
    // to the next hit on every letter.
    search.findNext(value, { ...options, incremental: true });
  };
  const next = () => {
    if (text !== '') search.findNext(text, options);
  };
  const previous = () => {
    if (text !== '') search.findPrevious(text, options);
  };
  const close = () => {
    closeFind(paneId);
    term.focus();
  };
  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.shiftKey) previous();
      else next();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      close();
    }
  };
  // The buttons swallow their mousedown so the box keeps the keyboard.
  const keep = (ev: React.MouseEvent) => ev.preventDefault();
  const countText = findCountText(results);
  return (
    <div className="find-bar" data-count={results?.count} data-index={results === null ? undefined : results.index + 1}>
      <input
        ref={inputRef}
        className="find-input"
        type="text"
        placeholder="Find"
        spellCheck={false}
        value={text}
        onChange={(ev) => onChange(ev.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="find-count" data-none={results !== null && results.count === 0 ? 'true' : undefined}>
        {countText}
      </span>
      <button className="find-button" title="Previous match (Shift+Enter)" onMouseDown={keep} onClick={previous}>
        ↑
      </button>
      <button className="find-button" title="Next match (Enter)" onMouseDown={keep} onClick={next}>
        ↓
      </button>
      <button className="find-button find-close" title="Close (Escape)" onMouseDown={keep} onClick={close}>
        ×
      </button>
    </div>
  );
}
