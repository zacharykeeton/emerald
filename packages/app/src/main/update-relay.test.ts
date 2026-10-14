import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { UpdateState } from '@emerald/shared';
import { wireUpdateRelay } from './update-relay.ts';

// The pipe client stood in by an emitter that records its requests.
class FakeClient extends EventEmitter {
  daemonInfo: { featureLevel: number | null } | null = null;
  requests: Array<{ type: string; body: unknown }> = [];
  request(type: string, body: unknown): Promise<unknown> {
    this.requests.push({ type, body });
    return Promise.resolve({});
  }
}

const idle: UpdateState = { phase: 'idle', current: '0.1.240', latest: null, percent: null, message: null };
const ready: UpdateState = { phase: 'ready', current: '0.1.240', latest: '0.1.258', percent: 100, message: null };

function setup(level: number) {
  const client = new FakeClient();
  client.daemonInfo = { featureLevel: level };
  const acts: number[] = [];
  const log: string[] = [];
  let state = idle;
  const relay = wireUpdateRelay(client, () => ({ state: () => state, act: async () => { acts.push(1); } }), (m) => log.push(m));
  return { client, acts, log, relay, setState: (s: UpdateState) => (state = s) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('on connect the relay sits on the app topic and reports the state; every later state is reported (M9 fix 271)', async () => {
  const { client, relay, setState } = setup(49);
  client.emit('connected');
  await tick();
  assert.deepEqual(client.requests, [
    { type: 'subscribe', body: { topics: ['app'] } },
    { type: 'update.report', body: { state: idle } },
  ]);
  setState(ready);
  relay.report(ready);
  assert.deepEqual(client.requests[2], { type: 'update.report', body: { state: ready } });
});

test('update.requested runs act() once per push; other pushes do nothing', async () => {
  const { client, acts, log } = setup(49);
  client.emit('message', { type: 'session.removed' });
  client.emit('message', { type: 'update.requested' });
  client.emit('message', { type: 'update.requested' });
  await tick();
  assert.equal(acts.length, 2);
  assert.ok(log.some((l) => l.includes('relayed from emmer update')));
});

test('a daemon before level 49 gets no subscribe and no report', async () => {
  const { client, relay } = setup(48);
  client.emit('connected');
  await tick();
  relay.report(ready);
  assert.deepEqual(client.requests, []);
});
