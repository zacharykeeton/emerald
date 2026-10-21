import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_PX, adoptFrames, frameRect, refusalLine, toolbarShown, withPageUrl, withToolbar } from './browser-layer.ts';

// M9 fix 669: which frame a browser pane gets across a layout change, and
// where a frame sits over its slot.

const ids = () => {
  let n = 0;
  return () => `f${++n}`;
};
const urls = (pairs: [string, string][]) => new Map(pairs);

test('a first layout gives every page pane a frame of its own, in pane order', () => {
  const next = adoptFrames(new Map(), [{ id: 'a', url: 'http://x/' }, { id: 'b', url: 'http://y/' }], new Map(), ids());
  assert.deepEqual([...next], [['a', 'f1'], ['b', 'f2']]);
});

test('a split keeps every frame', () => {
  const prev = new Map([['a', 'f1']]);
  const next = adoptFrames(prev, [{ id: 'a', url: 'http://x/' }], urls([['a', 'http://x/']]), ids());
  assert.deepEqual([...next], [['a', 'f1']]);
});

test('a close beside the page keeps the survivor its frame', () => {
  const prev = new Map([['a', 'f1'], ['b', 'f2']]);
  const next = adoptFrames(prev, [{ id: 'b', url: 'http://y/' }], urls([['a', 'http://x/'], ['b', 'http://y/']]), ids());
  assert.deepEqual([...next], [['b', 'f2']]);
});

test('a vanished pane and a new one on the same URL hand the frame over (a move)', () => {
  const prev = new Map([['a', 'f1']]);
  const next = adoptFrames(prev, [{ id: 'moved', url: 'http://x/' }], urls([['a', 'http://x/']]), ids());
  assert.deepEqual([...next], [['moved', 'f1']]);
});

test('two moves on two URLs pair by URL', () => {
  const prev = new Map([['a', 'f1'], ['b', 'f2']]);
  const next = adoptFrames(prev, [{ id: 'nb', url: 'http://y/' }, { id: 'na', url: 'http://x/' }], urls([['a', 'http://x/'], ['b', 'http://y/']]), ids());
  assert.deepEqual([...next], [['nb', 'f2'], ['na', 'f1']]);
});

test('two vanished panes on one URL give their frames out in pane order', () => {
  const prev = new Map([['a', 'f1'], ['b', 'f2']]);
  const next = adoptFrames(prev, [{ id: 'n1', url: 'http://x/' }, { id: 'n2', url: 'http://x/' }], urls([['a', 'http://x/'], ['b', 'http://x/']]), ids());
  assert.deepEqual([...next], [['n1', 'f1'], ['n2', 'f2']]);
});

test('a vanished pane with no new match drops its frame', () => {
  const prev = new Map([['a', 'f1'], ['b', 'f2']]);
  const next = adoptFrames(prev, [{ id: 'a', url: 'http://x/' }], urls([['a', 'http://x/'], ['b', 'http://y/']]), ids());
  assert.deepEqual([...next], [['a', 'f1']]);
});

test('a new pane with no match gets a new frame id, not a dropped one', () => {
  const prev = new Map([['a', 'f7']]);
  const next = adoptFrames(prev, [{ id: 'c', url: 'http://z/' }], urls([['a', 'http://x/']]), () => 'f8');
  assert.deepEqual([...next], [['c', 'f8']]);
});

test('a second pass on its own result changes nothing', () => {
  const panes = [{ id: 'a', url: 'http://x/' }, { id: 'b', url: 'http://y/' }];
  const first = adoptFrames(new Map(), panes, new Map(), ids());
  const second = adoptFrames(first, panes, urls([['a', 'http://x/'], ['b', 'http://y/']]), () => 'never');
  assert.deepEqual([...second], [...first]);
});

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRectReadOnly;

test('a frame sits over its slot, inset off the ring on the left, right and bottom, none on top', () => {
  assert.equal(RING_PX, 3);
  const r = frameRect(rect(110, 90, 400, 300), rect(10, 40, 900, 700));
  assert.deepEqual(r, { left: 103, top: 50, width: 394, height: 297 });
});

test('a slot smaller than the ring gives an empty frame, never a negative one', () => {
  const r = frameRect(rect(10, 10, 4, 2), rect(0, 0, 100, 100));
  assert.deepEqual(r, { left: 13, top: 10, width: 0, height: 0 });
});

test('the toolbar row shows by the record, and unasked for an empty address, Design Mode or the tray (M9 fix 839)', () => {
  for (const pageOn of [true, false]) for (const designOn of [true, false]) for (const trayOpen of [true, false]) {
    assert.equal(toolbarShown(true, pageOn, designOn, trayOpen), true);
    assert.equal(toolbarShown(false, pageOn, designOn, trayOpen), !pageOn || designOn || trayOpen);
  }
  assert.equal(toolbarShown(false, true, false, false), false);
});

test("a navigation keeps the record's profile and toolbar, and the toolbar flag is kept only when false (M9 fix 839)", () => {
  const v = { kind: 'browser', url: 'http://a/', profile: 'b', toolbar: false } as const;
  assert.deepEqual(withPageUrl(v, 'http://b/'), { kind: 'browser', url: 'http://b/', profile: 'b', toolbar: false });
  assert.deepEqual(withPageUrl(null, 'http://b/'), { kind: 'browser', url: 'http://b/' });
  assert.deepEqual(withPageUrl(undefined, 'http://b/'), { kind: 'browser', url: 'http://b/' });
  assert.deepEqual(withPageUrl({ kind: 'commits', folder: 'C:/r' }, 'http://b/'), { kind: 'browser', url: 'http://b/' });
  assert.deepEqual(withToolbar({ kind: 'browser', url: 'http://a/', profile: 'b' }, false), { kind: 'browser', url: 'http://a/', profile: 'b', toolbar: false });
  const shown = withToolbar(v, true);
  assert.deepEqual(shown, { kind: 'browser', url: 'http://a/', profile: 'b' });
  assert.equal('toolbar' in shown, false);
  // M9 fix 969: the opener rides through a navigation and the toolbar toggle, which emmer browser close reads.
  const opened = { kind: 'browser', url: 'http://a/', openedBy: 'abc-1' } as const;
  assert.deepEqual(withPageUrl(opened, 'http://b/'), { kind: 'browser', url: 'http://b/', openedBy: 'abc-1' });
  assert.deepEqual(withToolbar(opened, false), { kind: 'browser', url: 'http://a/', openedBy: 'abc-1', toolbar: false });
});

test('a navigation keeps the root for a page from the disk and drops it for a web page (M9 fix 896)', () => {
  const local = 'emerald-file://0f1e2d3c-4b5a-4968-8776-655443322110/site/two.html';
  const v = { kind: 'browser', url: 'emerald-file://0f1e2d3c-4b5a-4968-8776-655443322110/site/page.html', root: 'C:\\pages', profile: 'b' } as const;
  assert.deepEqual(withPageUrl(v, local), { kind: 'browser', url: local, root: 'C:\\pages', profile: 'b' });
  const web = withPageUrl(v, 'http://b/');
  assert.deepEqual(web, { kind: 'browser', url: 'http://b/', profile: 'b' });
  assert.equal('root' in web, false);
  // Back from the web onto the page: the folder from the root ids seen.
  const seen = (id: string) => (id === '0f1e2d3c-4b5a-4968-8776-655443322110' ? 'C:\\pages' : undefined);
  assert.deepEqual(withPageUrl(web, v.url, seen), { kind: 'browser', url: v.url, root: 'C:\\pages', profile: 'b' });
  // A page of another root id never takes this record's folder, and with
  // no folder known the record stays as it was.
  const other = 'emerald-file://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/x.html';
  assert.deepEqual(withPageUrl(v, other, seen), v);
  assert.deepEqual(withPageUrl(web, other, seen), web);
});

test("main's refusal reads as a page from the disk or a link off the web (M9 fix 967)", () => {
  const local = 'emerald-file://0b5c3a9e-1f2d-4c3b-8a7e-6d5c4b3a2f10/site/page.html';
  assert.equal(refusalLine(local), `This page tried to open ${local}; a web page cannot open a page from the disk`);
  assert.equal(refusalLine('file:///C:/x'), 'This page tried to open file:///C:/x; a browser pane opens only http and https pages');
});
