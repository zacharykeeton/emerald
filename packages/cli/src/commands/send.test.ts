import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { SessionInfo } from '@emerald/shared';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { stdinText } from '../args.ts';
import { CliError, EXIT } from '../cli-error.ts';
import { captureOutput } from '../command.ts';
import send from './send.ts';

// M9 fix 855: emmer send takes its text from stdin or a file, verbatim.
// A fake emmerd on a private pipe in prompt.test's shape: hello, one shell
// session named alpha in the list, and every pty.input recorded.
const PIPE = `\\\\.\\pipe\\emmerd-test-send-${process.pid}`;

function session(): SessionInfo {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    kind: 'shell',
    name: 'alpha',
    autoName: false,
    spawnCwd: 'C:\\work',
    args: [],
    cwd: 'C:\\work',
    groupCwd: 'C:\\work',
    branch: null,
    lastPrompt: null,
    lastReply: null,
    state: 'idle',
    stateSince: 0,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    conversation: null,
    shellCwd: null,
    commits: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    color: '#61afef',
    claudeSessionId: null,
    pid: 1,
    exitCode: null,
    createdAt: 0,
  };
}

const inputs: string[] = [];
const sockets = new Set<net.Socket>();
let server: net.Server;

before(async () => {
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string; data?: string };
        const reply = (result: unknown) => sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        if (msg.type === 'hello') reply({ daemonPid: 1, daemonVersion: 'fake', featureLevel: 99 });
        else if (msg.type === 'session.list') reply({ sessions: [session()] });
        else if (msg.type === 'pty.input') inputs.push(msg.data ?? '');
        else sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error: { code: 'bad-request', message: `fake daemon does not do ${msg.type}` } }));
      }
    });
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sockets.delete(sock));
  });
  await new Promise<void>((resolve) => server.listen(PIPE, resolve));
});

after(() => {
  for (const s of sockets) s.destroy();
  server.close();
});

beforeEach(() => {
  inputs.length = 0;
});

async function quietly(run: () => Promise<unknown>): Promise<string> {
  let out = '';
  const restore = captureOutput((text) => {
    out += text;
  });
  try {
    await run();
  } finally {
    restore();
  }
  return out;
}

async function failure(run: Promise<unknown>): Promise<CliError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof CliError, `a CliError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected the send to fail');
}

test('send --stdin types the piped text less its trailing newline, a % kept, then Enter', async () => {
  const restore = stdinText('echo 100%PATH%\r\n');
  let out: string;
  try {
    out = await quietly(() => send.run(['alpha', '--stdin', '--enter']));
  } finally {
    restore();
  }
  assert.deepEqual(inputs, ['echo 100%PATH%', '\r']);
  assert.match(out, /^sent "echo 100%PATH%" \+ Enter to a1b2c3d4 alpha\n$/);
});

test('send --file types the file text verbatim, a double quote kept, with no Enter', async () => {
  const file = path.join(os.tmpdir(), `emmer-send-${process.pid}.txt`);
  fs.writeFileSync(file, 'a "b"\n');
  try {
    await quietly(() => send.run(['alpha', '--file', file]));
  } finally {
    fs.rmSync(file, { force: true });
  }
  assert.deepEqual(inputs, ['a "b"']);
});

test('send with text words and --stdin is a usage error, and an empty --stdin is the missing text error', async () => {
  let err = await failure(send.run(['alpha', 'hi', '--stdin']));
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'text and --stdin together');
  const restore = stdinText('');
  try {
    err = await failure(send.run(['alpha', '--stdin']));
  } finally {
    restore();
  }
  assert.equal(err.exitCode, EXIT.usage);
  assert.equal(err.message, 'missing text (or pass --enter alone to press Enter, --interrupt for Ctrl+C)');
  assert.deepEqual(inputs, []);
});
