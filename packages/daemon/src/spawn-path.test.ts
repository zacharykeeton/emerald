import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import type { Logger } from './log.ts';
import { MACHINE_KEY, REUSE_MS, SpawnEnv, USER_KEY, VOLATILE_KEY, parseRegQuery, registryEnv } from './spawn-path.ts';

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
  new Map(Object.entries(values).map(([name, [type, value]]) => [name.toUpperCase(), { name, type, value }]));
const none = reg({});

test('parseRegQuery reads the values off reg.exe query and skips the header and blank lines (M9 fix 971)', () => {
  const m = parseRegQuery(USER_OUT);
  assert.deepEqual([...m.keys()], ['PATH', 'WFS_WATCH_LINK', 'EMPTY']);
  assert.deepEqual(m.get('PATH'), { name: 'Path', type: 'REG_EXPAND_SZ', value: 'C:\\Users\\me\\.cargo\\bin;%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;' });
  assert.deepEqual(m.get('WFS_WATCH_LINK'), { name: 'WFS_WATCH_LINK', type: 'REG_SZ', value: 'Ethernet 5' });
  assert.deepEqual(m.get('EMPTY'), { name: 'EMPTY', type: 'REG_SZ', value: '' });
});

test("registryEnv joins the machine Path then the user Path, expanded (M9 fixes 971 and 996)", () => {
  const pathOf = (machine: ReturnType<typeof reg>, user: ReturnType<typeof reg>, base: NodeJS.ProcessEnv) => registryEnv(machine, user, none, base)?.['Path'] ?? null;
  assert.equal(pathOf(reg({ Path: ['REG_SZ', 'a;b;'] }), reg({ Path: ['REG_SZ', 'c'] }), {}), 'a;b;c');
  assert.equal(pathOf(reg({ Path: ['REG_SZ', 'a; ;b'] }), none, {}), 'a;b', 'a user key with no Path gives the machine one alone');
  assert.equal(registryEnv(none, reg({ Path: ['REG_SZ', 'c'] }), none, {}), null, 'a machine key with no Path is a failed read');
  assert.equal(pathOf(reg({ Path: ['REG_EXPAND_SZ', '%systemroot%\\x'] }), none, { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\x');
  assert.equal(pathOf(reg({ Path: ['REG_EXPAND_SZ', '%NOPE%\\bin'] }), none, {}), '%NOPE%\\bin');
  assert.equal(
    pathOf(reg({ Path: ['REG_SZ', 'm'] }), reg({ Path: ['REG_EXPAND_SZ', '%JAVA_HOME%\\bin'], JAVA_HOME: ['REG_EXPAND_SZ', '%ProgramFiles%\\Java'] }), { ProgramFiles: 'C:\\Program Files' }),
    'm;C:\\Program Files\\Java\\bin',
  );
  assert.equal(pathOf(reg({ Path: ['REG_SZ', '%X%\\y'] }), none, { X: 'no' }), 'no\\y', 'a REG_SZ Path is expanded, as Windows does');
  assert.equal(pathOf(reg({ Path: ['REG_SZ', 'a;a'] }), reg({ Path: ['REG_SZ', 'a'] }), {}), 'a;a;a', 'duplicates are kept');
});

test("registryEnv lays the three keys over each other as a Windows Terminal tab has them (M9 fix 996)", () => {
  const machine = reg({ Path: ['REG_SZ', 'm'], USERNAME: ['REG_SZ', 'SYSTEM'], PATHEXT: ['REG_SZ', '.COM;.EXE'], LibPath: ['REG_SZ', 'a'] });
  assert.equal(registryEnv(machine, none, reg({ USERNAME: ['REG_SZ', 'me'] }), {})?.['USERNAME'], 'me', "the logon's USERNAME, never the machine's SYSTEM");
  assert.equal(registryEnv(machine, none, none, {})?.['PATHEXT'], '.COM;.EXE', 'a machine PATHEXT alone is kept');
  assert.equal(registryEnv(machine, reg({ PATHEXT: ['REG_SZ', '.PY'] }), none, {})?.['PATHEXT'], '.PY', "a user PATHEXT replaces the machine's, never joined");
  assert.equal(registryEnv(machine, reg({ LibPath: ['REG_SZ', 'b'] }), none, {})?.['LibPath'], 'a;b', 'LibPath is joined as Path is');
  assert.equal(registryEnv(machine, reg({ TEMP: ['REG_EXPAND_SZ', '%USERPROFILE%\\T'] }), none, { USERPROFILE: 'C:\\Users\\me' })?.['TEMP'], 'C:\\Users\\me\\T');
  assert.equal(
    registryEnv(machine, reg({ TOOL: ['REG_EXPAND_SZ', '%ROOT%\\tool'], ROOT: ['REG_SZ', 'D:\\r'] }), none, {})?.['TOOL'],
    'D:\\r\\tool',
    'a name in the user key expanded from a REG_SZ of the same key, whatever the order printed',
  );
  const layer = registryEnv(reg({ PATH: ['REG_SZ', 'm'] }), none, none, { ONLY_BASE: 'x' })!;
  assert.equal('ONLY_BASE' in layer, false, 'a name the registry lacks is not in the layer');
  assert.deepEqual(Object.keys(layer), ['Path'], "Path's spelling is Path whatever the key printed");
  assert.equal('BIN' in registryEnv(reg({ Path: ['REG_SZ', 'm'], BIN: ['REG_BINARY', '00'] }), none, none, {})!, false, 'a type but the two is skipped');
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
const VOLATILE_OUT = 'HKEY_CURRENT_USER\\Volatile Environment\r\n    USERNAME    REG_SZ    me\r\n\r\nHKEY_CURRENT_USER\\Volatile Environment\\1\r\n';
const outFor = (key: string) => (key === MACHINE_KEY ? MACHINE_OUT : key === USER_KEY ? SIMPLE_USER_OUT : VOLATILE_OUT);
const GOOD = { Path: 'C:\\m;C:\\u', USERNAME: 'me' };

test('SpawnEnv.read queries the three keys, shares a read in flight and reuses a good one for two seconds (M9 fixes 971 and 996)', async () => {
  let now = 1000;
  const asked: string[] = [];
  const sp = new SpawnEnv({
    log: recorder(),
    env: {},
    now: () => now,
    query: (key: string) => {
      asked.push(key);
      return Promise.resolve(outFor(key));
    },
  });
  const [a, b] = await Promise.all([sp.read(), sp.read()]);
  assert.deepEqual(a, GOOD);
  assert.equal(b, a);
  assert.deepEqual(asked, [MACHINE_KEY, USER_KEY, VOLATILE_KEY], 'two calls at once make one query per key');
  now += REUSE_MS;
  assert.equal(await sp.read(), a);
  assert.equal(asked.length, 3, 'reused within two seconds');
  now += 1;
  assert.deepEqual(await sp.read(), GOOD);
  assert.equal(asked.length, 6, 'read again past two seconds');
});

test('SpawnEnv.read answers null on a failed read, never rejects, and logs the transitions alone (M9 fixes 971 and 996)', async () => {
  const log = recorder();
  let mode: 'reject' | 'throw' | 'fffd-machine' | 'fffd-user' | 'fffd-volatile' | 'good' = 'reject';
  let now = 0;
  const sp = new SpawnEnv({
    log,
    env: {},
    now: () => now,
    query: (key: string) => {
      if (mode === 'reject') return Promise.reject(new Error('reg failed'));
      if (mode === 'throw') throw new Error('reg threw');
      if (mode === 'fffd-machine' && key === MACHINE_KEY) return Promise.resolve(MACHINE_OUT.replace('C:\\m', 'C:\\\uFFFD'));
      if (mode === 'fffd-user' && key === USER_KEY) return Promise.resolve(SIMPLE_USER_OUT.replace('C:\\u', 'C:\\\uFFFD'));
      if (mode === 'fffd-volatile' && key === VOLATILE_KEY) return Promise.resolve(VOLATILE_OUT.replace('me', '\uFFFD'));
      return Promise.resolve(outFor(key));
    },
  });
  assert.equal(await sp.read(), null, 'a rejecting query');
  mode = 'throw';
  assert.equal(await sp.read(), null, 'a throwing query');
  mode = 'fffd-machine';
  assert.equal(await sp.read(), null, 'a U+FFFD in the machine output');
  mode = 'fffd-user';
  assert.equal(await sp.read(), null, 'a U+FFFD in the user output');
  mode = 'fffd-volatile';
  assert.equal(await sp.read(), null, 'a U+FFFD in the volatile output');
  assert.deepEqual(log.lines, [
    `warn spawn env: the registry read failed, sessions get the daemon's own environment until it reads again ${JSON.stringify({ err: 'reg failed' })}`,
  ], 'one warn for the stretch');
  mode = 'good';
  assert.deepEqual(await sp.read(), GOOD);
  assert.equal(log.lines.at(-1), 'info spawn env: the registry read again');
  now += REUSE_MS + 1;
  assert.deepEqual(await sp.read(), GOOD);
  assert.equal(log.lines.length, 2, 'a good read after a good one logs nothing');
});

test('SpawnEnv.read logs nothing for a good first read, and names the U+FFFD and no-Path cases (M9 fixes 971 and 996)', async () => {
  const log = recorder();
  let mode: 'good' | 'fffd' | 'no-path' = 'good';
  let now = 0;
  const sp = new SpawnEnv({
    log,
    env: {},
    now: () => now,
    query: (key: string) => {
      if (key !== MACHINE_KEY) return Promise.resolve(outFor(key));
      if (mode === 'fffd') return Promise.resolve(MACHINE_OUT.replace('C:\\m', '\uFFFD'));
      if (mode === 'no-path') return Promise.resolve('HKEY_LOCAL_MACHINE\\x\r\n    OS    REG_SZ    Windows_NT\r\n');
      return Promise.resolve(MACHINE_OUT);
    },
  });
  assert.deepEqual(await sp.read(), GOOD);
  assert.equal(log.lines.length, 0);
  mode = 'fffd';
  now += REUSE_MS + 1;
  assert.equal(await sp.read(), null);
  assert.ok(log.lines[0]?.includes('reg.exe output is not UTF-8'), log.lines.join('\n'));
  mode = 'good';
  now += REUSE_MS + 1;
  await sp.read();
  mode = 'no-path';
  now += REUSE_MS + 1;
  assert.equal(await sp.read(), null);
  assert.ok(log.lines.at(-1)?.includes('the machine key has no Path value'), log.lines.join('\n'));
});

test("SpawnEnv.read on this box's own registry answers the logon's USERNAME and a Path (M9 fix 996)", { skip: process.platform !== 'win32' }, async () => {
  const layer = await new SpawnEnv({ log: recorder() }).read();
  assert.ok(layer !== null, 'the read failed');
  assert.equal(layer['USERNAME'], os.userInfo().username);
  assert.ok((layer['Path'] ?? '') !== '');
});
