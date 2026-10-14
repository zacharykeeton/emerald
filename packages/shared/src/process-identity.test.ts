import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_TOLERANCE_MS, processIdentity, processIdentityAsync } from './process-identity.ts';
import type { ReaperProbes } from './process-identity.ts';

const probes = (alive: boolean, startedAt: number | null): ReaperProbes => ({ alive: () => alive, startedAt: () => startedAt });

test('a pid is the same process, gone, or somebody else (M9 fix 494)', () => {
  const started = 1_700_000_000_000;
  assert.equal(processIdentity(1234, started, probes(true, started)), 'same');
  assert.equal(processIdentity(1234, started, probes(true, started + START_TOLERANCE_MS - 1)), 'same', 'inside the tolerance');
  assert.equal(processIdentity(1234, started, probes(true, started + 60_000)), 'other', 'a reused pid, the new process younger');
  assert.equal(processIdentity(1234, started, probes(true, started - 60_000)), 'other', 'a reused pid, the new process older');
  assert.equal(processIdentity(1234, started, probes(false, started)), 'gone', 'nothing holds the pid');
  assert.equal(processIdentity(1234, started, probes(true, null)), 'gone', 'the start time could not be read');
  assert.equal(processIdentity(Number.NaN, started, probes(true, started)), 'gone', 'a pid that is not a number');
});

test('this process reads as itself, through the real probes, sync and async (M9 fix 494)', async () => {
  const startedAt = Date.now() - process.uptime() * 1000;
  assert.equal(processIdentity(process.pid, startedAt), 'same');
  assert.equal(await processIdentityAsync(process.pid, startedAt), 'same');
  assert.equal(await processIdentityAsync(process.pid, 1), 'other', 'the epoch is not when this process started');
});
