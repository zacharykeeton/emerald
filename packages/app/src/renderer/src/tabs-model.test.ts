import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRTY_MARK, PANES, WHATS_NEW_PATH, activate, activityWindow, activityPath, closeAll, commitsFolder, commitsPath, closeFile, closeOthers, defaultView, deletedFilePanes, dirtyMark, emptyTabs, isDocument, isAnimatedKind, isFileTab, isImage, isJson, isMarkdown, isMermaidFile, isPreview, isTranscript, isWhatsNew, openFile, pinTab, quickSuggestionsFor, renameFilePanes, renameTabs, setTabQuery, setView, tabName, tabQuery, tabsFromJson, viewFor } from './tabs-model.ts';
import { fileViewAt, rawAtLine, statsFolder, statsPath } from './tabs-model.ts';
import type { Layout, LayoutNode } from '@emerald/shared';

const a = 'C:\\repo\\a.ts';
const b = 'C:\\repo\\b.ts';
const c = 'C:\\repo\\c.ts';
const md = 'C:\\repo\\README.md';

test('openFile adds a path once, normalized, and makes it active', () => {
  let m = openFile(emptyTabs(), 'C:/repo/a.ts');
  assert.deepEqual(m, { files: [a], active: a, raw: [], query: {}, preview: null });
  m = openFile(m, b);
  m = openFile(m, a);
  assert.deepEqual(m.files, [a, b]);
  assert.equal(m.active, a);
  assert.equal(isFileTab(m), true);
  assert.equal(isFileTab(emptyTabs()), false);
});

test('closeFile on the active tab goes right, then left, then the panes', () => {
  let m = openFile(openFile(openFile(emptyTabs(), a), b), c);
  m = activate(m, b);
  m = closeFile(m, b);
  assert.deepEqual(m, { files: [a, c], active: c, raw: [], query: {}, preview: null });
  m = closeFile(m, c);
  assert.deepEqual(m, { files: [a], active: a, raw: [], query: {}, preview: null });
  m = closeFile(m, a);
  assert.deepEqual(m, { files: [], active: PANES, raw: [], query: {}, preview: null });
});

test('closeFile on another tab leaves the active one, and an unknown path is a no-op', () => {
  let m = openFile(openFile(emptyTabs(), a), b);
  m = closeFile(m, a);
  assert.deepEqual(m, { files: [b], active: b, raw: [], query: {}, preview: null });
  assert.equal(closeFile(m, c), m);
  const onPanes = activate(m, PANES);
  assert.deepEqual(closeFile(onPanes, b), { files: [], active: PANES, raw: [], query: {}, preview: null });
});

test('closeOthers keeps the one path; closeAll goes back to the panes', () => {
  const m = openFile(openFile(openFile(emptyTabs(), a), b), c);
  assert.deepEqual(closeOthers(m, a), { files: [a], active: a, raw: [], query: {}, preview: null });
  assert.deepEqual(closeAll(m), { files: [], active: PANES, raw: [], query: {}, preview: null });
});

test('activate falls back to the panes for a path that is not open', () => {
  const m = openFile(emptyTabs(), a);
  assert.equal(activate(m, b).active, PANES);
  assert.equal(activate(m, 'C:/repo/a.ts').active, a);
  assert.equal(activate(m, a), m);
});

test('tabsFromJson takes only what it can use', () => {
  assert.deepEqual(tabsFromJson(null), emptyTabs());
  assert.deepEqual(tabsFromJson({ files: 'x' }), emptyTabs());
  assert.deepEqual(tabsFromJson({ files: [a, 3, '', 'C:/repo/a.ts', b], active: b }), { files: [a, b], active: b, raw: [], query: {}, preview: null });
  assert.deepEqual(tabsFromJson({ files: [a], active: c }), { files: [a], active: PANES, raw: [], query: {}, preview: null });
  assert.equal(tabName('C:/repo/src/index.ts'), 'index.ts');
});

test('a markdown tab is rendered unless switched to raw; other files are always raw', () => {
  let m = openFile(openFile(emptyTabs(), a), md);
  assert.equal(isMarkdown(md) && isMarkdown('C:/x/notes.MARKDOWN') && !isMarkdown(a), true);
  assert.equal(viewFor(m, md), 'rendered');
  assert.equal(viewFor(m, a), 'raw');
  m = setView(m, 'C:/repo/README.md', 'raw');
  assert.deepEqual(m.raw, [md]);
  assert.equal(viewFor(m, md), 'raw');
  assert.equal(setView(m, md, 'raw'), m);
  assert.equal(setView(m, a, 'rendered'), m);
  assert.equal(setView(m, c, 'raw'), m);
  m = setView(m, md, 'rendered');
  assert.deepEqual(m.raw, []);
});

test('a GIF or a WEBP is an animated kind and gets the Pause button; a PNG, an ICO, an SVG and a GIF on a network path do not (M9 fix 638)', () => {
  for (const p of ['C:/x/a.gif', 'C:/x/b.WEBP']) assert.equal(isAnimatedKind(p), true, p);
  for (const p of ['C:/x/a.png', 'C:/x/c.ico', 'C:/x/logo.svg', '\\\\host\\share\\a.gif']) assert.equal(isAnimatedKind(p), false, p);
});

test('a mermaid file starts rendered and a markdown file is not one (fix 658)', () => {
  assert.equal(defaultView('C:/x/flow.mmd'), 'rendered');
  assert.equal(defaultView('C:/x/flow.MERMAID'), 'rendered');
  assert.equal(isMermaidFile('C:/x/flow.md'), false);
  assert.equal(isMermaidFile('C:/x/flow.mmd'), true);
});

test('fileViewAt: markdown keeps Rendered at a line (M9 fix 892), another file with a view of its own opens Raw, the bare view otherwise (M9 fix 864)', () => {
  assert.deepEqual(fileViewAt('C:\\r\\a.ts', 3), { kind: 'file', path: 'C:\\r\\a.ts' });
  assert.deepEqual(fileViewAt('C:\\r\\README.md', 3), { kind: 'file', path: 'C:\\r\\README.md' });
  for (const name of ['logo.svg', 'flow.mmd', 'a.json']) {
    assert.deepEqual(fileViewAt('C:\\r\\' + name, 3), { kind: 'file', path: 'C:\\r\\' + name, view: 'raw' });
    assert.equal(rawAtLine('C:\\r\\' + name), true);
  }
  assert.equal(rawAtLine('C:\\r\\README.md'), false);
  assert.equal(rawAtLine('C:\\r\\a.ts'), false);
  assert.deepEqual(fileViewAt('C:\\r\\README.md', undefined), { kind: 'file', path: 'C:\\r\\README.md' });
});

test('an image is an image by its extension and never on a network path; an SVG starts rendered, a raster has no view (fix 615)', () => {
  for (const p of ['C:/x/a.PNG', 'C:/x/b.jpeg', 'C:/x/c.ico', 'C:/x/logo.svg']) assert.equal(isImage(p), true, p);
  for (const p of ['C:/x/blob.bin', 'C:/x/a.png.txt', '\\\\host\\share\\a.png']) assert.equal(isImage(p), false, p);
  assert.equal(defaultView('C:/x/logo.svg'), 'rendered');
  assert.equal(defaultView('C:/x/a.png'), null);
  assert.equal(defaultView('\\\\host\\share\\logo.svg'), null);
  const svg = 'C:/x/logo.svg';
  let m = openFile(emptyTabs(), svg);
  assert.equal(viewFor(m, svg), 'rendered');
  m = setView(m, svg, 'raw');
  assert.equal(viewFor(m, svg), 'raw');
});

test('closing a raw markdown tab forgets the choice, so a re-open starts rendered', () => {
  let m = setView(openFile(openFile(emptyTabs(), a), md), md, 'raw');
  assert.deepEqual(closeOthers(m, a).raw, []);
  assert.deepEqual(closeOthers(m, md).raw, [md]);
  assert.deepEqual(closeAll(m).raw, []);
  m = closeFile(m, md);
  assert.deepEqual(m, { files: [a], active: a, raw: [], query: {}, preview: null });
  assert.equal(viewFor(openFile(m, md), md), 'rendered');
});

test('tabsFromJson keeps raw only for open markdown tabs, and a file without it renders', () => {
  assert.deepEqual(tabsFromJson({ files: [a, md], active: md }), { files: [a, md], active: md, raw: [], query: {}, preview: null });
  assert.deepEqual(tabsFromJson({ files: [a, md], active: md, raw: [a, 'C:/repo/README.md', c, 4] }), { files: [a, md], active: md, raw: [md], query: {}, preview: null });
});

test('a transcript tab starts on its turns and switches to raw the way markdown does; other views are no change', () => {
  const t = 'C:\\Users\\me\\.claude\\projects\\C--repo\\a1a1a1a1-0000-4000-8000-000000000001.jsonl';
  assert.equal(isTranscript(t), true);
  assert.equal(isTranscript('C:/tmp/emerald-verify/m19-claude-1/projects/C--ws-repo/b1b1b1b1-0000-4000-8000-000000000003.jsonl'), true);
  assert.equal(isTranscript('C:/repo/data/rows.jsonl'), false);
  assert.equal(isTranscript('C:/Users/me/.claude/projects/C--repo/a1a1a1a1-0000-4000-8000-000000000001/agent-1.jsonl'), false);
  let m = openFile(emptyTabs(), t);
  assert.equal(viewFor(m, t), 'turns');
  assert.equal(setView(m, t, 'rendered'), m);
  m = setView(m, t, 'raw');
  assert.equal(viewFor(m, t), 'raw');
  m = setView(m, t, 'turns');
  assert.equal(viewFor(m, t), 'turns');
  // A saved raw choice on a transcript comes back, as markdown's does.
  assert.deepEqual(tabsFromJson({ files: [t], active: t, raw: [t] }).raw, [t]);
});

// M9 fix 339: a .json file starts on its Pretty view, the way markdown
// starts rendered; a .jsonl is the editor alone.
test('a JSON tab starts pretty and switches to raw the way markdown does; a .jsonl has no view', () => {
  const j = 'C:/repo/package.json';
  const lines = 'C:/repo/data/rows.jsonl';
  assert.equal(isJson(j), true);
  assert.equal(isJson('C:/repo/settings.JSON'), true);
  assert.equal(isJson(lines), false);
  let m = openFile(openFile(emptyTabs(), j), lines);
  assert.equal(viewFor(m, j), 'pretty');
  assert.equal(viewFor(m, lines), 'raw');
  assert.equal(setView(m, j, 'rendered'), m);
  assert.equal(setView(m, j, 'turns'), m);
  assert.equal(setView(m, lines, 'pretty'), m);
  m = setView(m, j, 'raw');
  assert.equal(viewFor(m, j), 'raw');
  m = setView(m, j, 'pretty');
  assert.equal(viewFor(m, j), 'pretty');
});

test('an activity document is a tab under its own URL, never normalized into a path (M54)', () => {
  const doc = activityPath('2026-09-13');
  assert.equal(doc, 'emerald://activity/2026-09-13');
  assert.equal(isDocument(doc) && !isDocument(a), true);
  assert.equal(activityWindow(doc), '2026-09-13');
  assert.equal(activityWindow(a), null);
  assert.equal(activityWindow('emerald://activity/today'), null);
  // An hour and a minute window (M67) name the tab with the clock.
  assert.equal(activityWindow(activityPath('2026-09-13T14')), '2026-09-13T14');
  assert.equal(activityWindow(activityPath('2026-09-13T14:07')), '2026-09-13T14:07');
  assert.equal(activityWindow('emerald://activity/2026-09-13T14:07:00'), null);
  // The second occurrence of a repeated hour or minute (M9 fix 518).
  assert.equal(activityWindow(activityPath('2026-11-01T01b')), '2026-11-01T01b');
  assert.equal(activityWindow(activityPath('2026-11-01T01:30b')), '2026-11-01T01:30b');
  assert.equal(activityWindow(activityPath('2026-11-01T01:40bf')), '2026-11-01T01:40bf');
  assert.equal(tabName(activityPath('2026-11-01T01b')), 'Activity 2026-11-01 01:00 (repeated)');
  assert.equal(tabName(activityPath('2026-11-01T01:30b')), 'Activity 2026-11-01 01:30 (repeated)');
  assert.equal(tabName(activityPath('2026-09-13T14')), 'Activity 2026-09-13 14:00');
  assert.equal(tabName(activityPath('2026-09-13T14:07')), 'Activity 2026-09-13 14:07');
  // M9 fix 321: the five-hour usage window's key, its start minute with an f.
  assert.equal(activityWindow(activityPath('2026-09-19T13:40f')), '2026-09-19T13:40f');
  assert.equal(activityWindow('emerald://activity/2026-09-19T13f'), null);
  assert.equal(tabName(activityPath('2026-09-19T13:40f')), 'Activity 5h from 2026-09-19 13:40');
  // A week (M9 fix 230) is keyed by its Monday with a `w` after it.
  assert.equal(activityWindow(activityPath('2026-09-14w')), '2026-09-14w');
  assert.equal(activityWindow('emerald://activity/2026-09-14ww'), null);
  assert.equal(tabName(activityPath('2026-09-14w')), 'Activity week of 2026-09-14');
  let m = openFile(openFile(emptyTabs(), a), doc);
  assert.deepEqual(m.files, [a, doc]);
  assert.equal(m.active, doc);
  assert.equal(tabName(doc), 'Activity 2026-09-13');
  assert.equal(viewFor(m, doc), 'raw');
  m = closeFile(m, doc);
  assert.deepEqual(m.files, [a]);
  assert.deepEqual(tabsFromJson({ files: [doc, a], active: doc }), { files: [doc, a], active: doc, raw: [], query: {}, preview: null });
});

test('tabName: a transcript tab is the session id until the conversation names it (M9 fix 96)', () => {
  const t = 'C:/Users/z/.claude/projects/C--repo/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b.jsonl';
  assert.equal(tabName(t), '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
  assert.equal(tabName(t, new Map()), '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b');
  assert.equal(tabName(t, new Map([[t, 'Fix the tabs']])), 'Fix the tabs');
  // A title only ever names its own tab.
  assert.equal(tabName('C:/repo/src/index.ts', new Map([[t, 'Fix the tabs']])), 'index.ts');
});

test('a commits document names its folder in the URL, encoded, and the tab by its last segment (M61)', () => {
  const doc = commitsPath('C:/Users/z/code/emerald');
  assert.equal(doc, 'emerald://commits/C%3A%5CUsers%5Cz%5Ccode%5Cemerald', 'the folder normalized then encoded');
  assert.equal(isDocument(doc), true);
  assert.equal(commitsFolder(doc), 'C:\\Users\\z\\code\\emerald');
  assert.equal(commitsFolder(activityPath('2026-09-13')), null);
  assert.equal(commitsFolder(a), null);
  assert.equal(tabName(doc), 'Commits · emerald');
  const m = openFile(openFile(emptyTabs(), doc), commitsPath('C:\\Users\\z\\code\\emerald\\'));
  assert.deepEqual(m.files, [doc], 'the same folder either way is one tab');
});

test('a statistics document names its folder as the commits one does, and neither kind reads the other (M9 fix 837)', () => {
  const doc = statsPath('C:/Users/z/code/emerald');
  assert.equal(doc, 'emerald://stats/C%3A%5CUsers%5Cz%5Ccode%5Cemerald');
  assert.equal(isDocument(doc), true);
  assert.equal(statsFolder(doc), 'C:\\Users\\z\\code\\emerald');
  assert.equal(statsFolder(commitsPath('C:/Users/z/code/emerald')), null);
  assert.equal(statsFolder(a), null);
  assert.equal(commitsFolder(doc), null);
  assert.equal(tabName(doc), 'Statistics · emerald');
});

test("a document's query is its state, kept under its key: an open with one sets it, one without keeps it, a close drops it and the JSON carries it (M9 fix 178)", () => {
  const key = 'emerald://activity/2026-09-15';
  let m = openFile(emptyTabs(), activityPath('2026-09-15', 'scope=folder&layers=band'));
  assert.deepEqual(m, { files: [key], active: key, raw: [], query: { [key]: 'scope=folder&layers=band' }, preview: null });
  assert.equal(activityWindow(`${key}?scope=folder`), '2026-09-15', 'the window reads through the query');
  assert.equal(tabQuery(m, key), 'scope=folder&layers=band');
  assert.equal(tabQuery(m, `${key}?x=1`), 'scope=folder&layers=band', 'read by the key, whatever query the path carries');
  m = openFile(m, key);
  assert.deepEqual(m.files, [key], 'one tab');
  assert.equal(tabQuery(m, key), 'scope=folder&layers=band', 'an open without a query leaves the state');
  m = openFile(m, activityPath('2026-09-15', 'layers=lanes'));
  assert.deepEqual(m.files, [key], 'still one tab');
  assert.equal(tabQuery(m, key), 'layers=lanes', 'an open with a query is a new snapshot');
  m = setTabQuery(m, key, 'scope=folder');
  assert.equal(tabQuery(m, key), 'scope=folder');
  assert.equal(setTabQuery(m, key, 'scope=folder'), m, 'the same query is no change');
  const cleared = setTabQuery(m, key, '');
  assert.deepEqual(cleared.query, {}, 'an empty query drops the entry');
  assert.equal(setTabQuery(m, 'emerald://activity/2026-09-14', 'x'), m, 'a document that is not open takes no state');
  const json = JSON.parse(JSON.stringify(m)) as unknown;
  assert.deepEqual(tabsFromJson(json), m, 'the query rides the JSON');
  assert.deepEqual(tabsFromJson({ files: [key, a], active: key, query: { [key]: 'layers=band', [a]: 'no', other: 'gone', [`${key}x`]: 7 } }).query, { [key]: 'layers=band' }, 'only open documents keep a query');
  assert.deepEqual(closeFile(m, key).query, {}, 'a close drops the state');
  const two = openFile(m, commitsPath('C:\\repo', 'mode=list'));
  assert.equal(commitsFolder(`${commitsPath('C:\\repo')}?mode=list`), 'C:\\repo', 'the folder reads through the query');
  assert.deepEqual(closeOthers(two, commitsPath('C:\\repo')).query, { [commitsPath('C:\\repo')]: 'mode=list' });
  assert.deepEqual(closeAll(two).query, {});
});

test('a preview open reuses the one preview tab, a pin keeps it, and a pinned file re-clicked stays pinned (M9 fix 203)', () => {
  const d = 'C:\\repo\\d.ts';
  let m = openFile(openFile(openFile(emptyTabs(), a, { preview: true }), b, { preview: true }), c, { preview: true });
  assert.deepEqual(m.files, [c], 'three previews leave one tab whose path is the last');
  assert.equal(m.active, c);
  assert.equal(isPreview(m, c), true);
  m = pinTab(m, c);
  assert.equal(m.preview, null, 'a pin clears the preview');
  assert.equal(isPreview(m, c), false);
  m = openFile(m, a, { preview: true });
  assert.deepEqual(m.files, [c, a], 'a new preview opens beside the pinned tab');
  assert.equal(m.preview, a);
  m = openFile(m, c, { preview: true });
  assert.equal(m.active, c, 'a pinned file re-clicked is activated');
  assert.deepEqual(m.files, [c, a], 'and stays pinned, the preview tab untouched');
  assert.equal(m.preview, a);
  m = openFile(m, a, { preview: true });
  assert.equal(m.preview, a, 'the preview re-clicked stays the preview');
  // The replacement lands at the preview's index, so the strip does not jump.
  m = openFile(openFile(m, d), b, { preview: true });
  assert.deepEqual(m.files, [c, b, d], "the preview takes the old preview's place, a pinned open goes to the end");
  assert.equal(m.preview, b);
  // A pinned open of a new path leaves the preview alone; a pinned open of the preview's path is just an activation.
  m = openFile(m, b);
  assert.equal(m.preview, b, "a plain open of the preview path activates it, the pin is pinTab's");
  assert.equal(pinTab(m, a), m, 'pinning a path that is not the preview is no change');
  assert.equal(closeFile(m, b).preview, null, 'closing the preview forgets it');
  assert.equal(closeFile(m, c).preview, b, 'closing another tab keeps it');
  assert.equal(closeOthers(m, b).preview, b);
  assert.equal(closeOthers(m, c).preview, null);
  const json = JSON.parse(JSON.stringify(m)) as unknown;
  assert.deepEqual(tabsFromJson(json), m, 'the preview rides the JSON');
  assert.equal(tabsFromJson({ files: [a], active: a }).preview, null, 'a file from before the field reads as pinned');
  assert.equal(tabsFromJson({ files: [a], active: a, preview: b }).preview, null, 'a preview that is not open is dropped');
  // A markdown preview switched to raw forgets the choice when the next preview replaces it.
  let md1 = setView(openFile(emptyTabs(), md, { preview: true }), md, 'raw');
  md1 = openFile(md1, a, { preview: true });
  assert.deepEqual(md1.raw, [], "the replaced preview's raw switch goes with it");
});

test("the What's new document (M9 fix 227) is one tab under its key, named for a person", () => {
  assert.equal(WHATS_NEW_PATH, 'emerald://whats-new');
  assert.equal(isDocument(WHATS_NEW_PATH), true);
  assert.equal(isWhatsNew(WHATS_NEW_PATH), true);
  assert.equal(isWhatsNew(`${WHATS_NEW_PATH}?x=1`), true);
  assert.equal(isWhatsNew(activityPath('2026-09-13')), false);
  assert.equal(isWhatsNew('C:/repo/whats-new'), false);
  assert.equal(tabName(WHATS_NEW_PATH), "What's new");
  let m = openFile(emptyTabs(), WHATS_NEW_PATH);
  m = openFile(m, WHATS_NEW_PATH);
  assert.deepEqual(m.files, [WHATS_NEW_PATH]);
  assert.equal(m.active, WHATS_NEW_PATH);
  assert.equal(closeFile(m, WHATS_NEW_PATH).active, PANES);
});

// M9 fix 248: the dirty mark on a tab whose file has unsaved edits.
test('dirtyMark marks a tab by its key, whichever way the path was spelt, and never a document', () => {
  const dirty = new Set([a]);
  assert.equal(dirtyMark(a, dirty), DIRTY_MARK);
  assert.equal(dirtyMark('C:/repo/a.ts', dirty), DIRTY_MARK);
  assert.equal(dirtyMark(b, dirty), null);
  assert.equal(dirtyMark(a, new Set()), null);
  assert.equal(dirtyMark(activityPath('2026-09-16'), new Set([activityPath('2026-09-16')])), null);
});

// M9 fix 574: the rail's rename moves the tabs in place.
test('renameTabs moves the files, the active tab, the raw views and the preview under a renamed path and leaves the documents', () => {
  const doc = 'emerald://activity/2026-10-01';
  const inDir = 'C:\\repo\\d\\x.md';
  const m = { files: [a, inDir, doc, b], active: inDir, raw: [inDir], query: { [doc]: 'q' }, preview: a };
  const next = renameTabs(m, 'C:\\repo\\d', 'C:\\repo\\e');
  assert.deepEqual(next.files, [a, 'C:\\repo\\e\\x.md', doc, b]);
  assert.equal(next.active, 'C:\\repo\\e\\x.md');
  assert.deepEqual(next.raw, ['C:\\repo\\e\\x.md']);
  assert.deepEqual(next.query, { [doc]: 'q' });
  assert.equal(next.preview, a);
  const file = renameTabs(m, a, 'C:\\repo\\z.ts');
  assert.deepEqual(file.files, ['C:\\repo\\z.ts', inDir, doc, b]);
  assert.equal(file.preview, 'C:\\repo\\z.ts');
  assert.equal(renameTabs(m, 'C:\\other', 'C:\\other2'), m);
});

// M9 fix 591: the file panes follow a rail rename across every tab.
const fpane = (id: string, path: string, view?: 'raw'): LayoutNode => ({ kind: 'pane', id, sessionId: null, view: view === undefined ? { kind: 'file', path } : { kind: 'file', path, view } });
const panesLayout = (): Layout => ({
  revision: 1,
  currentTabId: 't1',
  tabs: [
    {
      id: 't1',
      name: 't1',
      focusedPaneId: 'p1',
      root: { kind: 'split', id: 's1', direction: 'row', ratio: 0.5, first: { kind: 'pane', id: 'p1', sessionId: 'sess', view: null }, second: fpane('p2', 'C:\\repo\\d\\a.ts') },
    },
    {
      id: 't2',
      name: 't2',
      focusedPaneId: 'p3',
      root: {
        kind: 'split',
        id: 's2',
        direction: 'row',
        ratio: 0.5,
        first: fpane('p3', 'C:\\repo\\d\\b.md', 'raw'),
        second: { kind: 'split', id: 's3', direction: 'column', ratio: 0.5, first: { kind: 'pane', id: 'p4', sessionId: null, view: { kind: 'commits', folder: 'C:\\repo\\d' } }, second: fpane('p5', 'C:\\repo\\other.ts') },
      },
    },
    { id: 't3', name: 't3', focusedPaneId: 'p6', root: fpane('p6', 'C:\\elsewhere\\c.ts') },
  ],
});

test('renameFilePanes: a folder rename moves the file panes under it on every tab, a kept raw kept where the file has a view, the rest untouched (M9 fix 591)', () => {
  const before = panesLayout();
  const after = renameFilePanes(before, 'C:\\repo\\d', 'C:\\repo\\e');
  const t1 = after.tabs[0]!.root;
  assert.ok(t1.kind === 'split');
  assert.deepEqual(t1.first, before.tabs[0]!.root.kind === 'split' ? before.tabs[0]!.root.first : null);
  assert.deepEqual(t1.second, fpane('p2', 'C:\\repo\\e\\a.ts'));
  const t2 = after.tabs[1]!.root;
  assert.ok(t2.kind === 'split' && t2.second.kind === 'split');
  assert.deepEqual(t2.first, fpane('p3', 'C:\\repo\\e\\b.md', 'raw'));
  assert.deepEqual(t2.second.first, { kind: 'pane', id: 'p4', sessionId: null, view: { kind: 'commits', folder: 'C:\\repo\\d' } });
  assert.deepEqual(t2.second.second, fpane('p5', 'C:\\repo\\other.ts'));
  assert.equal(after.tabs[2], before.tabs[2]);
});

test('renameFilePanes: a file rename drops a raw the new file cannot differ from and keeps one it can (M9 fix 591)', () => {
  const one = (path: string): Layout => ({ revision: 1, currentTabId: 't1', tabs: [{ id: 't1', name: 't1', focusedPaneId: 'p1', root: fpane('p1', path, 'raw') }] });
  assert.deepEqual(renameFilePanes(one('C:\\repo\\n.md'), 'C:\\repo\\n.md', 'C:\\repo\\n.txt').tabs[0]!.root, fpane('p1', 'C:\\repo\\n.txt'));
  assert.deepEqual(renameFilePanes(one('C:\\repo\\j.json'), 'C:\\repo\\j.json', 'C:\\repo\\j.md').tabs[0]!.root, fpane('p1', 'C:\\repo\\j.md', 'raw'));
});

test('renameFilePanes: a rename that touches no pane returns the layout itself (M9 fix 591)', () => {
  const before = panesLayout();
  assert.equal(renameFilePanes(before, 'C:\\nowhere\\x', 'C:\\nowhere\\y'), before);
});

// M9 fix 617: the file panes close with the rail's delete, on every tab.
test('deletedFilePanes closes a file pane on a deleted file and those under a deleted folder, empties a tab whose only pane is one, and leaves the rest', () => {
  const before = panesLayout();
  const file = deletedFilePanes(before, 'C:\\repo\\d\\a.ts');
  assert.deepEqual(file.tabs[0]!.root, { kind: 'pane', id: 'p1', sessionId: 'sess', view: null });
  assert.equal(file.tabs[0]!.focusedPaneId, 'p1');
  assert.equal(file.tabs[1], before.tabs[1]);
  const dir = deletedFilePanes(before, 'C:\\REPO\\d');
  assert.deepEqual(dir.tabs[0]!.root, { kind: 'pane', id: 'p1', sessionId: 'sess', view: null });
  const t2 = dir.tabs[1]!.root;
  assert.ok(t2.kind === 'split' && t2.id === 's3');
  assert.deepEqual(t2.first, { kind: 'pane', id: 'p4', sessionId: null, view: { kind: 'commits', folder: 'C:\\repo\\d' } });
  assert.deepEqual(t2.second, fpane('p5', 'C:\\repo\\other.ts'));
  assert.equal(dir.tabs[2], before.tabs[2]);
  const only = deletedFilePanes(before, 'C:\\elsewhere\\c.ts');
  assert.deepEqual(only.tabs[2]!.root, { kind: 'pane', id: 'p6', sessionId: null, view: null });
  assert.equal(only.tabs.length, 3);
  assert.equal(deletedFilePanes(before, 'C:\\nowhere'), before);
});

test('quickSuggestionsFor: prose has no box as you type, code and JSON keep Monaco\'s default (fix 634)', () => {
  assert.equal(quickSuggestionsFor('markdown'), false);
  assert.equal(quickSuggestionsFor('plaintext'), false);
  for (const lang of ['typescript', 'json']) {
    assert.deepEqual(quickSuggestionsFor(lang), { other: 'offWhenInlineCompletions', comments: 'off', strings: 'off' });
  }
});
