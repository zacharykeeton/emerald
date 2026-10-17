import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrustRead } from './trust-read.ts';

// M9 fix 808: the dialog as Claude Code 2.1.302 draws it, cut to its
// options, which is all the reader needs.
const DIALOG = [' Accessing workspace:', '', ' ❯ No, exit', '   Yes, I trust this folder'];
const PLAIN = ['❯ ', '  ? for shortcuts'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(rows: string[], gate: 'starting' | 'trust' | null, readMs = 0) {
  const applied: boolean[] = [];
  let reads = 0;
  const reader = new TrustRead({
    read: async () => {
      reads++;
      if (readMs > 0) await sleep(readMs);
      return { rows };
    },
    gate: () => gate,
    apply: (shown) => applied.push(shown),
    delayMs: 10,
  });
  return { reader, applied, reads: () => reads };
}

test('three pokes close together make one read (M9 fix 808)', async () => {
  const h = harness(PLAIN, 'starting');
  h.reader.poke();
  h.reader.poke();
  h.reader.poke();
  await sleep(60);
  assert.equal(h.reads(), 1);
  h.reader.dispose();
});

test('a dialog under a starting gate applies shown once', async () => {
  const h = harness(DIALOG, 'starting');
  h.reader.poke();
  await sleep(60);
  assert.deepEqual(h.applied, [true]);
  h.reader.dispose();
});

test('a frame without the dialog under a trust gate applies gone', async () => {
  const h = harness(PLAIN, 'trust');
  h.reader.poke();
  await sleep(60);
  assert.deepEqual(h.applied, [false]);
  h.reader.dispose();
});

test('a null gate applies nothing, and a starting gate with no dialog nothing either', async () => {
  const none = harness(DIALOG, null);
  none.reader.poke();
  const plain = harness(PLAIN, 'starting');
  plain.reader.poke();
  await sleep(60);
  assert.deepEqual(none.applied, []);
  assert.deepEqual(plain.applied, []);
  none.reader.dispose();
  plain.reader.dispose();
});

test('a poke during a read makes exactly one more read after it', async () => {
  const h = harness(PLAIN, 'starting', 50);
  h.reader.poke();
  await sleep(25); // the read is in flight
  assert.equal(h.reads(), 1);
  h.reader.poke();
  h.reader.poke();
  await sleep(150);
  assert.equal(h.reads(), 2);
  h.reader.dispose();
});

test('a disposed reader reads nothing', async () => {
  const h = harness(DIALOG, 'starting');
  h.reader.poke();
  h.reader.dispose();
  await sleep(40);
  assert.equal(h.reads(), 0);
});
