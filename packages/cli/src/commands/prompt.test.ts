import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { SessionInfo } from '@emerald/shared';
import { CliError, EXIT } from '../cli-error.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { runPrompt } from './prompt.ts';

// A fake emmerd on a private pipe: answers hello, subscribe and
// session.list, records pty.input, and runs a per-test script when the
// Enter arrives, which pushes session.changed the way the real daemon
// would as hooks come in. Enough to drive both of prompt's gates without
// a PTY or a Claude.
const PIPE = `\\\\.\\pipe\\emmerd-test-prompt-${process.pid}`;

type Push = (session: SessionInfo) => void;
let onEnter: (push: Push) => void = () => {};
let sessions: SessionInfo[] = [];
const inputs: string[] = [];
const submits: { sessionId: string; text: string }[] = [];
let modVia: 'mod' | 'typed' = 'mod';
const sockets = new Set<net.Socket>();
let server: net.Server;

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    kind: 'shell',
    name: 'fix-login',
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
    ...over,
  };
}

const push: Push = (s) => {
  for (const sock of sockets) sock.write(encodeJsonLine({ type: 'session.changed', session: s }));
};

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
        else if (msg.type === 'subscribe') reply({});
        else if (msg.type === 'session.list') reply({ sessions });
        else if (msg.type === 'pty.input') {
          inputs.push(msg.data ?? '');
          if (msg.data === '\r') onEnter(push);
        } else if (msg.type === 'session.submit') {
          // M9 fix 741: the mod's channel up ('mod') or not ('typed').
          submits.push(raw as { sessionId: string; text: string });
          reply({ via: modVia });
          if (modVia === 'mod') onEnter(push);
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
});

function scenario(state: SessionInfo['state'], script: (push: Push) => void, over: Partial<SessionInfo> = {}): void {
  sessions = [session({ state, ...over })];
  inputs.length = 0;
  submits.length = 0;
  modVia = 'mod';
  onEnter = script;
}

async function failure(run: Promise<unknown>): Promise<CliError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof CliError, `a CliError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected the prompt to fail');
}

test('the happy path: the text and Enter go in, working then done come back, the reply is the first line', async () => {
  scenario('idle', (push) => {
    push(session({ state: 'working', lastPrompt: 'fix it' }));
    setTimeout(() => push(session({ state: 'done', lastPrompt: 'fix it', lastReply: 'Fixed.' })), 50);
  });
  const out = await runPrompt({ ref: 'fix-login', text: 'fix it', force: false, timeoutMs: 5000 });
  assert.equal(out.kind, 'done');
  assert.equal(out.kind === 'done' && out.reply, 'Fixed.');
  assert.deepEqual(inputs, ['fix it', '\r']);
});

test('a done session takes a new prompt, and a reply that lands as needs-input is reported as such', async () => {
  scenario('done', (push) => {
    push(session({ state: 'working' }));
    setTimeout(() => push(session({ state: 'needs-input', needsInputReason: 'permission' })), 30);
  });
  const out = await runPrompt({ ref: 'a1b2c3d4', text: 'go', force: false, timeoutMs: 5000 });
  assert.equal(out.kind, 'needs-input');
  assert.equal(out.session.needsInputReason, 'permission');
});

test('gate one: a session that needs input is refused with exit 1 and nothing is sent', async () => {
  scenario('needs-input', () => assert.fail('nothing should be sent'), { needsInputReason: 'question' });
  const err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 1000 }));
  assert.equal(err.exitCode, EXIT.failure);
  assert.match(err.message, /needs input: a question; answer it first, or --force/);
  assert.deepEqual(inputs, []);
});

test('--force sends to a session that needs input and waits like any other', async () => {
  scenario(
    'needs-input',
    (push) => {
      push(session({ state: 'working' }));
      setTimeout(() => push(session({ state: 'done', lastReply: 'Allowed and done.' })), 30);
    },
    { needsInputReason: 'permission' },
  );
  const out = await runPrompt({ ref: 'fix-login', text: 'y', force: true, timeoutMs: 5000 });
  assert.equal(out.kind, 'done');
  assert.deepEqual(inputs, ['y', '\r']);
});

test('gate two: no working after the send is stalled, exit 3', async () => {
  scenario('idle', () => {});
  const err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 5000, stallMs: 200 }));
  assert.equal(err.exitCode, EXIT.stalled);
  assert.match(err.message, /did not start working within 200 ms; the text may be sitting in its input box/);
});

test('a change that is not the state does not count as moving', async () => {
  scenario('idle', (push) => push(session({ state: 'idle', branch: 'main' })));
  const err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 5000, stallMs: 200 }));
  assert.equal(err.exitCode, EXIT.stalled);
});

test('the reply timing out is exit 2, as wait', async () => {
  scenario('idle', (push) => push(session({ state: 'working' })));
  const err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 200 }));
  assert.equal(err.exitCode, EXIT.timeout);
  assert.match(err.message, /timed out after 200 ms waiting for the reply/);
});

test('a session already working is taken as moving, and M30 waiting is still working', async () => {
  scenario('working', (push) => {
    // A pushed change to waiting keeps the second wait going; done ends it.
    push(session({ state: 'waiting' as SessionInfo['state'] }));
    setTimeout(() => push(session({ state: 'done', lastReply: 'All done.' })), 30);
  });
  const out = await runPrompt({ ref: 'fix-login', text: 'and then', force: false, timeoutMs: 5000, stallMs: 100 });
  assert.equal(out.kind, 'done');
  assert.equal(out.kind === 'done' && out.reply, 'All done.');
});

test('an exited session is refused, and one that exits while waiting is exit 1', async () => {
  scenario('exited', () => assert.fail('nothing should be sent'));
  let err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 1000 }));
  assert.match(err.message, /has exited; resume it first/);
  scenario('idle', (push) => {
    push(session({ state: 'working' }));
    setTimeout(() => push(session({ state: 'exited', exitCode: 1 })), 30);
  });
  err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 5000 }));
  assert.equal(err.exitCode, EXIT.failure);
  assert.match(err.message, /fix-login exited \(1\) after \d+ ms/);
});

test('an errored turn is exit 1 with the error', async () => {
  scenario('idle', (push) => {
    push(session({ state: 'working' }));
    setTimeout(() => push(session({ state: 'errored', errorType: 'rate_limit' })), 30);
  });
  const err = await failure(runPrompt({ ref: 'fix-login', text: 'go', force: false, timeoutMs: 5000 }));
  assert.equal(err.exitCode, EXIT.failure);
  assert.match(err.message, /errored: rate_limit after \d+ ms/);
});

function turns(push: Push): void {
  push(session({ kind: 'claude', state: 'working' }));
  setTimeout(() => push(session({ kind: 'claude', state: 'done', lastReply: 'Done.' })), 30);
}

test("a Claude session whose channel is up: one session.submit with the text, no pty.input and no 1.5 s pause (M9 fix 741)", async () => {
  scenario('idle', turns, { kind: 'claude' });
  const t0 = Date.now();
  const out = await runPrompt({ ref: 'fix-login', text: 'fix it', force: false, timeoutMs: 5000 });
  assert.deepEqual(submits.map((s) => s.text), ['fix it']);
  assert.deepEqual(inputs, []);
  assert.equal(out.via, 'mod');
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test('a channel that is not up types as before (M9 fix 741)', async () => {
  scenario('idle', turns, { kind: 'claude' });
  modVia = 'typed';
  const out = await runPrompt({ ref: 'fix-login', text: 'fix it', force: false, timeoutMs: 5000 });
  assert.deepEqual(inputs, ['fix it', '\r']);
  assert.equal(out.via, 'typed');
});

test('--force to a session that needs input is typed, never submitted (M9 fix 741)', async () => {
  scenario('needs-input', turns, { kind: 'claude', needsInputReason: 'permission' });
  const out = await runPrompt({ ref: 'fix-login', text: 'y', force: true, timeoutMs: 5000 });
  assert.deepEqual(submits, []);
  assert.deepEqual(inputs, ['y', '\r']);
  assert.equal(out.via, 'typed');
});

test('a slash command is typed (M9 fix 741)', async () => {
  scenario('idle', turns, { kind: 'claude' });
  await runPrompt({ ref: 'fix-login', text: '/compact', force: false, timeoutMs: 5000 });
  assert.deepEqual(submits, []);
  assert.deepEqual(inputs, ['/compact', '\r']);
});

test('--if-idle refuses a working session, exit 1, and sends nothing (M9 fix 741)', async () => {
  scenario('working', () => assert.fail('nothing should be sent'), { kind: 'claude' });
  const err = await failure(runPrompt({ ref: 'fix-login', text: 'more', force: false, timeoutMs: 1000, ifIdle: true }));
  assert.equal(err.exitCode, EXIT.failure);
  assert.match(err.message, /fix-login is working; --if-idle sends only to a session that is not working/);
  assert.deepEqual(submits, []);
  assert.deepEqual(inputs, []);
});
