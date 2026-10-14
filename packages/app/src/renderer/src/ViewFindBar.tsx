import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { findCountText } from './find-model.ts';
import { VIEW_FIND_LIMIT, RUN_INLINE_TAGS, FIND_SKIP_SELECTOR, VIEW_CHANGE_EVENT, findInRuns, scrollDelta, stepIndex } from './view-find-model.ts';

interface Props {
  // The file body; the view is looked up inside it, so a re-render that
  // replaces the view's element is found again on the next search.
  body: RefObject<HTMLDivElement | null>;
  viewSelector: '.markdown-view' | '.transcript-view';
  // The text the view renders: a change on disk re-renders it and the old
  // ranges point at nodes that are gone, so the bar searches again.
  text: string;
  // Goes up on every Ctrl+F, so a press while the bar shows puts the
  // keyboard back in the box, as FindBar.tsx's does.
  focusSeq: number;
  onClose: () => void;
}

const ALL = 'emerald-find';
const CURRENT = 'emerald-find-current';

function clearHighlights() {
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}

// Unfolds what hides a hit, then scrolls it into the view. A hit inside
// a folded markdown section has its folded sections opened from the
// outermost in, by a click on each heading, so MarkdownView's own handler
// keeps its fold set in step; a hit in a clamped transcript reply opens
// the reply the same way. The scroll waits a timer for the layout those
// clicks change (a timer runs in a covered window, a frame does not).
function reveal(range: Range, root: HTMLElement) {
  const start = range.startContainer.parentElement;
  if (start !== null) {
    const folds: HTMLElement[] = [];
    let fold = start.closest<HTMLElement>('.md-fold[data-folded]');
    while (fold !== null) {
      // A hit in the folded section's own heading is already shown.
      if (!(fold.firstElementChild?.contains(start) ?? false)) folds.unshift(fold);
      fold = fold.parentElement?.closest<HTMLElement>('.md-fold[data-folded]') ?? null;
    }
    for (const f of folds) (f.firstElementChild as HTMLElement | null)?.click();
    start.closest<HTMLElement>('.transcript-reply:not([data-whole])')?.click();
  }
  setTimeout(() => {
    if (!root.isConnected) return;
    const delta = scrollDelta(range.getBoundingClientRect(), root.getBoundingClientRect());
    if (delta !== null) root.scrollTop += delta;
  }, 0);
}

// Find in a rendered markdown file or a transcript's turns (M9 fix 619):
// the terminal's find bar in look (the same classes, words and count),
// over a view that has no Monaco. The hits are marked in place with the
// CSS highlight registry, which paints ranges without touching the DOM,
// so the view's own nodes, its selection and its folds are left alone.
export function ViewFindBar({ body, viewSelector, text, focusSeq, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ ranges: Range[]; capped: boolean } | null>(null);
  const [index, setIndex] = useState(-1);
  const indexRef = useRef(index);
  indexRef.current = index;
  const lastQuery = useRef('');
  // Goes up when the view says its shown text changed in place (a diagram
  // drawn, a mermaid box toggled), so the search runs again.
  const [changeSeq, setChangeSeq] = useState(0);

  useEffect(() => {
    const el = body.current;
    if (el === null) return;
    const onChange = () => setChangeSeq((n) => n + 1);
    el.addEventListener(VIEW_CHANGE_EVENT, onChange);
    return () => el.removeEventListener(VIEW_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  const viewRoot = () => body.current?.querySelector<HTMLElement>(viewSelector) ?? null;

  // Search on a change of the query and again on a change of the text. A
  // new query starts at the first hit in document order and brings it
  // into view; a new text keeps the hit it was on where it can.
  useEffect(() => {
    const queryChanged = lastQuery.current !== query;
    lastQuery.current = query;
    const root = viewRoot();
    if (query === '' || root === null) {
      setFound(null);
      setIndex(-1);
      return;
    }
    const nodes: Text[] = [];
    // Rejecting an element skips its whole subtree; skipping one walks on
    // into its children, so only text nodes are collected.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : (n as Element).matches(FIND_SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP),
    });
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) nodes.push(n as Text);
    // A text's run is its nearest ancestor that is not an inline tag, so a
    // word split by <strong> or a link is one hit (M9 fix 635).
    const ids = new Map<Element, number>();
    const runIds = nodes.map((n) => {
      let el = n.parentElement;
      while (el !== null && el !== root && RUN_INLINE_TAGS.has(el.tagName)) el = el.parentElement;
      const key = el ?? root;
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      return id;
    });
    const { hits, capped } = findInRuns(
      nodes.map((n) => n.data),
      runIds,
      query,
    );
    const ranges = hits.map((h) => {
      const r = document.createRange();
      r.setStart(nodes[h.startNode] as Text, h.start);
      r.setEnd(nodes[h.endNode] as Text, h.end);
      return r;
    });
    setFound({ ranges, capped });
    const next = ranges.length === 0 ? -1 : queryChanged ? 0 : Math.max(0, Math.min(indexRef.current, ranges.length - 1));
    setIndex(next);
    const current = ranges[next];
    if (queryChanged && current !== undefined) reveal(current, root);
  }, [query, text, changeSeq]);

  // Every hit in the find colour, the current one over it in the active
  // colour (priority 1 paints it above the other).
  useEffect(() => {
    if (found === null) {
      clearHighlights();
      return;
    }
    CSS.highlights.set(ALL, new Highlight(...found.ranges));
    const current = found.ranges[index];
    if (current === undefined) {
      CSS.highlights.delete(CURRENT);
      return;
    }
    const h = new Highlight(current);
    h.priority = 1;
    CSS.highlights.set(CURRENT, h);
  }, [found, index]);

  // The bar takes its marks with it when it goes.
  useEffect(() => clearHighlights, []);

  const step = (dir: 1 | -1) => {
    if (found === null || found.ranges.length === 0) return;
    const next = stepIndex(index, found.ranges.length, dir);
    setIndex(next);
    const current = found.ranges[next];
    const root = viewRoot();
    if (current !== undefined && root !== null) reveal(current, root);
  };
  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      step(ev.shiftKey ? -1 : 1);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      onClose();
    }
  };
  // The buttons swallow their mousedown so the box keeps the keyboard.
  const keep = (ev: React.MouseEvent) => ev.preventDefault();
  const results = found === null ? null : { index, count: found.ranges.length };
  return (
    <div className="view-find-bar" data-count={results?.count} data-index={results === null ? undefined : results.index + 1}>
      <input
        ref={inputRef}
        className="find-input"
        type="text"
        placeholder="Find"
        spellCheck={false}
        value={query}
        onChange={(ev) => setQuery(ev.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="find-count" data-none={results !== null && results.count === 0 ? 'true' : undefined} title={found?.capped === true ? `Stopped at the first ${VIEW_FIND_LIMIT}` : undefined}>
        {findCountText(results)}
      </span>
      <button className="find-button" title="Previous match (Shift+Enter)" onMouseDown={keep} onClick={() => step(-1)}>
        ↑
      </button>
      <button className="find-button" title="Next match (Enter)" onMouseDown={keep} onClick={() => step(1)}>
        ↓
      </button>
      <button className="find-button find-close" title="Close (Escape)" onMouseDown={keep} onClick={onClose}>
        ×
      </button>
    </div>
  );
}
