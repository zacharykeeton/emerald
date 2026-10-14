// The pure part of the find bar over a rendered markdown file or a
// transcript's turns (M9 fix 619), with no DOM so node:test can cover it.
// ViewFindBar.tsx walks the view's text nodes, hands their texts and runs here,
// and turns the hits back into Ranges for the CSS highlight registry.

// The most hits one search marks, so a one-letter query over a long
// transcript does not make tens of thousands of ranges.
export const VIEW_FIND_LIMIT = 1000;

// The elements the walk does not enter (M9 fix 658): the hidden side of a
// mermaid box, the CSS inside a drawn diagram's SVG, and the box's two
// toggle words, none of which a reader sees as the text of the page.
export const FIND_SKIP_SELECTOR = '[hidden], style, .md-mermaid-toggle';

// Dispatched (bubbling) on a view's element when its shown text changes
// without a new text from disk, a diagram drawn or a box toggled, so an
// open find bar searches again.
export const VIEW_CHANGE_EVENT = 'emerald-view-change';

// A hit: the indexes in walk order of the text nodes holding the match's
// first and last characters, `start` the offset in the first and `end` the
// offset just past the last character in the second.
export interface ViewFindHit {
  startNode: number;
  start: number;
  endNode: number;
  end: number;
}

// The tags that do not break a run of text (M9 fix 635): a word half in
// <strong>, a match across a link's edge, half in <em> or half in <code>
// is one hit. Upper case, as Element.tagName reads in an HTML document.
// SPAN is left out on purpose, so the transcript's classed spans (a prompt
// against its .transcript-when time) never join into false hits; the check
// is by tag rather than getComputedStyle, so a long transcript costs no
// style reads.
export const RUN_INLINE_TAGS: ReadonlySet<string> = new Set(['A', 'STRONG', 'EM', 'B', 'I', 'CODE', 'DEL', 'S', 'MARK', 'SUB', 'SUP', 'KBD']);

// The bar covers the top of the view by this much, so a hit under it is
// as good as off screen.
const BAR_BAND = 36;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every match of the query, case-insensitive, non-overlapping, left to
// right through each run in order. A run is a stretch of adjacent texts
// with equal runIds, one id per text (only adjacent: [0, 1, 0] is three
// runs). Matches run across the texts of one run, so a word half in
// <strong>, a match across a link's edge, half in <em> or half in <code> is
// found, while two blocks (two paragraphs, a prompt and its time) never
// join. The match is a regular expression with the `i` flag rather than a
// compare of lowercased strings, since lowercasing changes some strings'
// length ('İx'.toLowerCase() is three code units) and would shift every
// offset after one. The cap counts across all runs.
export function findInRuns(texts: readonly string[], runIds: readonly number[], query: string): { hits: ViewFindHit[]; capped: boolean } {
  const hits: ViewFindHit[] = [];
  if (query === '') return { hits, capped: false };
  const re = new RegExp(escapeRegExp(query), 'gi');
  let from = 0;
  while (from < texts.length) {
    let to = from + 1;
    while (to < texts.length && runIds[to] === runIds[from]) to++;
    // The run's texts joined, and where each text starts in the joined string.
    const offsets: number[] = [];
    let joined = '';
    for (let i = from; i < to; i++) {
      offsets.push(joined.length);
      joined += texts[i] ?? '';
    }
    // The text holding character `pos`, searching forward from `at`; an
    // empty text never holds one.
    const holder = (pos: number, at: number): number => {
      let i = at;
      while (i + 1 < offsets.length && (offsets[i + 1] ?? 0) <= pos) i++;
      return i;
    };
    re.lastIndex = 0;
    let first = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(joined)) !== null) {
      if (hits.length >= VIEW_FIND_LIMIT) return { hits, capped: true };
      const s = m.index;
      const e = m.index + m[0].length;
      if (m[0].length === 0) {
        // An empty match cannot happen (the query is not empty), but a
        // zero-length step would loop forever, so it is guarded anyway.
        re.lastIndex++;
        continue;
      }
      first = holder(s, first);
      const last = holder(e - 1, first);
      hits.push({ startNode: from + first, start: s - (offsets[first] ?? 0), endNode: from + last, end: e - (offsets[last] ?? 0) });
    }
    from = to;
  }
  return { hits, capped: false };
}

// The next or previous hit, wrapping at both ends; -1 with no hits.
export function stepIndex(index: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0) return dir === 1 ? 0 : count - 1;
  return (index + dir + count) % count;
}

// How far to scroll the view to bring a hit into it, or null when it is
// already in view below the bar's band. A hit out of view lands a third
// of the way down.
export function scrollDelta(hit: { top: number; bottom: number }, view: { top: number; bottom: number }): number | null {
  if (hit.top >= view.top + BAR_BAND && hit.bottom <= view.bottom) return null;
  return hit.top - view.top - (view.bottom - view.top) / 3;
}
