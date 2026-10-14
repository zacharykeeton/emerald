import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from '@emerald/shared';
import { BAR_COUNT, BAR_FLOOR, BUCKET_MS, FULL_TOKENS, barHeight, barsTitle, emptyRing, feedRing, newestTokens, readOutputs } from './activity-bars.ts';
import { anActivitySession } from './test-support.ts';

function row(sessionId: string, agentId: string | null = null, lifetime = false): ActivitySession {
  return anActivitySession({ sessionId, name: sessionId, kind: lifetime ? 'shell' : agentId === null ? 'claude' : 'agent', lifetime, parentId: agentId === null ? null : sessionId, agentId, spans: [{ from: 0, to: 1, prompt: null }] });
}

// On a bucket boundary, so a delta's spread lands in whole buckets.
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % BUCKET_MS);
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} against ${b}`);

test('readOutputs reads the working drawn sessions once each, agents through their parent, shells and idle rows not at all (M9 fix 216)', () => {
  const store = new Map([
    ['a', { state: 'working', tokens: { output: 120 } }],
    ['b', { state: 'idle', tokens: { output: 50 } }],
    ['c', { state: 'working', tokens: null }],
    ['d', { state: 'working', tokens: { output: 7 } }],
  ]);
  const out = readOutputs([row('a'), row('a', 'a1'), row('b'), row('c'), row('d', null, true), row('gone')], store);
  assert.deepEqual(out, [{ key: 'a', output: 120 }]);
});

// M9 fix 229: the bucket is a second, the ring 24 of them.
test('the bucket is one second and the ring twenty-four across, a full bar a few agents streaming', () => {
  assert.equal(BUCKET_MS, 1000);
  assert.equal(BAR_COUNT, 24);
  assert.equal(FULL_TOKENS, 400);
});

test('feedRing bins a delta made within one bucket into the newest, slides with the clock and starts a row over when its count drops', () => {
  let ring = emptyRing(T0);
  // First sight of a row is a baseline, not a count.
  ring = feedRing(ring, T0, [{ key: 'a', output: 100 }, { key: 'b', output: 10 }]);
  assert.equal(ring.buckets[BAR_COUNT - 1], 0);
  assert.deepEqual([...ring.agents].sort(), ['a', 'b']);
  ring = feedRing(ring, T0 + 400, [{ key: 'a', output: 160 }, { key: 'b', output: 30 }]);
  near(ring.buckets[BAR_COUNT - 1]!, 80, 'both deltas in the newest bucket');
  // One bucket on: the 80 slides left, and a's delta, made over the 600
  // ms before the boundary, joins it there rather than the newest.
  ring = feedRing(ring, T0 + BUCKET_MS, [{ key: 'a', output: 200 }, { key: 'b', output: 30 }]);
  near(ring.buckets[BAR_COUNT - 2]!, 120, 'the pair and the delta made before the boundary slid left');
  near(ring.buckets[BAR_COUNT - 1]!, 0, 'nothing made in the newest yet');
  assert.deepEqual([...ring.agents].sort(), ['a', 'b'], 'the newest bucket names the rows read into it');
  ring = feedRing(ring, T0 + BUCKET_MS + 400, [{ key: 'a', output: 230 }, { key: 'b', output: 30 }]);
  near(ring.buckets[BAR_COUNT - 1]!, 30, 'a delta made inside the newest bucket lands in it');
  // b's count fell (a /clear): a new baseline, nothing counted.
  ring = feedRing(ring, T0 + BUCKET_MS + 500, [{ key: 'a', output: 230 }, { key: 'b', output: 5 }]);
  near(ring.buckets[BAR_COUNT - 1]!, 30, 'a drop counts nothing');
  ring = feedRing(ring, T0 + BUCKET_MS + 900, [{ key: 'a', output: 230 }, { key: 'b', output: 15 }]);
  near(ring.buckets[BAR_COUNT - 1]!, 40, 'and the next delta counts from the new baseline');
  // A gap longer than the ring empties it.
  ring = feedRing(ring, T0 + (BAR_COUNT + 2) * BUCKET_MS, []);
  assert.ok(ring.buckets.every((b) => b === 0));
  assert.equal(ring.buckets.length, BAR_COUNT);
});

// M9 fix 229: a per-request delta is spread over the seconds since the
// row's last line, so a 2 s tool call and a 20 s reply draw as their
// shapes rather than one lump each.
test('feedRing spreads a delta over the buckets since the row\'s last line, at one rate, the part older than the ring dropped', () => {
  let ring = emptyRing(T0);
  ring = feedRing(ring, T0 + 500, [{ key: 'a', output: 100 }]);
  // Two seconds of nothing (the ticks between), then a line: 300 tokens
  // over the 2.5 s since the baseline's line, 120 a second.
  ring = feedRing(ring, T0 + 1500, [{ key: 'a', output: 100 }]);
  ring = feedRing(ring, T0 + 2500, [{ key: 'a', output: 100 }]);
  ring = feedRing(ring, T0 + 3000, [{ key: 'a', output: 400 }]);
  const b = ring.buckets;
  near(b[BAR_COUNT - 4]!, 60, 'the half second of the first bucket');
  near(b[BAR_COUNT - 3]!, 120, 'a whole second');
  near(b[BAR_COUNT - 2]!, 120, 'a whole second');
  near(b[BAR_COUNT - 1]!, 0, 'the newest bucket starts at the line');
  assert.equal(newestTokens(ring), 0);
  // The next line 200 ms on: its delta lands in the newest bucket alone,
  // at once, so the newest bar grows as each delta lands.
  ring = feedRing(ring, T0 + 3200, [{ key: 'a', output: 440 }]);
  near(ring.buckets[BAR_COUNT - 1]!, 40, 'the newest grows');
  // A long reply: one line 30 s later carrying 3000 tokens is 100 a
  // second over the ring's 24 s, the 6 s before the ring dropped.
  ring = feedRing(ring, T0 + 33_200, [{ key: 'a', output: 3440 }]);
  assert.ok(ring.buckets.slice(0, BAR_COUNT - 1).every((v) => Math.abs(v - 100) < 1e-6), `every older bucket takes a second's share, got ${ring.buckets.slice(0, 3).join(', ')}`);
  near(ring.buckets[BAR_COUNT - 1]!, 20, 'the newest its 200 ms');
  assert.equal(newestTokens(ring), 20);
});

test('a row back after an absence starts its clock at its return, so its first delta is not smeared over the rest', () => {
  let ring = emptyRing(T0);
  ring = feedRing(ring, T0, [{ key: 'a', output: 100 }]);
  // a stops working: the readings no longer carry it, for a minute.
  ring = feedRing(ring, T0 + 30_000, []);
  ring = feedRing(ring, T0 + 60_000, []);
  // Back, with the same count, then a line 400 ms later.
  ring = feedRing(ring, T0 + 61_000, [{ key: 'a', output: 100 }]);
  ring = feedRing(ring, T0 + 61_400, [{ key: 'a', output: 180 }]);
  near(ring.buckets[BAR_COUNT - 1]!, 80, 'the whole delta in the newest bucket');
  assert.ok(ring.buckets.slice(0, BAR_COUNT - 1).every((v) => v === 0), 'nothing behind it');
});

test('barHeight is the floor at nothing and M41\'s log curve to a full bucket; the title reads the newest bucket whole', () => {
  assert.equal(barHeight(0), BAR_FLOOR);
  assert.ok(barHeight(10) > BAR_FLOOR && barHeight(10) < barHeight(100));
  assert.equal(barHeight(FULL_TOKENS), 1);
  assert.equal(barHeight(5000), 1);
  near(barHeight(100), BAR_FLOOR + (1 - BAR_FLOOR) * (Math.log2(101) / Math.log2(401)), 'the curve at 100');
  let ring = emptyRing(T0);
  ring = feedRing(ring, T0, [{ key: 'a', output: 0 }]);
  ring = feedRing(ring, T0 + 100, [{ key: 'a', output: 1200 }]);
  assert.equal(barsTitle(ring, 7), '1.2k output tokens in the last 1 s across 7 agents');
  assert.equal(barsTitle(emptyRing(T0), 1), '0 output tokens in the last 1 s across 1 agent');
  // A spread bucket's fraction is rounded for the words.
  ring = feedRing(emptyRing(T0), T0 + 700, [{ key: 'a', output: 0 }]);
  ring = feedRing(ring, T0 + 1000, [{ key: 'a', output: 0 }]);
  ring = feedRing(ring, T0 + 1300, [{ key: 'a', output: 100 }]);
  assert.equal(newestTokens(ring), 50);
  assert.equal(barsTitle(ring, 1), '50 output tokens in the last 1 s across 1 agent');
});
