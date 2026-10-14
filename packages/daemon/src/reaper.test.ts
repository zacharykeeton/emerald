import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { REAPER_DEADLINE_MS, REAP_AFTER_MS, START_TOLERANCE_MS, isSameProcess, readStartedAt, systemProbes } from './reaper.ts';
import type { ReaperProbes } from './reaper.ts';

const probes = (alive: boolean, startedAt: number | null): ReaperProbes => ({ alive: () => alive, startedAt: () => startedAt });

test('the reaper kills only a pid whose start time is the one its daemon passed (M9 fix 416)', () => {
  const started = 1_700_000_000_000;
  assert.equal(isSameProcess(1234, started, probes(true, started)), true, 'the same process');
  assert.equal(isSameProcess(1234, started, probes(true, started + START_TOLERANCE_MS - 1)), true, 'inside the tolerance');
  // A pid Windows has handed to somebody else since: the number is alive
  // but the process behind it is younger, so the reaper leaves it alone.
  assert.equal(isSameProcess(1234, started, probes(true, started + 60_000)), false, 'a reused pid, the new process younger');
  assert.equal(isSameProcess(1234, started, probes(true, started - 60_000)), false, 'a reused pid, the new process older');
  assert.equal(isSameProcess(1234, started, probes(false, started)), false, 'nothing holds the pid, the ordinary case');
  assert.equal(isSameProcess(1234, started, probes(true, null)), false, 'the start time could not be read');
  assert.equal(isSameProcess(Number.NaN, started, probes(true, started)), false, 'a pid that is not a number');
  assert.equal(isSameProcess(1234, Number.NaN, probes(true, started)), false, 'a start time that is not a number');
});

test('the deadline outlasts the wait, so a reaper that does its work is never cut short', () => {
  assert.ok(REAPER_DEADLINE_MS > REAP_AFTER_MS, `${REAPER_DEADLINE_MS} > ${REAP_AFTER_MS}`);
});

test('the real probes read a live child and refuse a pid nobody holds', async () => {
  // A child of this test's own making: its start time is now, so the
  // reaper's check takes it, and a fabricated older start time is the
  // stale case the whole fix exists for.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore', windowsHide: true });
  try {
    await new Promise((r) => setTimeout(r, 500));
    const pid = child.pid!;
    assert.equal(systemProbes.alive(pid), true, 'the child is alive');
    const started = readStartedAt(pid);
    assert.ok(started !== null && Math.abs(started - Date.now()) < 60_000, `its start time reads as about now (${started})`);
    assert.equal(isSameProcess(pid, started, systemProbes), true, 'the live child matches its own start time');
    assert.equal(isSameProcess(pid, started - 3_600_000, systemProbes), false, 'the same pid with an hour-old start time is refused');
  } finally {
    child.kill();
  }
  // 1 is the idle process on Windows and 0 is never a process; neither is
  // a pid this could be asked to reap, and nothing is killed either way.
  assert.equal(isSameProcess(0, Date.now(), systemProbes), false);
});
