import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relayCommand, remoteHomeOf, kitDirOf, nodeDirOf, mkdirCommand, removeCommand, untarCommand,
  hostNameOf, mergeRemoteHosts, isHostRecord, hostRecordProblem,
} from './remote.ts';
import type { HostRecord } from './protocol.ts';

const win = { home: 'C:\\Users\\zacha', shell: 'powershell' as const };
const mac = { home: '/Users/z', shell: 'sh' as const };

test('relayCommand: the PowerShell words, quotes and the call operator included (M9 fix 1080)', () => {
  assert.deepEqual(relayCommand({ ...win, nodeVersion: '24.20.0', kitVersion: '0.1.1079' }), [
    '&',
    '"C:\\Users\\zacha\\.emerald-remote\\node-24.20.0\\node.exe"',
    '"C:\\Users\\zacha\\.emerald-remote\\0.1.1079\\cli\\dist\\main.js"',
    'relay',
    '--home',
    '"C:\\Users\\zacha\\.emerald-remote"',
  ]);
});

test('relayCommand: the sh words, bin/node and no call operator (M9 fix 1080)', () => {
  assert.deepEqual(relayCommand({ ...mac, nodeVersion: '24.20.0', kitVersion: '0.1.1079' }), [
    '"/Users/z/.emerald-remote/node-24.20.0/bin/node"',
    '"/Users/z/.emerald-remote/0.1.1079/cli/dist/main.js"',
    'relay',
    '--home',
    '"/Users/z/.emerald-remote"',
  ]);
});

test('the host folders in both spellings, a trailing separator on the home dropped (M9 fix 1080)', () => {
  assert.equal(remoteHomeOf(win), 'C:\\Users\\zacha\\.emerald-remote');
  assert.equal(remoteHomeOf({ ...win, home: 'C:\\Users\\zacha\\' }), 'C:\\Users\\zacha\\.emerald-remote');
  assert.equal(remoteHomeOf({ ...win, home: 'C:\\' }), 'C:\\.emerald-remote');
  assert.equal(remoteHomeOf({ ...mac, home: '/' }), '/.emerald-remote');
  assert.equal(kitDirOf(win, '0.1.1079'), 'C:\\Users\\zacha\\.emerald-remote\\0.1.1079');
  assert.equal(nodeDirOf(mac, '24.20.0'), '/Users/z/.emerald-remote/node-24.20.0');
});

test('mkdir, remove and untar in both shells (M9 fix 1080)', () => {
  assert.equal(mkdirCommand(win, 'C:\\a b'), 'New-Item -ItemType Directory -Force -Path "C:\\a b" | Out-Null');
  assert.equal(mkdirCommand(mac, '/a b'), 'mkdir -p "/a b"');
  assert.equal(removeCommand(win, 'C:\\x'), 'Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path "C:\\x"');
  assert.equal(removeCommand(mac, '/x'), 'rm -rf "/x"');
  assert.equal(untarCommand(win, 'C:\\x\\k.tgz', 'C:\\x\\k'), 'tar -xzf "C:\\x\\k.tgz" -C "C:\\x\\k"');
  assert.equal(untarCommand(mac, '/x/k.tgz', '/x/k'), 'tar -xzf "/x/k.tgz" -C "/x/k"');
  assert.throws(() => mkdirCommand(win, 'C:\\a"b'), /double quote/);
});

test('hostNameOf drops ssh://, the user and the port (M9 fix 1080)', () => {
  assert.equal(hostNameOf('zacha@192.0.2.7'), '192.0.2.7');
  assert.equal(hostNameOf('wfs-db'), 'wfs-db');
  assert.equal(hostNameOf('ssh://me@box.example:2222'), 'box.example');
  assert.equal(hostNameOf('a@b@host:22'), 'host');
});

test('mergeRemoteHosts: config hosts first with their record facts, then the added ones by addedAt (M9 fix 1080)', () => {
  const records: HostRecord[] = [
    { name: 'late', destination: 'u@late', addedAt: 30 },
    { name: 'wfs-db', destination: 'stale', os: 'win32', shell: 'powershell', home: 'C:\\Users\\zacha', kitVersion: '0.1.1079', addedAt: 5 },
    { name: 'early', destination: 'u@early', addedAt: 10 },
  ];
  const merged = mergeRemoteHosts(
    [{ name: 'wfs-db', destination: 'zacha@192.0.2.7' }, { name: 'plain', destination: 'plain' }],
    records,
  );
  assert.deepEqual(merged.map((h) => [h.name, h.source]), [
    ['wfs-db', 'config'], ['plain', 'config'], ['early', 'added'], ['late', 'added'],
  ]);
  assert.equal(merged[0]!.destination, 'zacha@192.0.2.7');
  assert.equal(merged[0]!.kitVersion, '0.1.1079');
  assert.equal(merged[0]!.home, 'C:\\Users\\zacha');
  assert.deepEqual(merged[1], { name: 'plain', destination: 'plain', addedAt: 0, source: 'config' });
});

test('isHostRecord: a good record, then each bad field named (M9 fix 1080)', () => {
  const good: HostRecord = { name: 'stub', destination: 'verify@stub', os: 'win32', arch: 'x64', shell: 'powershell', home: 'C:\\h', nodeVersion: '24.20.0', kitVersion: '0.1.1079', addedAt: 1 };
  assert.equal(isHostRecord(good), true);
  assert.equal(isHostRecord({ name: 'a', destination: 'a', addedAt: 0 }), true);
  const bad: [Record<string, unknown>, string][] = [
    [{ ...good, name: '' }, 'name'],
    [{ ...good, name: 'a b' }, 'name'],
    [{ ...good, destination: '' }, 'destination'],
    [{ ...good, destination: 'a b' }, 'destination'],
    [{ ...good, os: 'beos' }, 'os'],
    [{ ...good, shell: 'cmd' }, 'shell'],
    [{ ...good, arch: '' }, 'arch'],
    [{ ...good, home: 3 }, 'home'],
    [{ ...good, nodeVersion: '' }, 'nodeVersion'],
    [{ ...good, kitVersion: '' }, 'kitVersion'],
    [{ ...good, addedAt: Number.NaN }, 'addedAt'],
  ];
  for (const [rec, field] of bad) {
    assert.equal(isHostRecord(rec), false, field);
    assert.equal(hostRecordProblem(rec), field);
  }
  assert.equal(hostRecordProblem(null), 'not an object');
});
