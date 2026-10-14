import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ShellCommand } from '@emerald/shared';
import { familyStar, liveSamples, maxSamples, rateText, runningShells, shellMarkTitle, shellRunning } from './session-mark-model.ts';

test('liveSamples reads the rate only while working, on a daemon that sends rates, once one has arrived', () => {
  const samples = [1, 2, 3, 4];
  assert.deepEqual(liveSamples('pulse', 14, samples), samples);
  assert.deepEqual(liveSamples('pulse', 15, samples), samples);
  // The M33 motion is null for a stale or non-working session: no rate.
  assert.equal(liveSamples(null, 14, samples), null);
  assert.equal(liveSamples(undefined, 14, samples), null);
  // An older daemon sends none.
  assert.equal(liveSamples('pulse', 13, samples), null);
  assert.equal(liveSamples('pulse', null, samples), null);
  // Nor has a working session no push has reached yet.
  assert.equal(liveSamples('pulse', 14, undefined), null);
  // Zeros after a burst are real.
  assert.deepEqual(liveSamples('pulse', 14, [0, 0, 0, 0]), [0, 0, 0, 0]);
});

test('shellRunning is the last window above zero: a burst runs, the all-zero report after it stops, no push is the prompt', () => {
  assert.equal(shellRunning([0, 0, 0, 512]), true);
  assert.equal(shellRunning([512, 0, 0, 0]), false);
  assert.equal(shellRunning([0, 0, 0, 0]), false);
  assert.equal(shellRunning([]), false);
  assert.equal(shellRunning(undefined), false);
});

test('shellRunning reads the record before the rate (M9 fix 196): a running command through its silence, a finished one over a burst, and the rate where the prompt never reported', () => {
  const at = 1_000_000;
  assert.equal(shellRunning(undefined, { state: 'running', exitCode: null, startedAt: at, endedAt: null }), true, 'a quiet Start-Sleep runs');
  assert.equal(shellRunning([0, 0, 0, 512], { state: 'ok', exitCode: 0, startedAt: at, endedAt: at + 500 }), false, 'the prompt has drawn, whatever the rate says');
  assert.equal(shellRunning([0, 0, 0, 512], { state: 'failed', exitCode: 3, startedAt: at, endedAt: at + 500 }), false);
  assert.equal(shellRunning([0, 0, 0, 512], null), true, 'no command on the record leaves the rate to say');
  assert.equal(shellRunning([0, 0, 0, 512], undefined), true);
  const shell = (id: string, command: ShellCommand | null, claudeSessionId: string | null = null) => ({ id, kind: 'shell' as const, claudeSessionId, command });
  const rates = new Map<string, number[]>([['b', [0, 0, 0, 512]], ['c', [0, 0, 0, 512]]]);
  const running = runningShells(rates, [
    shell('a', { state: 'running', exitCode: null, startedAt: at, endedAt: null }),
    shell('b', { state: 'ok', exitCode: 0, startedAt: at, endedAt: at + 500 }),
    shell('c', null),
    shell('d', { state: 'running', exitCode: null, startedAt: at, endedAt: null }, 'bound'),
  ]);
  assert.deepEqual([...running].sort(), ['a', 'c'], 'the record first, the rate where there is none, and a bound shell is not a shell');
  assert.equal(shellMarkTitle(null, at), 'A shell at its prompt, or running a command');
  assert.equal(shellMarkTitle({ state: 'running', exitCode: null, startedAt: at - 40_000, endedAt: null }, at), 'running 40s');
  assert.equal(shellMarkTitle({ state: 'failed', exitCode: 3, startedAt: at - 130_000, endedAt: at - 120_000 }, at), 'failed (3) 2m ago');
});

test('maxSamples takes the busiest session per window', () => {
  assert.equal(maxSamples([]), null);
  assert.deepEqual(maxSamples([[1, 5, 0, 2]]), [1, 5, 0, 2]);
  assert.deepEqual(maxSamples([[1, 5, 0, 2], [3, 0, 7, 0]]), [3, 5, 7, 2]);
});

test('rateText reads the last window as a rate', () => {
  assert.equal(rateText([0, 0, 0, 0]), '0 B/s');
  assert.equal(rateText([9, 9, 9, 100]), '400 B/s');
  assert.equal(rateText([0, 0, 0, 4096]), '16.0 KB/s');
});

// M9 fix 288: a member's star by its family, 10 with no model yet.
test('familyStar: 12 for Fable, 10 for Opus, 8 for Sonnet and Haiku, 10 with no model yet', () => {
  assert.equal(familyStar('Fable'), 12);
  assert.equal(familyStar('Opus'), 10);
  assert.equal(familyStar('Sonnet'), 8);
  assert.equal(familyStar('Haiku'), 8);
  assert.equal(familyStar(null), 10);
  assert.equal(familyStar('Something'), 10, 'an unknown word is the usual size');
});
