import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { UpdateState } from '@emerald/shared';
import { CliError, EXIT } from '../cli-error.ts';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { runUpdate } from './update.ts';

// A fake emmerd on a private pipe (M9 fix 271): answers hello at a
// chosen level, update.state off a script of states that each read
// advances through, and update.act by starting the next leg of the
// script, the way the real daemon's answer moves once the window has
// acted and reported. Enough to drive every mode without a window.
const PIPE = `\\\\.\\pipe\\emmerd-test-update-${process.pid}`;

let level = 49;
let apps = 1;
// The states a read walks through, the last one repeating; act() swaps
// in the leg keyed by the phase it was sent at.
let script: UpdateState[] = [];
let legs: Partial<Record<UpdateState['phase'], UpdateState[]>> = {};
const acts: string[] = [];
let server: net.Server;
const sockets = new Set<net.Socket>();

const s = (phase: UpdateState['phase'], over: Partial<UpdateState> = {}): UpdateState => ({ phase, current: '0.1.240', latest: '0.1.258', percent: null, message: null, ...over });

function current(): UpdateState | null {
  if (script.length === 0) return null;
  const head = script[0]!;
  if (script.length > 1) script.shift();
  return head;
}

before(async () => {
  process.env['EMERALD_PIPE'] = PIPE;
  server = net.createServer((sock) => {
    sockets.add(sock);
    const decoder = new JsonLinesDecoder();
    sock.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string };
        const reply = (result: unknown) => sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        if (msg.type === 'hello') reply({ daemonPid: 1, daemonVersion: 'fake', featureLevel: level });
        else if (msg.type === 'update.state') reply({ state: current(), apps });
        else if (msg.type === 'update.act') {
          const at = script[0]?.phase ?? 'none';
          acts.push(at);
          const leg = legs[at as UpdateState['phase']];
          if (leg !== undefined) script = [...leg];
          reply({ apps });
        } else sock.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error: { code: 'bad-request', message: `fake daemon does not do ${msg.type}` } }));
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
});

function scenario(states: UpdateState[], nextLegs: typeof legs = {}, over: { level?: number; apps?: number } = {}): string[] {
  script = [...states];
  legs = nextLegs;
  level = over.level ?? 49;
  apps = over.apps ?? 1;
  acts.length = 0;
  return [];
}

const fast = { pollMs: 5, checkTimeoutMs: 2000, downloadTimeoutMs: 2000 };

async function failure(run: Promise<unknown>): Promise<CliError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof CliError, `a CliError, got ${String(err)}`);
    return err;
  }
  assert.fail('expected the command to fail');
}

test('emmer update prints the state the daemon holds, and says when no window has reported', async () => {
  let lines = scenario([s('idle', { latest: null, message: 'checked 18:43, up to date' })]);
  assert.equal(await runUpdate([], { print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(lines, ['0.1.240 installed, checked 18:43, up to date']);
  lines = scenario([s('ready', { percent: 100 })], {}, { apps: 0 });
  assert.equal(await runUpdate([], { print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(lines, ['0.1.240 installed, 0.1.258 ready (no window open now)']);
  lines = scenario([]);
  assert.equal(await runUpdate([], { print: (l) => lines.push(l) }), EXIT.failure);
  assert.deepEqual(lines, ['no window has reported; open the Emerald app']);
});

test('--check acts once from idle and prints the phases through to available', async () => {
  const lines = scenario([s('idle', { latest: null })], { idle: [s('checking', { latest: null }), s('checking', { latest: null }), s('available')] });
  assert.equal(await runUpdate(['--check'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(acts, ['idle']);
  assert.deepEqual(lines, ['0.1.240 installed, not checked yet', '0.1.240 installed, checking the feed', '0.1.240 installed, 0.1.258 available']);
});

test('--check with the same answer as the last check returns once the count moves (M9 fix 539)', async () => {
  const upToDate = { latest: null, message: 'checked 18:43, up to date' };
  let lines = scenario([s('idle', { ...upToDate, checks: 1 })], { idle: [s('checking', { ...upToDate, checks: 1 }), s('idle', { ...upToDate, checks: 2 })] });
  assert.equal(await runUpdate(['--check'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(acts, ['idle']);
  assert.deepEqual(lines, ['0.1.240 installed, checked 18:43, up to date', '0.1.240 installed, checking the feed', '0.1.240 installed, checked 18:43, up to date']);
  // A local check answers inside one poll, so the checking phase is never
  // read; the answer still prints, though its words match the line before.
  lines = scenario([s('idle', { ...upToDate, checks: 1 })], { idle: [s('idle', { ...upToDate, checks: 2 })] });
  assert.equal(await runUpdate(['--check'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(lines, ['0.1.240 installed, checked 18:43, up to date', '0.1.240 installed, checked 18:43, up to date']);
  // A window that reports the count and never moves it has not answered.
  lines = scenario([s('idle', { ...upToDate, checks: 1 })], { idle: [s('checking', { ...upToDate, checks: 1 }), s('idle', { ...upToDate, checks: 1 })] });
  const slow = await failure(runUpdate(['--check'], { ...fast, checkTimeoutMs: 50, print: (l) => lines.push(l) }));
  assert.equal(slow.exitCode, EXIT.timeout);
});

test('--check on a state already past the check acts on nothing', async () => {
  const lines = scenario([s('available')]);
  assert.equal(await runUpdate(['--check'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(acts, []);
  assert.deepEqual(lines, ['0.1.240 installed, 0.1.258 available']);
});

test('--download acts through check and download and stops at ready; the percent prints by quarters', async () => {
  const lines = scenario([s('idle', { latest: null })], {
    idle: [s('checking', { latest: null }), s('available')],
    available: [s('downloading', { percent: 0 }), s('downloading', { percent: 10 }), s('downloading', { percent: 30 }), s('downloading', { percent: 80 }), s('ready', { percent: 100 })],
  });
  assert.equal(await runUpdate(['--download'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(acts, ['idle', 'available']);
  assert.deepEqual(lines, [
    '0.1.240 installed, not checked yet',
    '0.1.240 installed, checking the feed',
    '0.1.240 installed, 0.1.258 available',
    '0.1.240 installed, downloading 0.1.258 0%',
    '0.1.240 installed, downloading 0.1.258 30%',
    '0.1.240 installed, downloading 0.1.258 80%',
    '0.1.240 installed, 0.1.258 ready',
  ]);
});

test('--install sends the last click from ready and returns at once', async () => {
  const lines = scenario([s('ready', { percent: 100 })]);
  assert.equal(await runUpdate(['--install'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(acts, ['ready']);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '0.1.240 installed, 0.1.258 ready');
  assert.match(lines[1]!, /^installing 0\.1\.258: the window closes, the daemon stops/);
});

test('--install from idle with nothing newer says so; an error phase fails; a timeout is exit 2', async () => {
  let lines = scenario([s('idle', { latest: null })], { idle: [s('idle', { latest: '0.1.240', message: 'checked 18:43, up to date' })] });
  assert.equal(await runUpdate(['--install'], { ...fast, print: (l) => lines.push(l) }), EXIT.ok);
  assert.deepEqual(lines, ['0.1.240 installed, not checked yet', '0.1.240 installed, checked 18:43, up to date', 'nothing to download']);
  lines = scenario([s('available')], { available: [s('error', { message: 'sha512 checksum mismatch' })] });
  const err = await failure(runUpdate(['--download'], { ...fast, print: (l) => lines.push(l) }));
  assert.equal(err.message, 'update failed: sha512 checksum mismatch');
  lines = scenario([s('idle', { latest: null })], { idle: [s('checking', { latest: null })] });
  const slow = await failure(runUpdate(['--check'], { ...fast, checkTimeoutMs: 50, print: (l) => lines.push(l) }));
  assert.equal(slow.exitCode, EXIT.timeout);
});

test('no window on the topic, an old daemon and two modes at once are refused', async () => {
  scenario([s('available')], {}, { apps: 0 });
  const none = await failure(runUpdate(['--check'], fast));
  assert.equal(none.message, 'no window open; open the Emerald app');
  assert.equal(none.exitCode, EXIT.noWindow);
  scenario([s('available')], {}, { level: 48 });
  assert.match((await failure(runUpdate([], fast))).message, /older than emmer update \(level 48, needs 49\)/);
  scenario([s('available')]);
  assert.equal((await failure(runUpdate(['--check', '--install'], fast))).exitCode, EXIT.usage);
});
