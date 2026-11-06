import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { HostRecord } from '@emerald/shared';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { HostsStore } from './hosts-store.ts';
import { silentLogger } from './log.ts';

test.after(removeTemps);

function tempFile(): string {
  return path.join(mkTemp('emerald-hosts-'), 'nested', 'hosts.json');
}

const stub: HostRecord = { name: 'stub', destination: 'verify@stub', addedAt: 2 };

test('a missing file is no hosts (M9 fix 1080)', () => {
  const store = new HostsStore(tempFile(), silentLogger);
  store.load();
  assert.deepEqual(store.list(), []);
});

test('a file that is not a list is set aside (M9 fix 1080)', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"name":"x"}');
  const store = new HostsStore(file, silentLogger);
  store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(fs.existsSync(file), false);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.startsWith('hosts.json.bad-')));
});

test('set upserts by name and writes, remove writes, a bad entry in the file is dropped (M9 fix 1080)', () => {
  const file = tempFile();
  const store = new HostsStore(file, silentLogger);
  store.load();
  const pushes: HostRecord[][] = [];
  store.on('changed', (hosts: HostRecord[]) => pushes.push(hosts));
  assert.equal(store.set({ name: 'late', destination: 'u@late', addedAt: 9 }), true);
  assert.equal(store.set(stub), true);
  assert.deepEqual(store.list().map((h) => h.name), ['stub', 'late']);
  assert.equal(store.set({ ...stub, kitVersion: '0.1.1079' }), true);
  assert.equal(store.list()[0]!.kitVersion, '0.1.1079');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).map((h: HostRecord) => h.name), ['stub', 'late']);
  assert.equal(store.remove('late'), true);
  assert.equal(store.remove('nobody'), false);
  assert.equal(pushes.length, 4);
  // Read back, with a bad entry beside the good one.
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[];
  fs.writeFileSync(file, JSON.stringify([...raw, { name: 'has space', destination: 'x', addedAt: 1 }]));
  const again = new HostsStore(file, silentLogger);
  again.load();
  assert.deepEqual(again.list(), [{ ...stub, kitVersion: '0.1.1079' }]);
});

test('an unchanged set writes and emits nothing, a bad record is refused (M9 fix 1080)', () => {
  const store = new HostsStore(tempFile(), silentLogger);
  store.load();
  store.set(stub);
  let emitted = 0;
  store.on('changed', () => emitted++);
  assert.equal(store.set({ ...stub }), false);
  assert.equal(emitted, 0);
  assert.throws(() => store.set({ ...stub, shell: 'cmd' }), /host must be a host record: shell/);
});
