import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { HostAsk, RemoteHost, SessionInfo } from '@emerald/shared';
import { answerHostAsk, wireCliHostRelay, type CliHostDeps } from './cli-host-relay.ts';
import { encodeRequestError } from './request-error.ts';

const session = { id: 'remote-1', kind: 'shell', name: 'x', host: 'stub' } as unknown as SessionInfo;
const stub: RemoteHost = { name: 'stub', destination: 'stub', addedAt: 1, source: 'added', home: 'C:\\Users\\v', shell: 'powershell' };

function spawnAsk(cwd: string): HostAsk {
  return { type: 'session.spawn', body: { kind: 'shell', cwd, cols: 80, rows: 24 } };
}

// Fakes for main's host side, recording what reached them.
function fakeDeps(over: Partial<CliHostDeps> = {}): CliHostDeps & { connected: string[]; spawned: Array<{ host: string; cwd: string }>; listed: unknown[] } {
  const connected: string[] = [];
  const spawned: Array<{ host: string; cwd: string }> = [];
  const listed: unknown[] = [];
  return {
    connected,
    spawned,
    listed,
    hosts: async () => [stub],
    connect: async (h) => { connected.push(h); },
    record: () => stub,
    spawn: async (host, body) => { spawned.push({ host, cwd: body.cwd }); return { session }; },
    list: async (_host, body) => { listed.push(body); return { sessions: [session] }; },
    log: () => {},
    ...over,
  };
}

test('a list ask reaches list after the connect and answers its sessions; a refusal is its line (M9 fix 1168)', async () => {
  const d = fakeDeps();
  assert.deepEqual(await answerHostAsk('stub', { type: 'session.list', body: {} }, d), { sessions: [session] });
  assert.deepEqual(d.connected, ['stub']);
  assert.deepEqual(d.listed, [{}]);
  const late = fakeDeps({ list: async () => { throw new Error('stub did not answer'); } });
  assert.deepEqual(await answerHostAsk('stub', { type: 'session.list', body: {} }, late), { error: 'stub did not answer' });
});

test('an unknown host is named with the hosts the window lists, and never connected (M9 fix 1167)', async () => {
  const d = fakeDeps();
  assert.deepEqual(await answerHostAsk('nosuch', spawnAsk('~'), d), { error: 'no host named nosuch; the window lists stub' });
  assert.deepEqual(d.connected, []);
  const none = fakeDeps({ hosts: async () => [] });
  assert.deepEqual(await answerHostAsk('nosuch', spawnAsk('~'), none), { error: 'no host named nosuch; the window lists none' });
});

test('~/proj is the record\'s home in the host\'s spelling, and the session comes back (M9 fix 1167)', async () => {
  const d = fakeDeps();
  assert.deepEqual(await answerHostAsk('stub', spawnAsk('~/proj'), d), { session });
  assert.deepEqual(d.connected, ['stub']);
  assert.deepEqual(d.spawned, [{ host: 'stub', cwd: 'C:\\Users\\v\\proj' }]);
});

test('~ on a record with no home yet is refused before any spawn (M9 fix 1167)', async () => {
  const bare: RemoteHost = { name: 'stub', destination: 'stub', addedAt: 1, source: 'added' };
  const d = fakeDeps({ record: () => bare });
  assert.deepEqual(await answerHostAsk('stub', spawnAsk('~'), d), { error: 'stub\'s home folder is not known yet; give an absolute folder' });
  assert.deepEqual(d.spawned, []);
});

test('a coded error from the host and a refused connect are one line each (M9 fix 1167)', async () => {
  const coded = fakeDeps({
    spawn: async () => { throw encodeRequestError(Object.assign(new Error('cwd does not exist: /x'), { code: 'bad-request' })); },
  });
  assert.deepEqual(await answerHostAsk('stub', spawnAsk('/x'), coded), { error: 'stub: cwd does not exist: /x' });
  const down = fakeDeps({ connect: async () => { throw new Error('stub is unreachable'); } });
  assert.deepEqual(await answerHostAsk('stub', spawnAsk('/x'), down), { error: 'stub is unreachable' });
});

test('wireCliHostRelay answers a host.requested with host.done and leaves other pushes alone (M9 fix 1167)', async () => {
  const sent: Array<{ type: string; body: unknown }> = [];
  const client = Object.assign(new EventEmitter(), {
    request: async (type: string, body: unknown) => { sent.push({ type, body }); return {}; },
  });
  wireCliHostRelay(client as never, fakeDeps());
  client.emit('message', { type: 'file.open.requested', path: 'x', pane: false });
  client.emit('message', { type: 'host.requested', relayId: 7, host: 'stub', ask: spawnAsk('/srv') });
  for (let i = 0; i < 50 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent, [{ type: 'host.done', body: { relayId: 7, session } }]);
});
