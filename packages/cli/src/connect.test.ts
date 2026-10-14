import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './cli-error.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { tryConnect } from './connect.ts';

// M9 fix 612: the CLI's hello carries daemon.json's pipeToken, and a token
// refusal is tried once more at once when the file now holds another one.
// A stand-in emmerd on a private pipe and home, in daemon.test.ts's shape,
// that records each hello and answers as the test says.
const PIPE = `\\\\.\\pipe\\emmerd-test-connect-${process.pid}`;

let server: net.Server;
let home: string;
const sockets = new Set<net.Socket>();
let hellos: Array<Record<string, unknown>> = [];
// Answers the nth hello (0-based): a reply's error, or null for ok.
let answer: (n: number) => { code: string; message: string } | null = () => null;
// Runs before the nth hello's answer, so a test can rewrite the file the
// way a starting daemon does between the claim and the attach.
let beforeAnswer: (n: number) => void = () => {};

before(async () => {
  home = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emmer-cli-connect-'));
  process.env['EMERALD_HOME'] = home;
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string } & Record<string, unknown>;
        if (msg.type !== 'hello') continue;
        const n = hellos.length;
        hellos.push(msg);
        beforeAnswer(n);
        const error = answer(n);
        if (error === null) {
          sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result: { daemonPid: process.pid, daemonVersion: 'fake', home } }));
        } else {
          sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error }));
          sock.end();
        }
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
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  hellos = [];
  answer = () => null;
  beforeAnswer = () => {};
  fs.rmSync(path.join(home, 'daemon.json'), { force: true });
});

const writeToken = (token: string): void => {
  fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({ pid: 1, pipe: PIPE, pipeToken: token, hookPort: 1, hookToken: 'x' }, null, 2) + '\n');
};

test('the hello carries daemon.json\'s pipeToken (M9 fix 612)', async () => {
  writeToken('d'.repeat(64));
  const open = await tryConnect();
  assert.ok(open !== null);
  open.client.close();
  assert.equal(hellos.length, 1);
  assert.equal(hellos[0]!['token'], 'd'.repeat(64));
});

test('with no daemon.json the hello has no token key (M9 fix 612)', async () => {
  const open = await tryConnect();
  assert.ok(open !== null);
  open.client.close();
  assert.equal(hellos.length, 1);
  assert.equal('token' in hellos[0]!, false);
});

test('a token-required refusal while the file is written is tried again at once with the new token (M9 fix 612)', async () => {
  answer = (n) => (n === 0 ? { code: 'token-required', message: 'hello without a token' } : null);
  beforeAnswer = (n) => {
    if (n === 0) writeToken('e'.repeat(64));
  };
  const open = await tryConnect();
  assert.ok(open !== null);
  open.client.close();
  assert.equal(hellos.length, 2);
  assert.equal('token' in hellos[0]!, false);
  assert.equal(hellos[1]!['token'], 'e'.repeat(64));
});

test('a bad-token refusal with the same token still in the file stands after one connection (M9 fix 612)', async () => {
  writeToken('f'.repeat(64));
  answer = () => ({ code: 'bad-token', message: 'hello token does not match' });
  await assert.rejects(tryConnect(), (err: unknown) => err instanceof CliError && err.message === 'emmerd refused the connection: hello token does not match');
  assert.equal(hellos.length, 1);
});
