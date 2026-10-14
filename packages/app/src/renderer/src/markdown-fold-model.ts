// The pure part of the markdown view's folding headings (M9 fix 272),
// with no DOM or markdown-it at runtime so node:test can cover it. Every
// `##` and `###` heading of a rendered markdown file heads a section that
// runs to the next heading of the same or a higher level, and the view
// wraps each in a block a click on the heading folds. This module finds
// the sections in markdown-it's block tokens; the view does the wrapping.

// What the pass reads off a token: markdown-it's Token has all of these.
export interface FoldableToken {
  type: string;
  tag: string;
  // Block nesting depth: a heading inside a blockquote sits at 1 and is
  // not a section of the document.
  level: number;
  content: string;
}

export interface FoldSection {
  // 2 or 3, the heading's level.
  level: number;
  // The heading's own words, markdown-it's inline source.
  heading: string;
  // The heading under its ancestors (`Fixes 1 to 2 / Highlights`), which
  // is what the fold state is kept by: `Highlights` sits under every
  // batch of the notes, so the words alone would fold them all as one.
  key: string;
  // Token indices: the heading_open token, and the first token after the
  // section's last one (exclusive), so a wrapper opens before `from` and
  // closes before `to`.
  from: number;
  to: number;
}

// Which headings fold. A `#` is the document's title and a `####` a
// paragraph's; neither heads a section, but a `#` ends every open one.
const FOLD_LEVELS = new Set([2, 3]);

export function foldSections(tokens: readonly FoldableToken[]): FoldSection[] {
  const out: FoldSection[] = [];
  const open: FoldSection[] = [];
  const close = (atLevel: number, at: number) => {
    while (open.length > 0 && open[open.length - 1]!.level >= atLevel) open.pop()!.to = at;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type !== 'heading_open' || t.level !== 0) continue;
    const level = Number(t.tag.slice(1));
    if (!Number.isFinite(level)) continue;
    close(level, i);
    if (!FOLD_LEVELS.has(level)) continue;
    const heading = tokens[i + 1]?.type === 'inline' ? tokens[i + 1]!.content.trim() : '';
    const parent = open[open.length - 1];
    const section: FoldSection = { level, heading, key: parent === undefined ? heading : `${parent.key} / ${heading}`, from: i, to: tokens.length };
    open.push(section);
    out.push(section);
  }
  close(0, tokens.length);
  return out;
}

// The keys folded before anyone has clicked: on the What's New tab every
// batch but the newest, so the notes open on what is new and the older
// batches are a heading each; on a plain file nothing.
export function defaultFolds(sections: readonly FoldSection[], olderTopSections: boolean): Set<string> {
  const out = new Set<string>();
  if (!olderTopSections) return out;
  let first = true;
  for (const s of sections) {
    if (s.level !== 2) continue;
    if (!first) out.add(s.key);
    first = false;
  }
  return out;
}
