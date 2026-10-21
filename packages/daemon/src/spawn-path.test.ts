import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Logger } from './log.ts';
import { MACHINE_KEY, REUSE_MS, SpawnPath, USER_KEY, parseRegQuery, registryPath } from './spawn-path.ts';

// The shape reg.exe prints, read on this box (M9 fix 971).
const USER_OUT = [
  '',
  'HKEY_CURRENT_USER\\Environment',
  '    Path    REG_EXPAND_SZ    C:\\Users\\me\\.cargo\\bin;%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;',
  '    WFS_WATCH_LINK    REG_SZ    Ethernet 5',
  '    EMPTY    REG_SZ',
  '',
].join('\r\n');

const reg = (values: Record<string, [string, string]>) =>
  new Map(Object.entries(values).map(([k, [type, value]]) => [k.toUpperCase(), { type, value }]));

test('parseRegQuery reads the values off reg.exe query and skips the header and blank lines (M9 fix 971)', () => {
  const m = parseRegQuery(USER_OUT);
  assert.deepEqual([...m.keys()], ['PATH', 'WFS_WATCH_LINK', 'EMPTY']);
  assert.deepEqual(m.get('PATH'), { type: 'REG_EXPAND_SZ', value: 'C:\\Users\\me\\.cargo\\bin;%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;' });
  assert.deepEqual(m.get('WFS_WATCH_LINK'), { type: 'REG_SZ', value: 'Ethernet 5' });
  assert.deepEqual(m.get('EMPTY'), { type: 'REG_SZ', value: '' });
});

test('registryPath joins the machine Path then the user Path, expanded (M9 fix 971)', () => {
  assert.equal(registryPath(reg({ Path: ['REG_SZ', 'a;b;'] }), reg({ Path: ['REG_SZ', 'c'] }), {}), 'a;b;c');
  assert.equal(registryPath(reg({ Path: ['REG_SZ', 'a; ;b'] }), reg({}), {}), 'a;b', 'a user key with no Path gives the machine one alone');
  assert.equal(registryPath(reg({}), reg({ Path: ['REG_SZ', 'c'] }), {}), null, 'a machine key with no Path is a failed read');
  assert.equal(registryPath(reg({ Path: ['REG_EXPAND_SZ', '%systemroot%\\x'] }), reg({}), { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\x');
  assert.equal(registryPath(reg({ Path: ['REG_EXPAND_SZ', '%NOPE%\\bin'] }), reg({}), {}), '%NOPE%\\bin');
  assert.equal(
    registryPath(reg({ Path: ['REG_SZ', 'm'] }), reg({ Path: ['REG_EXPAND_SZ', '%JAVA_HOME%\\bin'], JAVA_HOME: ['REG_EXPAND_SZ', '%ProgramFiles%\\Java'] }), { ProgramFiles: 'C:\\Program Files' }),
    'm;C:\\Program Files\\Java\\bin',
  );
  assert.equal(registryPath(reg({ Path: ['REG_SZ', '%X%\\y'] }), reg({}), { X: 'no' }), '%X%\\y', 'a REG_SZ Path is used as written');
  assert.equal(registryPath(reg({ Path: ['REG_SZ', 'a;a'] }), reg({ Path: ['REG_SZ', 'a'] }), {}), 'a;a;a', 'duplicates are kept');
});

function recorder(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (msg: string) => lines.push(`info ${msg}`),
    warn: (msg: string, extra?: unknown) => lines.push(`warn ${msg} ${JSON.stringify(extra)}`),
    error: (msg: string) => lines.push(`error ${msg}`),
  };
}

const MACHINE_OUT = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    Path    REG_SZ    C:\\m\r\n';
const SIMPLE_USER_OUT = 'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    C:\\u\r\n';

test('SpawnPath.read queries both keys, shares a read in flight and reuses a good one for two seconds (M9 fix 971)', async () => {
  let now = 1000;
  const asked: string[] = [];
  const sp = new SpawnPath({
    log: recorder(),
    env: {},
    now: () => now,
    query: (key) => {
      asked.push(key);
      return Promise.resolve(key === MACHINE_KEY ? MACHINE_OUT : SIMPLE_USER_OUT);
    },
  });
  const [a, b] = await Promise.all([sp.read(), sp.read()]);
  assert.equal(a, 'C:\\m;C:\\u');
  assert.equal(b, a);
  assert.deepEqual(asked, [MACHINE_KEY, USER_KEY], 'two calls at once make one query per key');
  now += REUSE_MS;
  assert.equal(await sp.read(), a);
  assert.equal(asked.length, 2, 'reused within two seconds');
  now += 1;
  assert.equal(await sp.read(), a);
  assert.equal(asked.length, 4, 'read again past two seconds');
});

test('SpawnPath.read answers null on a failed read, never rejects, and logs the transitions alone (M9 fix 971)', async () => {
  const log = recorder();
  let mode: 'reject' | 'throw' | 'fffd-machine' | 'fffd-user' | 'good' = 'reject';
  let now = 0;
  const sp = new SpawnPath({
    log,
    env: {},
    now: () => now,
    query: (key) => {
      if (mode === 'reject') return Promise.reject(new Error('reg failed'));
      if (mode === 'throw') throw new Error('reg threw');
      if (mode === 'fffd-machine' && key === MACHINE_KEY) return Promise.resolve(MACHINE_OUT.replace('C:\\m', 'C:\\\uFFFD'));
      if (mode === 'fffd-user' && key === USER_KEY) return Promise.resolve(SIMPLE_USER_OUT.replace('C:\\u', 'C:\\\uFFFD'));
      return Promise.resolve(key === MACHINE_KEY ? MACHINE_OUT : SIMPLE_USER_OUT);
    },
  });
  assert.equal(await sp.read(), null, 'a rejecting query');
  mode = 'throw';
  assert.equal(await sp.read(), null, 'a throwing query');
  mode = 'fffd-machine';
  assert.equal(await sp.read(), null, 'a U+FFFD in the machine output');
  mode = 'fffd-user';
  assert.equal(await sp.read(), null, 'a U+FFFD in the user output');
  assert.deepEqual(log.lines, [
    `warn spawn PATH: the registry read failed, sessions get the daemon's own PATH until it reads again ${JSON.stringify({ err: 'reg failed' })}`,
  ], 'one warn for the stretch');
  mode = 'good';
  assert.equal(await sp.read(), 'C:\\m;C:\\u');
  assert.equal(log.lines.at(-1), 'info spawn PATH: the registry read again');
  now += REUSE_MS + 1;
  assert.equal(await sp.read(), 'C:\\m;C:\\u');
  assert.equal(log.lines.length, 2, 'a good read after a good one logs nothing');
});

test('SpawnPath.read logs nothing for a good first read, and names the U+FFFD case (M9 fix 971)', async () => {
  const log = recorder();
  let bad = false;
  let now = 0;
  const sp = new SpawnPath({
    log,
    env: {},
    now: () => now,
    query: (key) => Promise.resolve(key === MACHINE_KEY ? (bad ? MACHINE_OUT.replace('C:\\m', '\uFFFD') : MACHINE_OUT) : SIMPLE_USER_OUT),
  });
  assert.equal(await sp.read(), 'C:\\m;C:\\u');
  assert.equal(log.lines.length, 0);
  bad = true;
  now += REUSE_MS + 1;
  assert.equal(await sp.read(), null);
  assert.ok(log.lines[0]?.includes('reg.exe output is not UTF-8'), log.lines.join('\n'));
});
