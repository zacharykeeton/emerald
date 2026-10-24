import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwitchRead } from './switch-read.ts';

// M9 fix 976: the switch confirmation as Claude Code 2.1.310's bundle draws
// it, cut to its title and options, which is all the reader needs.
const DIALOG = [' Change effort level?', '', ' ❯ 1. Yes, switch to high', '   2. No, go back'];
const PLAIN = ['❯ ', '  ? for shortcuts'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(rows: string[], gate: 'rest' | 'switch' | null) {
  const applied: boolean[] = [];
  let reads = 0;
  const reader = new SwitchRead({
    read: async () => {
      reads++;
      return { rows };
    },
    gate: () => gate,
    apply: (shown) => applied.push(shown),
    delayMs: 10,
  });
  return { reader, applied, reads: () => reads };
}

test('three pokes close together make one read (M9 fix 976)', async () => {
  const h = harness(PLAIN, 'rest');
  h.reader.poke();
  h.reader.poke();
  h.reader.poke();
  await sleep(60);
  assert.equal(h.reads(), 1);
  h.reader.dispose();
});

test('a dialog under a rest gate applies shown once', async () => {
  const h = harness(DIALOG, 'rest');
  h.reader.poke();
  await sleep(60);
  assert.deepEqual(h.applied, [true]);
  h.reader.dispose();
});

test('a frame without the dialog under a switch gate applies gone', async () => {
  const h = harness(PLAIN, 'switch');
  h.reader.poke();
  await sleep(60);
  assert.deepEqual(h.applied, [false]);
  h.reader.dispose();
});

test('a null gate applies nothing, and a rest gate with no dialog nothing either', async () => {
  const none = harness(DIALOG, null);
  none.reader.poke();
  const plain = harness(PLAIN, 'rest');
  plain.reader.poke();
  await sleep(60);
  assert.deepEqual(none.applied, []);
  assert.deepEqual(plain.applied, []);
  none.reader.dispose();
  plain.reader.dispose();
});
