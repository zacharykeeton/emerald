import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from './log.ts';
import { guardSelfKill, readProcessLine } from './kill-guard.ts';

function recordingLogger(): Logger & { lines: string[]; extras: unknown[] } {
  const lines: string[] = [];
  const extras: unknown[] = [];
  const keep = (level: string) => (msg: string, extra?: unknown) => {
    lines.push(`${level} ${msg}`);
    extras.push(extra);
  };
  return { lines, extras, info: keep('info'), warn: keep('warn'), error: keep('error') };
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

test('with a trace every kill but a probe is logged with its target first (M9 fix 762)', () => {
  const { proc, calls } = stubProc();
  const log = recordingLogger();
  const traced: number[] = [];
  guardSelfKill(proc, log, (pid) => {
    traced.push(pid);
    return '9000 node.exe node child.js';
  });
  proc.kill(4242);
  proc.kill(4242, 'SIGTERM');
  assert.deepEqual(calls, [[4242, undefined], [4242, 'SIGTERM']]);
  assert.deepEqual(log.lines, ['info kill traced', 'info kill traced']);
  for (const [i, signal] of [undefined, 'SIGTERM'].entries()) {
    const extra = log.extras[i] as Record<string, unknown>;
    assert.equal(extra['pid'], 4242);
    assert.equal(extra['signal'], signal);
    assert.equal(extra['target'], '9000 node.exe node child.js');
    assert.equal(typeof extra['readMs'], 'number');
    assert.equal(typeof extra['stack'], 'string');
  }

  proc.kill(4242, 0);
  assert.equal(calls.length, 3, 'the probe reaches the real kill');
  assert.equal(log.lines.length, 2, 'a probe leaves no trace line');
  assert.deepEqual(traced, [4242, 4242], 'and is not traced');

  assert.throws(() => proc.kill(0), (err: NodeJS.ErrnoException) => err.code === 'ESRCH');
  assert.deepEqual(log.lines.slice(2), ['info kill traced', 'warn refused a kill of the daemon itself']);
  assert.equal(calls.length, 3, 'the refused kill does not reach the real one');
});

test('readProcessLine names this process by its parent and image (M9 fix 762)', () => {
  const line = readProcessLine(process.pid);
  assert.ok(line !== null && line.startsWith(`${process.ppid} node.exe `), `got ${JSON.stringify(line)}`);
});
