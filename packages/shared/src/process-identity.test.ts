import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { START_TOLERANCE_MS, killTree, parseElapsed, parsePsTable, processIdentity, processIdentityAsync, readStartAsync, startFrom, treeOf } from './process-identity.ts';
import type { ReaperProbes, StartRead } from './process-identity.ts';

const probes = (alive: boolean, startedAt: StartRead): ReaperProbes => ({ alive: () => alive, startedAt: () => startedAt });

test('a pid is the same process, gone, or somebody else (M9 fix 494)', () => {
  const started = 1_700_000_000_000;
  assert.equal(processIdentity(1234, started, probes(true, started)), 'same');
  assert.equal(processIdentity(1234, started, probes(true, started + START_TOLERANCE_MS - 1)), 'same', 'inside the tolerance');
  assert.equal(processIdentity(1234, started, probes(true, started + 60_000)), 'other', 'a reused pid, the new process younger');
  assert.equal(processIdentity(1234, started, probes(true, started - 60_000)), 'other', 'a reused pid, the new process older');
  assert.equal(processIdentity(1234, started, probes(false, started)), 'gone', 'nothing holds the pid');
  assert.equal(processIdentity(1234, started, probes(true, null)), 'gone', 'the read found no process');
  assert.equal(processIdentity(1234, started, probes(true, 'unknown')), 'unknown', 'the read timed out or failed');
  assert.equal(processIdentity(Number.NaN, started, probes(true, started)), 'gone', 'a pid that is not a number');
});

test('a start-time read that times out or fails is unknown, not gone (M9 fix 1109)', () => {
  assert.equal(startFrom('', true, 'win32'), 'unknown');
  assert.equal(startFrom('1700000000000', true, 'win32'), 'unknown', 'a failed read is never trusted');
  assert.equal(startFrom('', false, 'win32'), null);
  assert.equal(startFrom(' \r\n', false, 'win32'), null);
  assert.equal(startFrom('1700000000000\r\n', false, 'win32'), 1_700_000_000_000);
  assert.equal(startFrom('Get-CimInstance : Access denied', false, 'win32'), 'unknown');
  assert.equal(startFrom('', false, 'linux'), null);
  assert.equal(startFrom('soon', false, 'darwin'), 'unknown');
  const r = startFrom('01:57\n', false, 'linux');
  assert.equal(typeof r, 'number');
  assert.ok(Math.abs((r as number) - (Date.now() - 117_500)) < 1000);
});

test('readStartAsync: a probe that never answers is unknown at its timeout (M9 fix 1109)', async () => {
  const t0 = Date.now();
  assert.equal(await readStartAsync(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], 'win32', 300), 'unknown');
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.equal(await readStartAsync('emerald-no-such-command-1109', [], 'win32', 2000), 'unknown');
  assert.equal(await readStartAsync(process.execPath, ['-e', 'process.stdout.write("1700000000000")'], 'win32', 10_000), 1_700_000_000_000);
  assert.equal(await readStartAsync(process.execPath, ['-e', ''], 'win32', 10_000), null);
});

test('this process reads as itself, through the real probes, sync and async (M9 fix 494)', async () => {
  const startedAt = Date.now() - process.uptime() * 1000;
  assert.equal(processIdentity(process.pid, startedAt), 'same');
  assert.equal(await processIdentityAsync(process.pid, startedAt), 'same');
  assert.equal(await processIdentityAsync(process.pid, 1), 'other', 'the epoch is not when this process started');
});

// M9 fix 1016: off Windows the tree comes from one `ps -A -o pid=,ppid=`.
test('parsePsTable reads ps rows and treeOf walks a pid\'s descendants in post order', () => {
  const rows = parsePsTable('  1 0\n 10 1\n 11 10\n 12 10\n 13 11\n 20 1\nnot a row\n');
  assert.deepEqual(rows, [
    { pid: 1, ppid: 0 },
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 10 },
    { pid: 13, ppid: 11 },
    { pid: 20, ppid: 1 },
  ]);
  assert.deepEqual(treeOf(10, rows), [13, 11, 12, 10]);
  assert.deepEqual(treeOf(99, rows), [99], 'a pid with no row is itself alone');
  assert.deepEqual(treeOf(5, parsePsTable('5 6\n6 5\n')), [6, 5], 'a loop ends');
});

test("parseElapsed reads ps's etime as seconds", () => {
  assert.equal(parseElapsed('      01:57\n'), 117);
  assert.equal(parseElapsed('02:03:04'), 7384);
  assert.equal(parseElapsed('1-02:03:04'), 93784);
  assert.equal(parseElapsed(''), null);
  assert.equal(parseElapsed('soon'), null);
});

test('killTree kills a child and its grandchild off Windows (M9 fix 1016)', { skip: process.platform === 'win32' }, async () => {
  const marker = `emerald-killtree-${randomUUID()}`;
  // The child spawns a grandchild, both carrying the marker, and both sleep.
  const grand = `setInterval(() => {}, 1000)`;
  const childCode = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grand)}, ${JSON.stringify(marker)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['-e', childCode, marker], { stdio: 'ignore' });
  const holders = (): string[] =>
    (spawnSync('ps', ['-A', '-ww', '-o', 'args='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).stdout ?? '')
      .split('\n')
      .filter((l) => l.includes(marker));
  // Wait for both to be up before the kill, by the marker, never the bare pid.
  for (let i = 0; i < 100 && holders().length < 2; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(holders().length, 2, 'the child and the grandchild are up');
  assert.equal(killTree(child.pid!), null);
  let left = holders();
  for (let i = 0; i < 40 && left.length > 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
    left = holders();
  }
  assert.deepEqual(left, [], 'nothing holding the marker is left');
});
