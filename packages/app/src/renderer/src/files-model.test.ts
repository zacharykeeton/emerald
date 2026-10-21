import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout, LayoutTab, SessionInfo, SessionTouched } from '@emerald/shared';
import { applyListing, browserPaneFolders, canEditFrom, chatPaneFolders, localPageFolders, collapseAll, emptyModel, expandFolder, filePaneFolders, folderName, joinPath, normalizePath, parentPath, pathLabel, refusalWords, relativePath, relistLanded, renameInModel, renamedPath, revealStep, rootIsEmpty, select, sessionInFolder, setRoot, stemEnd, toggleFolder, touchedAt, touchedIndex, touchedUnder, liftKeep, moveSelection, rowAfterRemoval, typeAhead, walk, watchOrder, withPending } from './files-model.ts';
import type { FilesModel, Row } from './files-model.ts';
import { aSession } from './test-support.ts';

// The text of a row that is not an entry. Only a note carries one; a
// pending row is named instead, so a fixture that grows one fails on the
// name rather than on an undefined a compare cannot explain.
const rowText = (r: Row): string => (r.type === 'note' ? r.text : r.type === 'pending' ? `pending:${r.dir}` : r.name);

const list = (names: string[], dirs: string[] = [], truncated = 0) => ({
  entries: names.map((name) => ({ name, kind: dirs.includes(name) ? ('dir' as const) : ('file' as const) })),
  truncated,
});

test('normalizePath: slashes, runs and a trailing separator, but not a drive root or a UNC prefix', () => {
  assert.equal(normalizePath('C:/Users/x/'), 'C:\\Users\\x');
  assert.equal(normalizePath('C:\\Users\\\\x'), 'C:\\Users\\x');
  assert.equal(normalizePath('C:/'), 'C:\\');
  assert.equal(normalizePath('C:\\'), 'C:\\');
  assert.equal(normalizePath('\\\\server\\share\\'), '\\\\server\\share');
  assert.equal(normalizePath('//server/share'), '\\\\server\\share');
  assert.equal(joinPath('C:/x', 'y'), 'C:\\x\\y');
});

test('relativePath is under the root case-insensitively, else the whole path', () => {
  assert.equal(relativePath('C:/repo', 'C:\\repo\\src\\a.ts'), 'src\\a.ts');
  assert.equal(relativePath('c:\\REPO', 'C:\\repo\\src\\a.ts'), 'src\\a.ts');
  assert.equal(relativePath('C:\\repo', 'D:\\other\\a.ts'), 'D:\\other\\a.ts');
  assert.equal(relativePath('C:\\', 'C:\\a.ts'), 'a.ts');
  assert.equal(folderName('C:/Users/x/'), 'x');
  assert.equal(folderName('C:\\'), 'C:');
  assert.equal(parentPath('C:/repo/src/a.ts'), 'C:\\repo\\src');
  assert.equal(parentPath('C:\\a.ts'), 'C:\\');
  assert.equal(parentPath('\\\\server\\share\\a.ts'), '\\\\server\\share');
});

test('pathLabel: a drive root by its path, every other folder by its name', () => {
  assert.equal(pathLabel('C:\\Users'), 'Users');
  assert.equal(pathLabel('C:\\'), 'C:\\');
});

test('walk: nothing without a root, the root alone before its listing arrives', () => {
  assert.deepEqual(walk(emptyModel()), { rows: [], open: [] });
  const m = setRoot(emptyModel(), 'C:/repo/');
  assert.equal(m.root, 'C:\\repo');
  assert.deepEqual(walk(m), { rows: [], open: ['C:\\repo'] });
});

test('walk: rows in listing order with depth, expanded folders visited, collapsed ones not', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['.claude', 'data', 'readme.md'], ['.claude', 'data']));
  m = applyListing(m, 'C:\\repo\\data', list(['deep', 'a.json'], ['deep']));
  m = applyListing(m, 'C:\\repo\\data\\deep', list(['b.json']));
  m = toggleFolder(m, 'C:/repo/data');
  const { rows, open } = walk(m);
  assert.deepEqual(
    rows.map((r) => (r.type === 'entry' ? [r.depth, r.name, r.expanded] : [r.depth, rowText(r)])),
    [
      [0, '.claude', false],
      [0, 'data', true],
      [1, 'deep', false],
      [1, 'a.json', false],
      [0, 'readme.md', false],
    ],
  );
  assert.deepEqual(open, ['C:\\repo', 'C:\\repo\\data']);
  // Opening deep lists its child and adds it to the open set.
  const deeper = walk(toggleFolder(m, 'C:\\repo\\data\\deep'));
  assert.deepEqual(
    deeper.rows.filter((r) => r.depth === 2).map((r) => (r.type === 'entry' ? r.name : rowText(r))),
    ['b.json'],
  );
  assert.deepEqual(deeper.open, ['C:\\repo', 'C:\\repo\\data', 'C:\\repo\\data\\deep']);
  // Toggling data again closes it and deep with it, though deep stays expanded for later.
  const closed = toggleFolder(toggleFolder(m, 'C:\\repo\\data\\deep'), 'C:\\repo\\data');
  assert.deepEqual(walk(closed).open, ['C:\\repo']);
  assert.ok(closed.expanded.has('C:\\repo\\data\\deep'));
  assert.equal(collapseAll(closed).expanded.size, 0);
});

test('revealStep: outside, waiting, missing or shown in the listing case (M9 fix 652)', () => {
  const file = 'C:\\repo\\a\\b\\f.txt';
  let m = setRoot(emptyModel(), 'C:\\repo');
  assert.deepEqual(revealStep(emptyModel(), file), { kind: 'outside' });
  assert.deepEqual(revealStep(m, file), { kind: 'waiting' });
  m = applyListing(m, 'C:\\repo', list(['A', 'x.txt'], ['A']));
  m = applyListing(m, 'C:\\repo\\A', list(['B'], ['B']));
  m = expandFolder(m, 'C:\\repo\\A');
  // a is listed, a\b is not expanded yet.
  assert.deepEqual(revealStep(m, file), { kind: 'waiting', open: 'C:\\repo\\A\\B' });
  m = expandFolder(m, 'C:\\repo\\A\\B');
  assert.deepEqual(revealStep(m, file), { kind: 'waiting' });
  m = applyListing(m, 'C:\\repo\\A\\B', list(['F.txt', 'g.txt']));
  assert.deepEqual(revealStep(m, file), { kind: 'shown', row: 'C:\\repo\\A\\B\\F.txt' });
  assert.deepEqual(revealStep(m, 'C:/repo/a/b/h.txt'), { kind: 'missing' });
  // A folder of the file's name is not the file.
  assert.deepEqual(revealStep(m, 'C:\\repo\\a'), { kind: 'missing' });
  const failed = applyListing(m, 'C:\\repo\\A\\B', { error: 'EPERM' });
  assert.deepEqual(revealStep(failed, file), { kind: 'missing' });
  assert.deepEqual(revealStep(m, 'D:\\elsewhere\\f.txt'), { kind: 'outside' });
  assert.deepEqual(revealStep(m, 'C:\\repo\\x.txt'), { kind: 'shown', row: 'C:\\repo\\x.txt' });
});

test('relistLanded: a newer listing counts, whoever applied it (M9 fix 707)', () => {
  const dir = 'C:\\repo\\a';
  const other = 'C:\\repo\\b';
  const L0 = list(['x']);
  const R = list(['x', 'y']);
  const W = list(['x', 'y']);
  const O = list(['z']);
  const before = new Map([[dir, L0], [other, O]]);
  assert.equal(relistLanded(new Map([[dir, W], [other, O]]), before, [dir]), true);
  assert.equal(relistLanded(new Map([[dir, R], [other, O]]), before, [dir]), true);
  assert.equal(relistLanded(new Map([[dir, L0], [other, O]]), before, [dir]), false);
  assert.equal(relistLanded(new Map([[dir, L0], [other, O]]), before, []), true);
});

test('revealStep: a file named in another case than the disk opens the listing-cased folders one by one (M9 fix 685)', () => {
  const file = 'C:\\repo\\REVEAL652\\DEEP\\z.txt';
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['reveal652'], ['reveal652']));
  const lists: Record<string, ReturnType<typeof list>> = {
    'C:\\repo\\reveal652': list(['deep'], ['deep']),
    'C:\\repo\\reveal652\\deep': list(['z.txt']),
  };
  let first: unknown = null;
  for (let i = 0; i < 10; i++) {
    const step = revealStep(m, file);
    if (i === 0) first = step;
    if (step.kind === 'shown') {
      assert.deepEqual(first, { kind: 'waiting', open: 'C:\\repo\\reveal652' });
      assert.equal(step.row, 'C:\\repo\\reveal652\\deep\\z.txt');
      return;
    }
    assert.equal(step.kind, 'waiting');
    assert.ok(step.kind === 'waiting' && step.open !== undefined, 'a waiting answer names the folder to open');
    const open = step.kind === 'waiting' ? step.open! : '';
    m = expandFolder(m, open);
    const l = lists[open];
    if (l !== undefined) m = applyListing(m, open, l);
  }
  assert.fail('the reveal never reached the row');
});

test('withPending: the name box under the root, under its expanded folder, or nowhere', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['data', 'readme.md'], ['data']));
  m = applyListing(m, 'C:\\repo\\data', list(['a.json']));
  const shape = (rows: ReturnType<typeof walk>['rows']) => rows.map((r) => (r.type === 'entry' ? `${r.depth}:${r.name}` : r.type === 'pending' ? `${r.depth}:+${r.kind}@${r.dir}` : `${r.depth}:${r.text}`));
  const closed = walk(m).rows;
  assert.deepEqual(shape(withPending(closed, m.root, null)), ['0:data', '0:readme.md']);
  assert.deepEqual(shape(withPending(closed, m.root, { dir: 'C:/repo/', kind: 'file' })), ['0:+file@C:\\repo', '0:data', '0:readme.md']);
  // The folder is collapsed, so the box has nowhere to go and the rows stand.
  assert.deepEqual(shape(withPending(closed, m.root, { dir: 'C:\\repo\\data', kind: 'dir' })), ['0:data', '0:readme.md']);
  // expandFolder opens it and leaves an open one open; the box then leads its children.
  const opened = expandFolder(m, 'C:/repo/data');
  assert.equal(expandFolder(opened, 'C:\\repo\\data'), opened);
  assert.deepEqual(shape(withPending(walk(opened).rows, opened.root, { dir: 'C:\\repo\\data', kind: 'dir' })), ['0:data', '1:+dir@C:\\repo\\data', '1:a.json', '0:readme.md']);
  assert.deepEqual(withPending(closed, null, { dir: 'C:\\repo', kind: 'file' }), closed);
});

test('walk: an error stands in for the children, a cap adds a count', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', { entries: [{ name: 'locked', kind: 'dir' }], truncated: 3 });
  m = applyListing(m, 'C:\\repo\\locked', { error: 'Access denied' });
  m = toggleFolder(m, 'C:\\repo\\locked');
  const { rows } = walk(m);
  assert.deepEqual(
    rows.map((r) => (r.type === 'entry' ? r.name : `${r.depth}:${rowText(r)}`)),
    ['locked', '1:Access denied', '0:3 more not shown'],
  );
});

test('moveSelection: Up, Down, Home and End over the entry rows, Right opens and steps in, Left folds or goes to the parent, other keys pass (M9 fix 929)', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['.claude', 'data', 'readme.md'], ['.claude', 'data']));
  m = applyListing(m, 'C:\\repo\\data', list(['deep', 'a.json'], ['deep']));
  m = applyListing(m, 'C:\\repo\\data\\deep', list(['b.json']));
  m = toggleFolder(m, 'C:/repo/data');
  const move = (from: FilesModel, key: string) => moveSelection(from, walk(from).rows, key);
  const at = (p: string) => select(m, p);
  const sel = (r: FilesModel | null) => r?.selected ?? null;
  // No selection: End takes the last row, every other key the first.
  assert.equal(sel(move(m, 'ArrowDown')), 'C:\\repo\\.claude');
  assert.equal(sel(move(m, 'ArrowUp')), 'C:\\repo\\.claude');
  assert.equal(sel(move(m, 'End')), 'C:\\repo\\readme.md');
  // Up and Down step through the open folder's children in screen order.
  assert.equal(sel(move(at('C:\\repo\\data'), 'ArrowDown')), 'C:\\repo\\data\\deep');
  assert.equal(sel(move(at('C:\\repo\\data'), 'ArrowUp')), 'C:\\repo\\.claude');
  // Nowhere to go: the same object back.
  const top = at('C:\\repo\\.claude');
  assert.equal(move(top, 'ArrowUp'), top);
  const bottom = at('C:\\repo\\readme.md');
  assert.equal(move(bottom, 'ArrowDown'), bottom);
  assert.equal(move(bottom, 'End'), bottom);
  assert.equal(sel(move(at('C:\\repo\\data\\a.json'), 'Home')), 'C:\\repo\\.claude');
  // Right opens a closed folder in place, then steps to its first child.
  const opened = move(at('C:\\repo\\data\\deep'), 'ArrowRight')!;
  assert.equal(opened.selected, 'C:\\repo\\data\\deep');
  assert.ok(opened.expanded.has('C:\\repo\\data\\deep'));
  assert.equal(sel(move(opened, 'ArrowRight')), 'C:\\repo\\data\\deep\\b.json');
  assert.equal(sel(move(at('C:\\repo\\data'), 'ArrowRight')), 'C:\\repo\\data\\deep');
  const file = at('C:\\repo\\data\\a.json');
  assert.equal(move(file, 'ArrowRight'), file);
  // Left folds an open folder in place, else goes to the parent.
  const folded = move(at('C:\\repo\\data'), 'ArrowLeft')!;
  assert.equal(folded.selected, 'C:\\repo\\data');
  assert.ok(!folded.expanded.has('C:\\repo\\data'));
  assert.equal(sel(move(at('C:\\repo\\data\\a.json'), 'ArrowLeft')), 'C:\\repo\\data');
  assert.equal(sel(move(at('C:\\repo\\data\\deep'), 'ArrowLeft')), 'C:\\repo\\data');
  assert.equal(move(top, 'ArrowLeft'), top);
  // A selection off screen counts as none.
  assert.equal(sel(move(at('C:\\repo\\data\\deep\\b.json'), 'ArrowDown')), 'C:\\repo\\.claude');
  // A note in place of a folder's children is stepped over.
  const denied = applyListing(at('C:\\repo\\data'), 'C:\\repo\\data', { error: 'Access denied' });
  assert.equal(sel(move(denied, 'ArrowDown')), 'C:\\repo\\readme.md');
  assert.equal(move(denied, 'ArrowRight'), denied);
  // Keys the walk does not take pass.
  for (const key of ['Enter', 'F2', 'a', ' ', 'Delete']) assert.equal(move(m, key), null);
});

test('rowAfterRemoval: the next row past the entry and its open children, else the row above, else none (M9 fix 950)', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['data', 'readme.md'], ['data']));
  m = applyListing(m, 'C:\\repo\\data', list(['a.json', 'b.json']));
  m = toggleFolder(m, 'C:/repo/data');
  const rows = walk(m).rows;
  assert.equal(rowAfterRemoval(rows, 'C:\\repo\\data\\a.json'), 'C:\\repo\\data\\b.json');
  assert.equal(rowAfterRemoval(rows, 'C:\\repo\\data\\b.json'), 'C:\\repo\\readme.md');
  assert.equal(rowAfterRemoval(rows, 'C:\\repo\\data'), 'C:\\repo\\readme.md');
  assert.equal(rowAfterRemoval(rows, 'C:\\repo\\readme.md'), 'C:\\repo\\data\\b.json');
  assert.equal(rowAfterRemoval(rows, 'C:\\repo\\gone.txt'), null);
  const only = applyListing(setRoot(emptyModel(), 'C:\\repo'), 'C:\\repo', list(['only.txt']));
  assert.equal(rowAfterRemoval(walk(only).rows, 'C:\\repo\\only.txt'), null);
});

test('typeAhead: a prefix, case-insensitively, from the selected row on and wrapping; a one-letter buffer starts past the selected row; a miss and an empty buffer give the same object; the children of a closed folder, a note and a name box are skipped (M9 fix 951)', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['data', 'deep', 'Readme.md', 'rows.txt'], ['data', 'deep']));
  m = applyListing(m, 'C:\\repo\\data', list(['red.json', 'a.json']));
  m = applyListing(m, 'C:\\repo\\deep', list(['rare.txt']));
  m = toggleFolder(m, 'C:/repo/data');
  const rows = walk(m).rows;
  const ahead = (from: FilesModel, b: string) => typeAhead(from, rows, b);
  const at = (p: string) => select(m, p);
  const sel = (r: FilesModel) => r.selected;
  assert.equal(sel(ahead(m, 'r')), 'C:\\repo\\data\\red.json');
  assert.equal(sel(ahead(m, 'RE')), 'C:\\repo\\data\\red.json');
  assert.equal(sel(ahead(at('C:\\repo\\data\\red.json'), 'r')), 'C:\\repo\\Readme.md');
  assert.equal(sel(ahead(at('C:\\repo\\Readme.md'), 'r')), 'C:\\repo\\rows.txt');
  assert.equal(sel(ahead(at('C:\\repo\\rows.txt'), 'r')), 'C:\\repo\\data\\red.json');
  const readme = at('C:\\repo\\Readme.md');
  assert.equal(ahead(readme, 're'), readme);
  assert.equal(sel(ahead(at('C:\\repo\\data\\red.json'), 'ro')), 'C:\\repo\\rows.txt');
  const last = at('C:\\repo\\rows.txt');
  assert.equal(ahead(last, 'ra'), last);
  assert.equal(ahead(readme, 'zz'), readme);
  assert.equal(ahead(readme, ''), readme);
  const boxed = withPending(rows, 'C:\\repo', { dir: 'C:\\repo', kind: 'file' });
  assert.equal(sel(typeAhead(m, boxed, 'd')), 'C:\\repo\\data');
  const denied = applyListing(at('C:\\repo\\data'), 'C:\\repo\\data', { error: 'Access denied' });
  assert.equal(sel(typeAhead(denied, walk(denied).rows, 'r')), 'C:\\repo\\Readme.md');
});

test('setRoot keeps the listings and the expanded set, drops the selection', () => {
  let m = setRoot(emptyModel(), 'C:\\repo');
  m = applyListing(m, 'C:\\repo', list(['src'], ['src']));
  m = applyListing(m, 'C:\\repo\\src', list(['a.ts']));
  m = toggleFolder(m, 'C:\\repo\\src');
  m = select(m, 'C:\\repo\\src\\a.ts');
  const moved = setRoot(m, 'C:\\repo\\src');
  assert.equal(moved.selected, null);
  assert.deepEqual(walk(moved).rows.map((r) => (r.type === 'entry' ? r.name : rowText(r))), ['a.ts']);
  const back = setRoot(moved, 'C:/repo/');
  assert.deepEqual(walk(back).rows.map((r) => (r.type === 'entry' ? `${r.depth}${r.name}` : rowText(r))), ['0src', '1a.ts']);
  // The same root is the same model.
  assert.equal(setRoot(back, 'C:\\repo'), back);
  assert.equal(setRoot(back, null).root, null);
});

// The touched index (M9 fix 198) needs a session fixture the tree tests do not.
function session(id: string, color: string, touched: SessionTouched[]): SessionInfo {
  return aSession({ id, name: id, color, touched });
}

test('touchedIndex: two sessions on one path, newest first, looked up by either spelling; a folder gathers the sessions under it', () => {
  const a = session('a', '#111111', [
    { path: 'C:/repo/src/a.ts', at: 100, agentId: null },
    { path: 'C:/repo/src/deep/b.ts', at: 300, agentId: 'ag1' },
  ]);
  const b = session('b', '#222222', [{ path: 'C:\\repo\\src\\A.ts', at: 200, agentId: null }]);
  const none = session('c', '#333333', []);
  const index = touchedIndex([a, b, none]);
  assert.deepEqual(
    touchedAt(index, 'C:\\repo\\src\\a.ts').map((t) => [t.sessionId, t.at, t.color]),
    [
      ['b', 200, '#222222'],
      ['a', 100, '#111111'],
    ],
    'the later write first, the two spellings one key',
  );
  assert.deepEqual(touchedAt(index, 'C:/repo/src/deep/b.ts')[0]!.agentId, 'ag1', 'the member is kept');
  assert.deepEqual(touchedAt(index, 'C:/repo/other.ts'), [], 'an untouched file');
  // A folder: one entry per session, its latest write under the folder.
  assert.deepEqual(
    touchedUnder(index, 'C:/repo/src').map((t) => [t.sessionId, t.at]),
    [
      ['a', 300],
      ['b', 200],
    ],
  );
  assert.deepEqual(touchedUnder(index, 'C:/repo/srcx'), [], 'a sibling with a longer name is not under src');
  assert.deepEqual(touchedUnder(index, 'C:/repo/docs'), []);
  // A record from before the field reads as no writes. The key is taken
  // off rather than set to undefined, which is what an older record is
  // and what the optional field's own type allows.
  const older: SessionInfo = { ...none };
  delete older.touched;
  assert.equal(touchedIndex([older]).size, 0);
});

function fileTab(id: string, paneId: string, path: string): LayoutTab {
  return { id, name: id, focusedPaneId: paneId, root: { kind: 'pane', id: paneId, sessionId: null, view: { kind: 'file', path } } };
}

test('filePaneFolders: the parent of every file view across every tab, deduplicated, a session pane and another view kind left out (M9 fix 337)', () => {
  const layout: Layout = {
    revision: 1,
    currentTabId: 't1',
    tabs: [
      {
        id: 't1',
        name: 't1',
        focusedPaneId: 'p1',
        root: {
          kind: 'split',
          id: 's1',
          direction: 'row',
          ratio: 0.5,
          // A file pane with no tab of its own (M9 fix 180): the plain
          // shell beside it carries no folder for the watch.
          first: { kind: 'pane', id: 'p1', sessionId: null, view: { kind: 'file', path: 'C:/repo/src/a.ts' } },
          second: { kind: 'pane', id: 'p2', sessionId: 'sess1', view: null },
        },
      },
      // A second file under the same folder as the first: one entry, not two.
      fileTab('t2', 'p3', 'C:/repo/src/b.ts'),
      // A different folder, and a non-file view, which contributes nothing.
      fileTab('t3', 'p4', 'C:/other/c.ts'),
      { id: 't4', name: 't4', focusedPaneId: 'p5', root: { kind: 'pane', id: 'p5', sessionId: null, view: { kind: 'commits', folder: 'C:/repo' } } },
    ],
  };
  assert.deepEqual(filePaneFolders(layout), ['C:\\repo\\src', 'C:\\other']);
});

test("browserPaneFolders: a page from the disk gives its file's folder and its root, across tabs, deduplicated; a web page and a page with no root give none (M9 fix 898)", () => {
  const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
  const browserTab = (tabId: string, paneId: string, view: unknown): LayoutTab => ({ id: tabId, name: tabId, focusedPaneId: paneId, root: { kind: 'pane', id: paneId, sessionId: null, view } }) as LayoutTab;
  const layout: Layout = {
    revision: 1,
    currentTabId: 't1',
    tabs: [
      browserTab('t1', 'p1', { kind: 'browser', url: `emerald-file://${id}/site/page.html`, root: 'C:/work' }),
      // A second page of the same folder: no new folders.
      browserTab('t2', 'p2', { kind: 'browser', url: `emerald-file://${id}/site/two.html`, root: 'C:\\work' }),
      // A page at the root itself: the root once.
      browserTab('t3', 'p3', { kind: 'browser', url: `emerald-file://${id}/index.html`, root: 'C:\\work' }),
      browserTab('t4', 'p4', { kind: 'browser', url: 'http://localhost:3000/' }),
      browserTab('t5', 'p5', { kind: 'browser', url: `emerald-file://${id}/x.html` }),
    ],
  };
  assert.deepEqual(browserPaneFolders(layout), ['C:\\work\\site', 'C:\\work']);
  assert.deepEqual(localPageFolders({ kind: 'browser', url: `emerald-file://${id}/a/b/c.html`, root: 'D:\\pages' }), ['D:\\pages\\a\\b', 'D:\\pages']);
});

test('chatPaneFolders: the transcript folder of every pane on the chat face, a pane shown another session left out (M9 fix 689)', () => {
  const layout: Layout = {
    revision: 1,
    currentTabId: 't1',
    tabs: [
      {
        id: 't1',
        name: 't1',
        focusedPaneId: 'p1',
        root: {
          kind: 'split',
          id: 's1',
          direction: 'row',
          ratio: 0.5,
          first: { kind: 'pane', id: 'p1', sessionId: 'a', view: null },
          second: { kind: 'pane', id: 'p2', sessionId: 'b', view: null },
        },
      },
      { id: 't2', name: 't2', focusedPaneId: 'p3', root: { kind: 'pane', id: 'p3', sessionId: 'c', view: null } },
      { id: 't3', name: 't3', focusedPaneId: 'p4', root: { kind: 'pane', id: 'p4', sessionId: 'd', view: null } },
    ],
  };
  const sessions = new Map([
    ['a', { transcriptPath: 'C:/Users/me/.claude/projects/x/a.jsonl' }],
    ['b', { transcriptPath: 'C:/Users/me/.claude/projects/x/b.jsonl' }],
    ['c', { transcriptPath: 'C:/Users/me/.claude/projects/y/c.jsonl' }],
    ['d', { transcriptPath: null }],
  ]);
  // p2 was turned to chat on another session; p4 has no transcript yet.
  const chatPanes = new Map([
    ['p1', 'a'],
    ['p2', 'z'],
    ['p3', 'c'],
    ['p4', 'd'],
  ]);
  assert.deepEqual(chatPaneFolders(layout, chatPanes, sessions), ['C:\\Users\\me\\.claude\\projects\\x', 'C:\\Users\\me\\.claude\\projects\\y']);
  assert.deepEqual(chatPaneFolders(layout, new Map(), sessions), []);
});

test('watchOrder puts the root, then the tab folders, then the open folders newest first', () => {
  const expanded = new Set(['R\\a', 'R\\b', 'R\\c']);
  const order = watchOrder(['R', 'R\\a', 'R\\c', 'R\\b'], expanded, ['T1', 'R\\a']);
  assert.deepEqual(order, ['R', 'T1', 'R\\a', 'R\\c', 'R\\b']);
  // The main process keeps the front, so a cap keeps the root.
  assert.deepEqual(order.slice(0, 3), ['R', 'T1', 'R\\a']);
});

test('liftKeep answers the chain entry whose parent is the folder listed', () => {
  const chain = ['P\\M\\F', 'P\\M'];
  assert.equal(liftKeep(chain, 'P\\M'), 'P\\M\\F');
  assert.equal(liftKeep(chain, 'P'), 'P\\M');
  assert.equal(liftKeep(chain, 'Q'), undefined);
});

// M9 fix 574: the rail's rename.
test('renamedPath moves the path itself and anything under it, case-insensitively, and nothing else', () => {
  assert.equal(renamedPath('C:\\r\\A', 'C:\\r\\a', 'C:\\r\\b'), 'C:\\r\\b');
  assert.equal(renamedPath('C:\\r\\a\\x\\Y.txt', 'C:\\r\\a', 'C:\\r\\b'), 'C:\\r\\b\\x\\Y.txt');
  assert.equal(renamedPath('C:\\r\\ab', 'C:\\r\\a', 'C:\\r\\b'), null);
});

test('renameInModel moves the expanded folders, the listings and the selection under a renamed folder and renames the entry in its parent\'s listing', () => {
  let m = setRoot(emptyModel(), 'C:\\r');
  m = applyListing(m, 'C:\\r', { entries: [{ name: 'a', kind: 'dir' }, { name: 'z.txt', kind: 'file' }], truncated: 0 });
  m = applyListing(m, 'C:\\r\\a', { entries: [{ name: 'x', kind: 'dir' }], truncated: 0 });
  m = applyListing(m, 'C:\\r\\a\\x', { entries: [{ name: 'f.txt', kind: 'file' }], truncated: 0 });
  m = expandFolder(expandFolder(m, 'C:\\r\\a'), 'C:\\r\\a\\x');
  m = select(m, 'C:\\r\\a\\x\\f.txt');
  const next = renameInModel(m, 'C:\\r\\a', 'C:\\r\\b');
  assert.deepEqual([...next.expanded].sort(), ['C:\\r\\b', 'C:\\r\\b\\x']);
  assert.equal(next.selected, 'C:\\r\\b\\x\\f.txt');
  const rows = walk(next).rows.filter((r) => r.type === 'entry');
  assert.deepEqual(
    rows.map((r) => (r.type === 'entry' ? [r.path, r.expanded] : null)),
    [
      ['C:\\r\\b', true],
      ['C:\\r\\b\\x', true],
      ['C:\\r\\b\\x\\f.txt', false],
      ['C:\\r\\z.txt', false],
    ],
  );
  const own = next.listings.get('C:\\r');
  assert.ok(own !== undefined && !('error' in own));
  assert.deepEqual(own.entries[0], { name: 'b', kind: 'dir' });
});

test('stemEnd stops before a file\'s last dot and takes a folder\'s whole name', () => {
  assert.equal(stemEnd('notes.txt', 'file'), 5);
  assert.equal(stemEnd('a.tar.gz', 'file'), 5);
  assert.equal(stemEnd('.gitignore', 'file'), 10);
  assert.equal(stemEnd('Makefile', 'file'), 8);
  assert.equal(stemEnd('v1.2', 'dir'), 4);
});

test('sessionInFolder counts a live session\'s cwd or spawn folder at or under the folder, not an exited one', () => {
  const shell = aSession({ id: 'a', state: 'working', cwd: 'C:\\r\\a\\x', spawnCwd: 'C:\\elsewhere' });
  const claude = aSession({ id: 'b', kind: 'claude', state: 'working', spawnCwd: 'C:\\R\\A', cwd: 'C:\\elsewhere' });
  const exited = aSession({ id: 'c', state: 'exited', cwd: 'C:\\r\\a', spawnCwd: 'C:\\r\\a' });
  const beside = aSession({ id: 'd', state: 'working', cwd: 'C:\\r\\ab', spawnCwd: 'C:\\r\\ab' });
  assert.equal(sessionInFolder('C:\\r\\a', [shell]), true);
  assert.equal(sessionInFolder('C:\\r\\a', [claude]), true);
  assert.equal(sessionInFolder('C:\\r\\a', [exited, beside]), false);
});

test('refusalWords names each refusal, the generic one by what was asked', () => {
  assert.equal(refusalWords('exists', true), 'A file or folder of that name is already there');
  assert.equal(refusalWords('name', false), 'A name, not a path: no slashes');
  assert.equal(refusalWords('in-use', true), 'In use by a session');
  assert.equal(refusalWords('refused', true), 'Could not be renamed here');
  assert.equal(refusalWords('refused', false), 'Could not be made here');
});

test('rootIsEmpty is true only for a landed, error-free listing of the root with no entries', () => {
  assert.equal(rootIsEmpty(emptyModel()), false);
  const m = setRoot(emptyModel(), 'C:/empty');
  assert.equal(rootIsEmpty(m), false);
  assert.equal(rootIsEmpty(applyListing(m, 'C:/empty', { error: 'denied' })), false);
  assert.equal(rootIsEmpty(applyListing(m, 'C:/empty', list(['a.txt']))), false);
  assert.equal(rootIsEmpty(applyListing(m, 'C:/empty', list([]))), true);
});

test("canEditFrom is true for a tree row, a names hit and a Changed row and false for a contents hit, a deleted file's Changed row and the root", () => {
  assert.equal(canEditFrom('row'), true);
  assert.equal(canEditFrom('hit'), true);
  assert.equal(canEditFrom('changed'), true);
  assert.equal(canEditFrom('line'), false);
  assert.equal(canEditFrom('gone'), false);
  assert.equal(canEditFrom('root'), false);
});
