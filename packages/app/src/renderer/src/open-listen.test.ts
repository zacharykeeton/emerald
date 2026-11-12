import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openListenGate } from './open-listen.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('openListenGate listens once, at the first ready, and the fallback adds nothing after it (M9 fix 1159)', async () => {
  let listens = 0;
  let lates = 0;
  const gate = openListenGate(() => { listens++; return () => {}; }, 20, () => { lates++; });
  gate.ready();
  gate.ready();
  assert.equal(listens, 1);
  await wait(80);
  assert.equal(listens, 1);
  assert.equal(lates, 0);
  gate.dispose();
});

test('openListenGate listens after the fallback when no ready comes, and says so once (M9 fix 1159)', async () => {
  let listens = 0;
  let lates = 0;
  const gate = openListenGate(() => { listens++; return () => {}; }, 20, () => { lates++; });
  await wait(80);
  assert.equal(listens, 1);
  assert.equal(lates, 1);
  gate.ready();
  assert.equal(listens, 1);
  gate.dispose();
});

test('openListenGate disposed listens to nothing and stops what it started (M9 fix 1159)', async () => {
  let listens = 0;
  const early = openListenGate(() => { listens++; return () => {}; }, 20, () => {});
  early.dispose();
  early.ready();
  await wait(80);
  assert.equal(listens, 0);
  let stops = 0;
  const gate = openListenGate(() => { listens++; return () => { stops++; }; }, 20, () => {});
  gate.ready();
  gate.dispose();
  gate.dispose();
  assert.equal(listens, 1);
  assert.equal(stops, 1);
});
