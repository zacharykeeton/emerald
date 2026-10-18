import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { SessionInfo } from '@emerald/shared';
import { stdinText } from '../args.ts';
import { CliError, EXIT } from '../cli-error.ts';
import { captureOutput } from '../command.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import set, { sessionRefFor } from './set.ts';

// M9 fix 351: `emmer set` with no <session> is the session it runs in, off
// EMERALD_SESSION_ID, which the daemon stamps on every pty. The pure resolver
// first, then the command end to end against a fake emmerd on a private
// pipe in prompt.test's shape: it answers hello, subscribe, session.list
// and session.set, and records which session the set named.
const PIPE = `\\\\.\\pipe\\emmerd-test-set-${process.pid}`;
const OWN = 'a1b2c3d4-0000-4000-8000-000000000001';
const OTHER = 'ffffffff-0000-4000-8000-000000000002';

function session(id: string, name: string): SessionInfo {
  return {
    id,
    kind: 'shell',
    name,
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

const sets: { sessionId: string; comment?: string | null; keepWhole?: boolean }[] = [];
const sockets = new Set<net.Socket>();
let server: net.Server;
const savedEnv = process.env['EMERALD_SESSION_ID'];

before(async () => {
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string; sessionId?: string; comment?: string | null; keepWhole?: boolean };
        const reply = (result: unknown) => sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        if (msg.type === 'hello') reply({ daemonPid: 1, daemonVersion: 'fake', featureLevel: 99 });
        else if (msg.type === 'subscribe') reply({});
        else if (msg.type === 'session.list') reply({ sessions: [session(OTHER, 'other'), session(OWN, 'me')] });
        else if (msg.type === 'session.set') {
          sets.push({ sessionId: msg.sessionId ?? '', comment: msg.comment, ...(msg.keepWhole === undefined ? {} : { keepWhole: msg.keepWhole }) });
          reply({});
        } else sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error: { code: 'bad-request', message: `fake daemon does not do ${msg.type}` } }));
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
  if (savedEnv === undefined) delete process.env['EMERALD_SESSION_ID'];
  else process.env['EMERALD_SESSION_ID'] = savedEnv;
});

test('sessionRefFor: a named session wins, the own id fills in, and neither is a usage error', () => {
  assert.equal(sessionRefFor('beta', { EMERALD_SESSION_ID: OWN }), 'beta');
  assert.equal(sessionRefFor(undefined, { EMERALD_SESSION_ID: OWN }), OWN);
  for (const env of [{}, { EMERALD_SESSION_ID: '' }, { EMERALD_SESSION_ID: '  ' }]) {
    assert.throws(
      () => sessionRefFor(undefined, env),
      (err: unknown) => err instanceof CliError && err.exitCode === EXIT.usage && err.message === 'not inside emerald (EMERALD_SESSION_ID is not set); name a session',
    );
  }
});

test('emmer set --comment with no session writes the checkpoint on the session it runs in', async () => {
  process.env['EMERALD_SESSION_ID'] = OWN;
  sets.length = 0;
  await set.run(['--comment', 'checkpoint', '--json']);
  assert.deepEqual(sets, [{ sessionId: OWN, comment: 'checkpoint' }]);
});

test('a named session still wins over the environment', async () => {
  process.env['EMERALD_SESSION_ID'] = OWN;
  sets.length = 0;
  await set.run(['other', '--comment', 'theirs', '--json']);
  assert.deepEqual(sets, [{ sessionId: OTHER, comment: 'theirs' }]);
});

test('outside emerald with no session named, the usage error says so before any pipe is touched', async () => {
  delete process.env['EMERALD_SESSION_ID'];
  sets.length = 0;
  await assert.rejects(set.run(['--comment', 'checkpoint']), (err: unknown) => err instanceof CliError && err.exitCode === EXIT.usage && /not inside emerald \(EMERALD_SESSION_ID is not set\); name a session/.test(err.message));
  assert.deepEqual(sets, []);
});

test('--keep-whole takes on or off, sends the mark in its session.set, and anything else is a usage error before any pipe is touched (M9 fix 773)', async () => {
  process.env['EMERALD_SESSION_ID'] = OWN;
  sets.length = 0;
  await assert.rejects(set.run(['--keep-whole', 'maybe']), (err: unknown) => err instanceof CliError && err.exitCode === EXIT.usage && err.message === '--keep-whole must be on or off, got "maybe"');
  assert.deepEqual(sets, []);
  await set.run(['--keep-whole', 'on', '--json']);
  assert.equal(sets.length, 1);
  assert.equal(sets[0]!.sessionId, OWN);
  assert.equal(sets[0]!.keepWhole, true);
  await set.run(['--keep-whole', 'off', '--json']);
  assert.equal(sets[1]!.keepWhole, false);
});

// M9 fix 855: the comment from stdin or a file, verbatim.
test('--comment-stdin and --comment-file write the comment verbatim, and any two comment options are refused', async () => {
  process.env['EMERALD_SESSION_ID'] = OWN;
  sets.length = 0;
  const restoreOut = captureOutput(() => {});
  try {
    const restore = stdinText('reproduced 100%PATH%\n');
    try {
      await set.run(['--comment-stdin', '--json']);
    } finally {
      restore();
    }
    assert.deepEqual(sets.at(-1), { sessionId: OWN, comment: 'reproduced 100%PATH%' });
    const file = path.join(os.tmpdir(), `emmer-set-comment-${process.pid}.txt`);
    fs.writeFileSync(file, 'reproduced 100%PATH%\r\n');
    try {
      await set.run(['--comment-file', file, '--json']);
    } finally {
      fs.rmSync(file, { force: true });
    }
    assert.deepEqual(sets.at(-1), { sessionId: OWN, comment: 'reproduced 100%PATH%' });
  } finally {
    restoreOut();
  }
  const before = sets.length;
  for (const [argv, message] of [
    [['--comment', 'x', '--comment-stdin'], '--comment and --comment-stdin together'],
    [['--comment-stdin', '--clear-comment'], '--comment-stdin and --clear-comment together'],
    [['--comment', 'x', '--clear-comment'], '--comment and --clear-comment together'],
  ] as const) {
    await assert.rejects(set.run([...argv]), (err: unknown) => err instanceof CliError && err.exitCode === EXIT.usage && err.message === message);
  }
  assert.equal(sets.length, before);
});
