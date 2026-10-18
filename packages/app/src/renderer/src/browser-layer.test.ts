import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_PX, adoptFrames, frameRect, toolbarShown, withPageUrl, withToolbar } from './browser-layer.ts';

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
});
