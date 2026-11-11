import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continuedLinkHolds, isAbsolutePath, joinContinuedRows, joinWrappedRows, linkPressKept, pathLinkAction, pathLinkParts, pathLinkTitle, pathLinksIn, resolvePathLink, seamIn, urlLinkTitle, WRAP_ROW_CAP } from './path-links.ts';
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

test('joinContinuedRows joins a path a program broke with an indent, from either row (M9 fix 1099)', () => {
  // The first row padded with blanks, as xterm's rows are; no row wrapped.
  const rows = ['Read C:\\tmp\\scratchpad\\handoff-plan-batch      ', '  -test-shield.md and do what it says.'];
  const buffer = fakeBuffer(rows, new Set());
  const joined = joinContinuedRows(buffer, 0);
  assert.equal(joined.text, 'Read C:\\tmp\\scratchpad\\handoff-plan-batch-test-shield.md and do what it says.');
  assert.deepEqual(joined.seams, [41]);
  assert.deepEqual(joined.cellOf[41], { y: 1, x: 2 });
  assert.deepEqual(joinContinuedRows(buffer, 1), joined);
  const link = pathLinksIn(joined.text).find((l) => l.text.startsWith('C:'));
  assert.equal(link?.text, 'C:\\tmp\\scratchpad\\handoff-plan-batch-test-shield.md');
  assert.equal(seamIn(link!, joined.seams), 41);
  // Today's walk joins nothing here: the first row alone.
  assert.equal(joinWrappedRows(buffer, 0).text, rows[0]);
});

test('joinContinuedRows joins nothing past a row that ends in no path, or into a row that is not indented or is blank (M9 fix 1099)', () => {
  for (const rows of [
    ['see C:\\a\\b', 'next'],
    ['see C:\\a\\b.', '  c.md'],
    ['done', '  -x.md'],
    ['see C:\\a\\b', '   '],
  ]) {
    const joined = joinContinuedRows(fakeBuffer(rows, new Set()), 0);
    assert.deepEqual(joined.seams, [], JSON.stringify(rows));
    assert.equal(joined.text, rows[0], JSON.stringify(rows));
  }
});

test("joinContinuedRows walks through xterm's wrap and an indent together, capped at WRAP_ROW_CAP rows each way (M9 fix 1099)", () => {
  const mixed = joinContinuedRows(fakeBuffer(['see C:\\a\\long-fo', 'lder\\b-', '  c.md'], new Set([1])), 0);
  assert.equal(mixed.text, 'see C:\\a\\long-folder\\b-c.md');
  assert.deepEqual(mixed.seams, [23]);
  const six = joinContinuedRows(fakeBuffer(['x C:\\a\\b', '  c\\d', '  e\\f', '  g\\h', '  i\\j', '  k\\l'], new Set()), 0);
  assert.equal(WRAP_ROW_CAP, 4);
  assert.equal(six.text, 'x C:\\a\\bc\\de\\fg\\hi\\j');
  assert.equal(six.seams.length, 4);
});

test('seamIn and continuedLinkHolds: a token across a seam holds when the whole is a file and the first row part is not (M9 fix 1099)', () => {
  const link = { text: 'abcdef', start: 10, end: 16 };
  assert.equal(seamIn(link, [5, 13]), 13);
  assert.equal(seamIn(link, [10, 16]), null, 'a seam at an end is no seam inside');
  assert.equal(continuedLinkHolds({ kind: 'file' }, { error: 'x' }), true);
  assert.equal(continuedLinkHolds({ kind: 'file' }, { kind: 'dir' }), true);
  assert.equal(continuedLinkHolds({ kind: 'file' }, { kind: 'file' }), false);
  assert.equal(continuedLinkHolds({ error: 'x' }, { error: 'x' }), false);
  assert.equal(continuedLinkHolds({ kind: 'dir' }, { error: 'x' }), false);
});

test('pathLinkTitle: a folder opens in Explorer, a file says beside when a file pane can take it (M9 fixes 653 and 864)', () => {
  assert.equal(pathLinkTitle('C:\\repo\\f653\\in', 'dir', true), 'Ctrl+click opens C:\\repo\\f653\\in in Explorer');
  assert.equal(pathLinkTitle('C:\\repo\\f653\\in', 'dir', false), 'Ctrl+click opens C:\\repo\\f653\\in in Explorer');
  assert.equal(pathLinkTitle('C:\\repo\\r653.txt', 'file', true), 'Ctrl+click opens C:\\repo\\r653.txt in a pane beside');
  assert.equal(pathLinkTitle('C:\\repo\\r653.txt', 'file', false), 'Ctrl+click opens C:\\repo\\r653.txt');
});

test('urlLinkTitle: a URL says beside when a browser pane can take it, and the fix 204 text when not (M9 fix 863)', () => {
  assert.equal(urlLinkTitle('https://ex.io/204', true), 'Ctrl+click opens https://ex.io/204 in a pane beside');
  assert.equal(urlLinkTitle('https://ex.io/204', false), 'Ctrl+click opens https://ex.io/204');
});

test('linkPressKept: a Ctrl press on a shown link is kept from a program that tracks the mouse, and nothing else is (M9 fix 1098)', () => {
  const ctrl = { button: 0, ctrlKey: true };
  assert.equal(linkPressKept(ctrl, 'vt200', true), true);
  assert.equal(linkPressKept(ctrl, 'any', true), true);
  assert.equal(linkPressKept(ctrl, 'drag', true), true);
  assert.equal(linkPressKept(ctrl, 'none', true), false, 'a plain shell tracks no mouse');
  assert.equal(linkPressKept({ button: 0, ctrlKey: false }, 'vt200', true), false, "a plain click is the program's");
  assert.equal(linkPressKept({ button: 2, ctrlKey: true }, 'vt200', true), false, "the right button is fix 538's route");
  assert.equal(linkPressKept(ctrl, 'vt200', false), false, 'no link shown');
});

test('pathLinkAction: Ctrl takes the link, Shift turns a file into a reveal, a folder opens either way (M9 fix 653)', () => {
  assert.equal(pathLinkAction('file', { ctrlKey: true, shiftKey: false }, true), 'beside');
  assert.equal(pathLinkAction('file', { ctrlKey: true, shiftKey: true }, true), 'reveal');
  assert.equal(pathLinkAction('dir', { ctrlKey: true, shiftKey: false }, true), 'open-folder');
  assert.equal(pathLinkAction('dir', { ctrlKey: true, shiftKey: true }, true), 'open-folder');
  assert.equal(pathLinkAction('file', { ctrlKey: false, shiftKey: false }, true), null);
  assert.equal(pathLinkAction('file', { ctrlKey: false, shiftKey: true }, true), null);
  assert.equal(pathLinkAction('dir', { ctrlKey: false, shiftKey: false }, true), null);
  assert.equal(pathLinkAction('dir', { ctrlKey: false, shiftKey: true }, true), null);
  // A daemon too old for a file pane keeps the tab (M9 fix 864).
  assert.equal(pathLinkAction('file', { ctrlKey: true, shiftKey: false }, false), 'tab');
  assert.equal(pathLinkAction('file', { ctrlKey: true, shiftKey: true }, false), 'reveal');
  assert.equal(pathLinkAction('dir', { ctrlKey: true, shiftKey: false }, false), 'open-folder');
});
