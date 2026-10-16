import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainOn, ctrlCWaitMs, isBusy, promptRefusal, sendRoute } from './prompt-model.ts';

test('promptRefusal names the two states the text must not go to', () => {
  assert.equal(promptRefusal({ state: 'needs-input' }), 'Answer what it is waiting on first');
  assert.equal(promptRefusal({ state: 'exited' }), 'Resume it first');
});

test('promptRefusal lets the text go to every other state', () => {
  for (const state of ['starting', 'idle', 'working', 'waiting', 'done', 'errored'] as const) assert.equal(promptRefusal({ state }), null, state);
});

test('isBusy is working and waiting, the states that are taken as moving', () => {
  assert.equal(isBusy('working'), true);
  assert.equal(isBusy('waiting'), true);
  assert.equal(isBusy('idle'), false);
  assert.equal(isBusy('done'), false);
});

test('sendRoute sends a plain prompt to a Claude at rest through the mod, and types the rest (M9 fix 781)', () => {
  const claude = (state: 'idle' | 'done' | 'errored' | 'working' | 'waiting' | 'needs-input') => ({ kind: 'claude' as const, state });
  for (const state of ['idle', 'done', 'errored'] as const) assert.equal(sendRoute(claude(state), 'fix it', 65, false), 'mod', state);
  for (const state of ['working', 'waiting', 'needs-input'] as const) assert.equal(sendRoute(claude(state), 'fix it', 65, false), 'typed', state);
  assert.equal(sendRoute(claude('idle'), 'fix it', 64, false), 'typed', 'level 64');
  assert.equal(sendRoute({ kind: 'shell', state: 'idle' }, 'fix it', 65, false), 'typed', 'a shell');
  assert.equal(sendRoute(claude('idle'), '/compact', 65, false), 'typed', 'a command');
  assert.equal(sendRoute(claude('idle'), '!ls', 65, false), 'typed', 'bash mode');
  assert.equal(sendRoute(claude('idle'), 'look at @a.ts', 65, false), 'typed', 'a mention');
  assert.equal(sendRoute(claude('idle'), 'fix it', 65, true), 'typed', 'typed asked for');
});

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('chainOn starts a run for a key only once the one before it settles (M9 fix 781)', async () => {
  const chains = new Map<string, Promise<unknown>>();
  const marks: string[] = [];
  const first = chainOn(chains, 's', async () => {
    marks.push('first start');
    await later(50);
    marks.push('first end');
  });
  const second = chainOn(chains, 's', async () => {
    marks.push('second start');
  });
  await Promise.all([first, second]);
  assert.deepEqual(marks, ['first start', 'first end', 'second start']);
  await later(0);
  assert.equal(chains.size, 0);
});

test('chainOn lets the next run start after a rejected one, and runs two keys side by side (M9 fix 781)', async () => {
  const chains = new Map<string, Promise<unknown>>();
  const marks: string[] = [];
  const bad = chainOn(chains, 'a', async () => {
    await later(30);
    throw new Error('no');
  });
  const next = chainOn(chains, 'a', async () => {
    marks.push('a next');
  });
  const other = chainOn(chains, 'b', async () => {
    marks.push('b');
  });
  await assert.rejects(bad);
  await Promise.all([next, other]);
  assert.deepEqual(marks, ['b', 'a next']);
  await later(0);
  assert.equal(chains.size, 0);
});

test('ctrlCWaitMs waits out the gap since the last Ctrl+C (M9 fix 783)', () => {
  assert.equal(ctrlCWaitMs(undefined, 5000), 0);
  assert.equal(ctrlCWaitMs(1000, 1000), 2000);
  assert.equal(ctrlCWaitMs(1000, 2500), 500);
  assert.equal(ctrlCWaitMs(1000, 3500), 0);
});
