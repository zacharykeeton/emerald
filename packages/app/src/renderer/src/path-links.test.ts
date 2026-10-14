import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolutePath, joinWrappedRows, pathLinkAction, pathLinkParts, pathLinkTitle, pathLinksIn, resolvePathLink } from './path-links.ts';
import type { WrapBuffer, WrapLine } from './path-links.ts';

const texts = (line: string) => pathLinksIn(line).map((l) => l.text);

test('a Windows absolute path, with a line and a column or without (M9 fix 357)', () => {
  assert.deepEqual(texts('error at C:\\Users\\me\\repo\\src\\a.ts:12:5 in build'), ['C:\\Users\\me\\repo\\src\\a.ts:12:5']);
  assert.deepEqual(texts('C:/repo/src/a.ts:12'), ['C:/repo/src/a.ts:12']);
  assert.deepEqual(texts('PS C:\\Users\\me>'), ['C:\\Users\\me']);
});

test('a relative path needs a separator or a known extension', () => {
  assert.deepEqual(texts('  packages/app/package.json:3'), ['packages/app/package.json:3']);
  assert.deepEqual(texts('see ./notes\\lines.txt and ../up'), ['./notes\\lines.txt', '../up']);
  assert.deepEqual(texts('wrote README.md and index.tsx today'), ['README.md', 'index.tsx']);
  assert.deepEqual(texts('the word apple and version 1.2.3'), []);
  assert.deepEqual(texts('at 10:30:15 the build ran'), []);
});

test('a token ends before whitespace, a quote, a bracket, a comma or a trailing period', () => {
  assert.deepEqual(texts('open "src/a.ts" or (src/b.ts:4), or `src/c.ts`.'), ['src/a.ts', 'src/b.ts:4', 'src/c.ts']);
  assert.deepEqual(texts('see src/a.ts.'), ['src/a.ts']);
  assert.deepEqual(texts('--file=src/a.ts [src/b.ts] {src/c.ts} <src/d.ts>'), ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
  const one = pathLinksIn('x src/a.ts:7 y')[0];
  assert.deepEqual(one, { text: 'src/a.ts:7', start: 2, end: 12 });
});

test('a URL does not match the path pattern, and a path is not a URL', () => {
  assert.deepEqual(texts('https://ex.io/204 and http://a.b/c.ts'), []);
  assert.deepEqual(texts('file://C:/x/y.ts'), []);
  // The URL addon's own pattern: a path has no scheme.
  const url = /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~[\]`()<>]/;
  assert.equal(url.test('packages/app/package.json:3'), false);
  assert.equal(url.test('C:\\Users\\me\\a.ts'), false);
});

test('the parts: the path, the line and the column', () => {
  assert.deepEqual(pathLinkParts('src/a.ts:12:5'), { path: 'src/a.ts', line: 12, column: 5 });
  assert.deepEqual(pathLinkParts('src/a.ts:12'), { path: 'src/a.ts', line: 12, column: undefined });
  assert.deepEqual(pathLinkParts('C:\\x\\a.ts'), { path: 'C:\\x\\a.ts', line: undefined, column: undefined });
  assert.deepEqual(pathLinkParts('C:\\x\\a.ts:3'), { path: 'C:\\x\\a.ts', line: 3, column: undefined });
});

test('a relative path resolves under the folder with . and .. walked; an absolute one takes Windows separators', () => {
  assert.equal(resolvePathLink('C:\\repo', 'packages/app/package.json'), 'C:\\repo\\packages\\app\\package.json');
  assert.equal(resolvePathLink('C:\\repo\\src', './a.ts'), 'C:\\repo\\src\\a.ts');
  assert.equal(resolvePathLink('C:\\repo\\src', '../b/../c.ts'), 'C:\\repo\\c.ts');
  assert.equal(resolvePathLink('C:\\repo', '../../../up'), 'C:\\up');
  assert.equal(resolvePathLink('C:\\repo', 'C:/other/x.ts'), 'C:\\other\\x.ts');
  assert.equal(resolvePathLink('C:\\repo', '\\\\box\\share\\a.ts'), '\\\\box\\share\\a.ts');
  assert.equal(resolvePathLink('C:\\', 'a.ts'), 'C:\\a.ts');
});

test('absolute against relative', () => {
  assert.equal(isAbsolutePath('C:\\x'), true);
  assert.equal(isAbsolutePath('c:/x'), true);
  assert.equal(isAbsolutePath('\\\\box\\share\\a.ts'), true);
  assert.equal(isAbsolutePath('src/a.ts'), false);
  assert.equal(isAbsolutePath('./a.ts'), false);
});

// A fake terminal buffer for joinWrappedRows: one character a cell, no
// wide characters, wrapped rows named by index.
function fakeBuffer(rows: string[], wrappedRows: Set<number>): WrapBuffer {
  const lines: WrapLine[] = rows.map((row, i) => ({
    isWrapped: wrappedRows.has(i),
    length: row.length,
    getCell: (x: number) => (x < row.length ? { getWidth: () => 1, getChars: () => row[x] ?? '' } : undefined),
  }));
  return { getLine: (y: number) => lines[y] };
}

test('joinWrappedRows joins a path xterm wrapped at the pane edge, a row apiece (M9 fix 423)', () => {
  const rows = ['see C:\\repo\\src\\a-long-fold', 'er-name\\file.ts here'];
  const buffer = fakeBuffer(rows, new Set([1]));
  const joined = joinWrappedRows(buffer, 0);
  assert.equal(joined.text, rows.join(''));
  assert.deepEqual(joined.cellOf[0], { y: 0, x: 0 });
  assert.deepEqual(joined.cellOf[joined.text.length - 1], { y: 1, x: rows[1]!.length - 1 });
  const link = pathLinksIn(joined.text).find((l) => l.text.startsWith('C:\\repo'));
  assert.ok(link !== undefined);
  assert.equal(link?.text, 'C:\\repo\\src\\a-long-folder-name\\file.ts');
  const startCell = joined.cellOf[link!.start];
  const endCell = joined.cellOf[link!.end - 1];
  assert.deepEqual(startCell, { y: 0, x: 4 });
  assert.equal(endCell!.y, 1);
  // Asking from the second row of the same wrap gives the same join.
  assert.deepEqual(joinWrappedRows(buffer, 1), joined);
  // A row with no wrap on either side joins to itself alone.
  const plain = fakeBuffer(['just one line'], new Set());
  assert.deepEqual(joinWrappedRows(plain, 0), { text: 'just one line', cellOf: [...'just one line'].map((_, x) => ({ y: 0, x })) });
});

test('pathLinkTitle: a folder opens in Explorer, a file keeps the fix 357 text (M9 fix 653)', () => {
  assert.equal(pathLinkTitle('C:\\repo\\f653\\in', 'dir'), 'Ctrl+click opens C:\\repo\\f653\\in in Explorer');
  assert.equal(pathLinkTitle('C:\\repo\\r653.txt', 'file'), 'Ctrl+click opens C:\\repo\\r653.txt');
});

test('pathLinkAction: Ctrl takes the link, Shift turns a file into a reveal, a folder opens either way (M9 fix 653)', () => {
  assert.equal(pathLinkAction('file', { ctrlKey: true, shiftKey: false }), 'tab');
  assert.equal(pathLinkAction('file', { ctrlKey: true, shiftKey: true }), 'reveal');
  assert.equal(pathLinkAction('dir', { ctrlKey: true, shiftKey: false }), 'open-folder');
  assert.equal(pathLinkAction('dir', { ctrlKey: true, shiftKey: true }), 'open-folder');
  assert.equal(pathLinkAction('file', { ctrlKey: false, shiftKey: false }), null);
  assert.equal(pathLinkAction('file', { ctrlKey: false, shiftKey: true }), null);
  assert.equal(pathLinkAction('dir', { ctrlKey: false, shiftKey: false }), null);
  assert.equal(pathLinkAction('dir', { ctrlKey: false, shiftKey: true }), null);
});
