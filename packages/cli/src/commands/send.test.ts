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
import { queuedLine } from '../mod-route.ts';
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
// M9 fix 995: the row the fake lists, and what its session.submit answers.
let listed: Partial<SessionInfo> = {};
let submitVia: 'mod' | 'typed' = 'mod';
// M9 fix 1001: the submit's reply says the mod queued the text.
let submitQueued = false;
const submits: string[] = [];
const sockets = new Set<net.Socket>();
let server: net.Server;

before(async () => {
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string; data?: string; text?: string };
        const reply = (result: unknown) => sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        if (msg.type === 'hello') reply({ daemonPid: 1, daemonVersion: 'fake', featureLevel: 99 });
        else if (msg.type === 'session.list') reply({ sessions: [{ ...session(), ...listed }] });
        else if (msg.type === 'pty.input') inputs.push(msg.data ?? '');
        else if (msg.type === 'session.submit') {
          submits.push(msg.text ?? '');
          reply({ via: submitVia, ...(submitQueued ? { queued: true } : {}) });
        }
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
  submits.length = 0;
  listed = {};
  submitVia = 'mod';
  submitQueued = false;
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

// M9 fix 995: a send into a Claude mid-turn says it is queued.
const MOD_WORDS = /^queued behind a turn running (under 1m|\d+m); it goes in when that turn ends$/;

test('queuedLine words a working Claude by its route and the turn age, and nothing else', () => {
  const now = 10 * 60_000;
  const working: SessionInfo = { ...session(), kind: 'claude', state: 'working', stateSince: now - 7.5 * 60_000 };
  assert.equal(queuedLine(working, 'mod', now), 'queued behind a turn running 7m; it goes in when that turn ends');
  assert.equal(queuedLine(working, 'typed', now), "queued into a turn running 7m; it goes in at the turn's next tool call, or when that turn ends");
  assert.equal(queuedLine({ ...working, stateSince: now - 30_000 }, 'mod', now), 'queued behind a turn running under 1m; it goes in when that turn ends');
  assert.equal(queuedLine({ ...working, stateSince: now - 60_000 }, 'mod', now), 'queued behind a turn running 1m; it goes in when that turn ends');
  assert.equal(queuedLine({ ...working, state: 'idle' }, 'mod', now), null);
  assert.equal(queuedLine({ ...working, state: 'waiting' }, 'mod', now), null);
  assert.equal(queuedLine({ ...working, kind: 'shell' }, 'mod', now), null);
});

// Part 2: a working Claude is typed whatever the mod would answer, with the
// Enter pause, so the line enters the turn at its next tool round.
test('send --enter to a working Claude makes no submit, types the text and Enter with the pause, and prints the typed form', async () => {
  listed = { kind: 'claude', state: 'working', stateSince: Date.now() - 7.5 * 60_000 };
  const t0 = Date.now();
  const out = await quietly(() => send.run(['alpha', 'hello', '--enter']));
  assert.deepEqual(submits, []);
  assert.deepEqual(inputs, ['hello', '\r']);
  assert.ok(Date.now() - t0 >= 1400, `took ${Date.now() - t0} ms`);
  assert.equal(out, "queued into a turn running 7m; it goes in at the turn's next tool call, or when that turn ends\n");
});

test('send --enter to an idle Claude or a working shell prints sent as before', async () => {
  listed = { kind: 'claude', state: 'idle' };
  let out = await quietly(() => send.run(['alpha', 'hello', '--enter']));
  assert.equal(out, 'sent "hello" + Enter to a1b2c3d4 alpha through the emerald mod\n');
  listed = { kind: 'shell', state: 'working', stateSince: Date.now() - 30_000 };
  out = await quietly(() => send.run(['alpha', 'dir', '--enter']));
  assert.equal(out, 'sent "dir" + Enter to a1b2c3d4 alpha\n');
  assert.doesNotMatch(out, MOD_WORDS);
});

// M9 fix 1001: the row read idle, but a turn started as the text was sent.
test('send --enter to an idle Claude whose submit the mod queued says it waits behind a turn', async () => {
  listed = { kind: 'claude', state: 'idle' };
  submitQueued = true;
  const out = await quietly(() => send.run(['alpha', 'hello', '--enter']));
  assert.equal(out, 'queued behind a turn that started as this was sent; it goes in when that turn ends\n');
});

test('send --interrupt --enter to a working Claude keeps sent, since its Ctrl+C ends the turn', async () => {
  listed = { kind: 'claude', state: 'working', stateSince: Date.now() - 30_000 };
  const out = await quietly(() => send.run(['alpha', 'hello', '--enter', '--interrupt']));
  assert.match(out, /^sent Ctrl\+C \+ "hello" \+ Enter to a1b2c3d4 alpha/);
});
