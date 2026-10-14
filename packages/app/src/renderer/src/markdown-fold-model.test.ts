import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { defaultFolds, foldSections } from './markdown-fold-model.ts';

const md = new MarkdownIt({ html: false });
const parse = (text: string) => md.parse(text, {});

const notes = ['# What is new', '', 'The lead.', '', '## Fixes 3 to 4, 2026-02-02', '', 'Newer.', '', '### Highlights', '', '**A.** One.', '', '### Details', '', '**B.** Two.', '', '#### A sub-note', '', 'Under the details.', '', '## Fixes 1 to 2, 2026-01-01', '', 'Older.', '', '### Highlights', '', '**C.** Three.', ''].join('\n');

test('foldSections: a ## runs to the next ##, a ### to the next ### or ##, a #### folds nothing and ends nothing (M9 fix 272)', () => {
  const tokens = parse(notes);
  const sections = foldSections(tokens);
  assert.deepEqual(
    sections.map((s) => [s.level, s.key]),
    [
      [2, 'Fixes 3 to 4, 2026-02-02'],
      [3, 'Fixes 3 to 4, 2026-02-02 / Highlights'],
      [3, 'Fixes 3 to 4, 2026-02-02 / Details'],
      [2, 'Fixes 1 to 2, 2026-01-01'],
      [3, 'Fixes 1 to 2, 2026-01-01 / Highlights'],
    ],
  );
  const [newer, hi, details, older, oldHi] = sections;
  // The title is not a section, so the first section opens at the first ##.
  assert.equal(tokens[newer!.from]!.tag, 'h2');
  // The newer batch runs up to the older one's heading; its Details, with
  // the #### inside it, runs to the same point.
  assert.equal(newer!.to, older!.from);
  assert.equal(details!.to, older!.from);
  // Highlights ends where Details opens.
  assert.equal(hi!.to, details!.from);
  // The last sections run to the end of the tokens.
  assert.equal(older!.to, tokens.length);
  assert.equal(oldHi!.to, tokens.length);
  // Each section's tokens hold its heading and its paragraphs.
  const text = (s: { from: number; to: number }) =>
    tokens
      .slice(s.from, s.to)
      .filter((t) => t.type === 'inline')
      .map((t) => t.content)
      .join('|');
  assert.equal(text(hi!), 'Highlights|**A.** One.');
  assert.equal(text(details!), 'Details|**B.** Two.|A sub-note|Under the details.');
});

test('foldSections: a heading inside a blockquote is not a section, and a # ends every open one', () => {
  const tokens = parse(['## A', '', '> ## quoted', '', 'a text', '', '# Title again', '', 'no section', '', '## B', ''].join('\n'));
  const sections = foldSections(tokens);
  assert.deepEqual(
    sections.map((s) => s.key),
    ['A', 'B'],
  );
  const title = tokens.findIndex((t) => t.type === 'heading_open' && t.tag === 'h1');
  assert.equal(sections[0]!.to, title);
  assert.equal(foldSections(parse('just a paragraph\n')).length, 0);
});

test('defaultFolds: the older batches on the notes, nothing on a plain file', () => {
  const sections = foldSections(parse(notes));
  assert.deepEqual([...defaultFolds(sections, true)], ['Fixes 1 to 2, 2026-01-01']);
  assert.deepEqual([...defaultFolds(sections, false)], []);
});
