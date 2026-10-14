import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../cli-error.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { captureOutput } from '../command.ts';
import command from './daemon.ts';

// A fake emmerd on a private pipe and a private home (M9 fix 494), in
// open.test.ts's shape: its hello names a live process that is not a
// daemon, with a start time that is not that process's, and it refuses
// daemon.stop, so `emmer daemon stop` reaches its kill.
const PIPE = `\\\\.\\pipe\\emmerd-test-daemon-${process.pid}`;

let server: net.Server;
let child: ChildProcess;
let home: string;
const sockets = new Set<net.Socket>();

before(async () => {
  home = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emmer-cli-daemon-'));
  process.env['EMERALD_HOME'] = home;
  process.env['EMERALD_PIPE'] = PIPE;
  child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
  const pid = child.pid ?? 0;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string };
        if (msg.type === 'hello') sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result: { daemonPid: pid, daemonStartedAt: 1, daemonVersion: 'fake', featureLevel: 57 } }));
        else sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error: { code: 'bad-request', message: `fake daemon does not do ${msg.type}` } }));
      }
    });
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sockets.delete(sock));
  });
  await new Promise<void>((resolve) => server.listen(PIPE, resolve));
});

after(() => {
  for (const sock of sockets) sock.destroy();
  server.close();
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('emmer daemon stop does not kill a pid that is not the daemon the hello named (M9 fix 494)', async () => {
  const restore = captureOutput(() => {});
  let err: unknown;
  try {
    await command.run(['stop']);
  } catch (e) {
    err = e;
  } finally {
    restore();
  }
  assert.ok(err instanceof CliError, `a CliError, got ${String(err)}`);
  assert.equal(err.message, `not killing pid ${child.pid}: it is not the daemon that was started at 1970-01-01T00:00:00.001Z`);
  assert.equal(alive(child.pid ?? 0), true, 'the unrelated process is still alive');
});

test('emmer daemon status names each set-aside store file (M9 fix 556)', async () => {
  const names = ['sessions.json.bad-2026-09-29T10-00-00.000Z', 'folders.json.bad-2026-09-29T10-00-01.000Z'];
  for (const name of names) fs.writeFileSync(path.join(home, name), '{not json');
  try {
    let text = '';
    let restore = captureOutput((t) => (text += t));
    try {
      await command.run(['status']);
    } finally {
      restore();
    }
    const lines = text.split(/\r?\n/).filter((l) => l !== '');
    assert.deepEqual(lines.slice(1), ['feed: none', 'set aside: folders.json.bad-2026-09-29T10-00-01.000Z', 'set aside: sessions.json.bad-2026-09-29T10-00-00.000Z'], text);
    let json = '';
    restore = captureOutput((t) => (json += t));
    try {
      await command.run(['status', '--json']);
    } finally {
      restore();
    }
    assert.deepEqual((JSON.parse(json) as { setAside: string[] }).setAside, [...names].sort());
  } finally {
    for (const name of names) fs.rmSync(path.join(home, name), { force: true });
  }
});
