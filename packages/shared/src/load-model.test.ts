import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOAD_PAD, LOAD_RING, LOAD_SPAN_MS, hasLoad, loadCeiling, loadFigure, loadInk, loadPeak, loadWindow, memText, next100, pushSample, sparkPath } from './load-model.ts';
import type { LoadSample } from './session.ts';

const NOW = 1_000_000_000;
// Samples every four seconds ending now, the cpus given oldest first.
const ring = (cpus: number[], step: number = 4000): LoadSample[] => cpus.map((cpu, i) => ({ at: NOW - (cpus.length - 1 - i) * step, cpu, rss: 100 }));
const points = (path: string) => path.split(' ').map((p) => p.split(',').map(Number) as [number, number]);

test('hasLoad wants three samples inside the span', () => {
  assert.equal(hasLoad(null, NOW), false);
  assert.equal(hasLoad([], NOW), false);
  assert.equal(hasLoad(ring([1]), NOW), false);
  assert.equal(hasLoad(ring([1, 2]), NOW), false);
  assert.equal(hasLoad(ring([1, 2, 3]), NOW), true);
  // Three samples, two of them older than the span.
  const stale = [{ at: NOW - LOAD_SPAN_MS - 8000, cpu: 1, rss: 1 }, { at: NOW - LOAD_SPAN_MS - 4000, cpu: 1, rss: 1 }, { at: NOW, cpu: 1, rss: 1 }];
  assert.equal(hasLoad(stale, NOW), false);
  assert.equal(loadWindow(stale, NOW).length, 1);
  // A sample stamped past the renderer's clock still counts.
  const ahead = [{ at: NOW - 4000, cpu: 1, rss: 1 }, { at: NOW, cpu: 1, rss: 1 }, { at: NOW + 900, cpu: 1, rss: 1 }];
  assert.equal(hasLoad(ahead, NOW), true);
});

test('sparkPath puts now at the right edge, the cpu against the ceiling with the padding, and clips above it', () => {
  const box = { width: 44, height: 11, ceiling: 200, now: NOW };
  const path = sparkPath(ring([0, 100, 200, 300]), box);
  const pts = points(path);
  assert.equal(pts.length, 4);
  // The last sample is now, at the right edge; the first is 12 s old.
  assert.equal(pts[3]![0], 44);
  assert.ok(Math.abs(pts[0]![0] - 44 * (1 - 12000 / LOAD_SPAN_MS)) < 0.01);
  // 0 sits half a pixel above the baseline, the ceiling half a pixel
  // under the top, 100 half way, and 300 is clipped to the top.
  assert.equal(pts[0]![1], 11 - LOAD_PAD);
  assert.equal(pts[1]![1], 5.5);
  assert.equal(pts[2]![1], LOAD_PAD);
  assert.equal(pts[3]![1], LOAD_PAD);
  assert.equal(sparkPath(null, box), '');
  assert.equal(sparkPath([], box), '');
  assert.equal(sparkPath(ring([50]), { ...box, ceiling: 0 }), '', 'no ceiling, no line');
});

test('sparkPath drops samples outside the span and orders by time', () => {
  const box = { width: 56, height: 11, ceiling: 200, now: NOW };
  const scrambled = [
    { at: NOW, cpu: 10, rss: 1 },
    { at: NOW - LOAD_SPAN_MS - 1, cpu: 500, rss: 1 },
    { at: NOW - 4000, cpu: 20, rss: 1 },
  ];
  const pts = points(sparkPath(scrambled, box));
  assert.equal(pts.length, 2);
  assert.ok(pts[0]![0] < pts[1]![0]);
  assert.equal(pts[1]![0], 56);
});

test('loadPeak is the highest cpu in the span', () => {
  assert.equal(loadPeak(ring([5, 320, 40]), LOAD_SPAN_MS, NOW), 320);
  assert.equal(loadPeak(ring([5, 320, 40]), 6000, NOW), 320);
  assert.equal(loadPeak(ring([5, 320, 40]), 3000, NOW), 40);
  assert.equal(loadPeak(null, LOAD_SPAN_MS, NOW), 0);
});

test('next100 rounds up to the hundred and keeps 0', () => {
  assert.equal(next100(0), 0);
  assert.equal(next100(1), 100);
  assert.equal(next100(100), 100);
  assert.equal(next100(101), 200);
  assert.equal(next100(319), 400);
});

test('loadCeiling: the floor, the next hundred, and the cap at four times the second-highest', () => {
  assert.equal(loadCeiling([]), 200, 'nothing listed reads the floor');
  assert.equal(loadCeiling([0, 0]), 200);
  assert.equal(loadCeiling([50]), 200, 'one quiet session reads the floor');
  assert.equal(loadCeiling([350]), 400, 'one loud session reads its own next hundred, no cap');
  assert.equal(loadCeiling([350, 340]), 400, 'two loud sessions: the cap at 1400 does not bite');
  assert.equal(loadCeiling([300, 6, 30, 38, 12]), 200, 'one at 300 beside four under 40: the cap at next100(152) = 200 clips it');
  assert.equal(loadCeiling([900, 60]), 300, 'the cap: next100(240)');
  assert.equal(loadCeiling([900, 10]), 200, 'the cap under the floor reads the floor');
});

test('loadInk turns at 200', () => {
  assert.equal(loadInk(0), 'load-ink');
  assert.equal(loadInk(199), 'load-ink');
  assert.equal(loadInk(199.9), 'load-ink');
  assert.equal(loadInk(200), 'load-hot');
  assert.equal(loadInk(319), 'load-hot');
});

test('loadFigure and memText', () => {
  assert.equal(loadFigure(38.4), '38%');
  assert.equal(loadFigure(318.6), '319%');
  assert.equal(loadFigure(0), '0%');
  assert.equal(memText(640), '640 MB');
  assert.equal(memText(999.6), '1000 MB');
  assert.equal(memText(1229), '1.2 GB');
  assert.equal(memText(4096), '4.0 GB');
});

test('pushSample keeps the last LOAD_RING samples, oldest first', () => {
  let ring = pushSample(null, { at: 0, cpu: 1, rss: 1 });
  assert.deepEqual(ring, [{ at: 0, cpu: 1, rss: 1 }]);
  for (let i = 1; i < LOAD_RING + 5; i++) ring = pushSample(ring, { at: i, cpu: i, rss: 1 });
  assert.equal(ring.length, LOAD_RING);
  assert.equal(ring[0]!.at, 5);
  assert.equal(ring.at(-1)!.at, LOAD_RING + 4);
});
