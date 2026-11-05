// M9 fix 1048: a kill of a remembered daemon pid asks processIdentity
// first, in cdp.mjs's helpers and in stop-daemon-worker.mjs's fallback.
// Windows only: the sleepers' start times are read through PowerShell and
// the worker's fallback is a taskkill.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStartedAt } from '@emerald/shared/process-identity';
import { daemonRecord, killDaemonIfSame } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = path.join(here, 'stop-daemon-worker.mjs');
const skip = process.platform !== 'win32' ? 'the worker and the start-time read are Windows-only here' : false;

const sleepers = [];
const tmpDirs = [];
after(() => {
  for (const c of sleepers) {
    if (c.exitCode === null && c.signalCode === null) {
      try {
        c.kill();
      } catch {
        // gone
      }
    }
  }
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-daemon-kill-'));
  tmpDirs.push(d);
  return d;
};

async function sleeper() {
  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  sleepers.push(c);
  await new Promise((r) => c.once('spawn', r));
  const real = readStartedAt(c.pid);
  assert.ok(real !== null, 'the sleeper has a start time');
  return { child: c, real };
}

const up = (c) => c.exitCode === null && c.signalCode === null;
const exited = (c, ms) => (up(c) ? Promise.race([new Promise((r) => c.once('exit', () => r(true))), new Promise((r) => setTimeout(() => r(false), ms))]) : Promise.resolve(true));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('daemon kills by identity', { skip }, () => {
  test('daemonRecord reads the pid and start time alone, or null', () => {
    const home = tmp();
    fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({ pid: 123, startedAt: 456, pipe: 'x' }));
    assert.deepEqual(daemonRecord(home), { pid: 123, startedAt: 456 });
    assert.equal(daemonRecord(tmp()), null);
  });

  test('killDaemonIfSame kills only the process the record names', async () => {
    const { child, real } = await sleeper();
    assert.equal(killDaemonIfSame({ pid: child.pid, startedAt: real - 60_000 }), 'other');
    await wait(500);
    assert.ok(up(child), 'a start time a minute off kills nothing');
    assert.equal(killDaemonIfSame({ pid: child.pid, startedAt: real }), 'same');
    assert.ok(await exited(child, 5000), 'the real start time kills it');
  });

  test("the worker's fallback kills only the daemon that started at startedAt", async () => {
    const { child, real } = await sleeper();
    const log = path.join(tmp(), 'logs', 'stop-daemon.log');
    const pipe = `\\\\.\\pipe\\emmerd-daemon-kill-test-${process.pid}`;
    spawnSync(process.execPath, [worker, String(child.pid), pipe, '', String(real - 60_000), log], { stdio: 'ignore', windowsHide: true, timeout: 30_000 });
    await wait(500);
    assert.ok(up(child), 'the worker left another process alone');
    let lines = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/);
    assert.match(lines.at(-1), /identity other, nothing killed$/);
    spawnSync(process.execPath, [worker, String(child.pid), pipe, '', String(real), log], { stdio: 'ignore', windowsHide: true, timeout: 30_000 });
    assert.ok(await exited(child, 5000), 'the worker killed the daemon it was named');
    lines = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/);
    assert.match(lines.at(-1), /identity same, tree killed$/);
  });
});
