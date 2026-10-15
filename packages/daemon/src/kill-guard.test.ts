import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from './log.ts';
import { guardSelfKill } from './kill-guard.ts';

function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const keep = (level: string) => (msg: string) => {
    lines.push(`${level} ${msg}`);
  };
  return { lines, info: keep('info'), warn: keep('warn'), error: keep('error') };
}

function stubProc() {
  const calls: unknown[][] = [];
  const proc = {
    pid: 9100,
    kill: ((...args: unknown[]) => {
      calls.push(args);
      return true;
    }) as typeof process.kill,
  };
  return { proc, calls };
}

test('the guard refuses a kill of 0, a negative pid or the daemon itself, and logs each (M9 fix 732)', () => {
  const { proc, calls } = stubProc();
  const log = recordingLogger();
  guardSelfKill(proc, log);
  for (const pid of [0, -5, 9100, '9100']) {
    assert.throws(
      () => proc.kill(pid as number),
      (err: NodeJS.ErrnoException) => err.code === 'ESRCH' && err.syscall === 'kill',
      `kill(${JSON.stringify(pid)}) throws ESRCH`,
    );
  }
  assert.equal(calls.length, 0, 'no refused call reaches the real kill');
  assert.equal(log.lines.filter((l) => l === 'warn refused a kill of the daemon itself').length, 4);
});

test('the guard passes a liveness probe and any other pid through unchanged (M9 fix 732)', () => {
  const { proc, calls } = stubProc();
  const log = recordingLogger();
  guardSelfKill(proc, log);
  proc.kill(9100, 0);
  proc.kill(4242);
  proc.kill(4242, 'SIGTERM');
  assert.deepEqual(calls, [[9100, 0], [4242, undefined], [4242, 'SIGTERM']]);
  assert.equal(log.lines.length, 0);
});
