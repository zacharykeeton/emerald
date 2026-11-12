import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostRecord, RemoteHost } from '@emerald/shared';
import {
  cancelSetup,
  kitCliCommand,
  nodeCheckCommand,
  parsePowerShellProbe,
  parseShProbe,
  pruneCommand,
  pruneOldKits,
  resetPruned,
  setupHost,
  spawnRunner,
} from './host-setup.ts';
import type { RemoteRunner, RunOutcome, SetupDeps, SetupPush } from './host-setup.ts';
import type { DaemonInfo } from './pipe-client.ts';
import type { AssembledKit } from './remote-kit.ts';
import { KIT_NODE_VERSION } from './remote-kit.ts';

// M9 fix 1084: first contact and setup, every ssh and scp through a fake
// runner that records each call and answers from a script.

const temps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-setup-'));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

const WFS_HOME = 'C:\\Users\\zacha';
const R = 'C:\\Users\\zacha\\.emerald-remote';
const V = '0.1.1079';
const wfs: RemoteHost = { name: 'wfs-db', destination: 'zacha@192.0.2.7', addedAt: 0, source: 'config' };
const DAEMON: DaemonInfo = { pid: 7, version: V, featureLevel: 80, startedAt: 1, otherHome: null, shells: [], claude: true };

const ok = (stdout = ''): RunOutcome => ({ code: 0, stdout, stderrLast: '' });

// wfs-db's real answers: the sh probe exits 0 with the home alone under
// PowerShell 5.1, the PowerShell probe gives two CRLF lines.
function wfsAnswers(nodeThere: boolean) {
  return (tool: string, args: readonly string[]): RunOutcome => {
    const cmd = args.at(-1)!;
    if (tool === 'ssh' && cmd === 'uname -sm; echo $HOME') return { code: 0, stdout: `${WFS_HOME}\r\n`, stderrLast: '+ FullyQualifiedErrorId : CommandNotFoundException' };
    if (tool === 'ssh' && cmd === '$env:PROCESSOR_ARCHITECTURE; $HOME') return ok(`AMD64\r\n${WFS_HOME}\r\n`);
    if (tool === 'ssh' && cmd.startsWith('Test-Path')) return ok(nodeThere ? 'True\r\n' : 'False\r\n');
    return ok();
  };
}

function fakeRunner(answer: (tool: string, args: readonly string[]) => RunOutcome | Promise<RunOutcome>) {
  const calls: { tool: string; args: readonly string[]; cwd?: string }[] = [];
  const run: RemoteRunner = (tool, args, opts = {}) => {
    calls.push({ tool, args, ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }) });
    let kill = (): void => {};
    const done = new Promise<RunOutcome>((resolve) => {
      kill = () => resolve({ code: 1, stdout: '', stderrLast: 'killed' });
      void Promise.resolve(answer(tool, args)).then(resolve);
    });
    return { done, kill: () => kill() };
  };
  return { run, calls };
}

function fakeKit(): AssembledKit {
  const dir = tmp();
  const nodeArchive = path.join(dir, 'node-24.20.0.tgz');
  const emeraldArchive = path.join(dir, V, `emerald-${V}.tgz`);
  fs.mkdirSync(path.dirname(emeraldArchive));
  fs.writeFileSync(nodeArchive, Buffer.alloc(3000));
  fs.writeFileSync(emeraldArchive, Buffer.alloc(1000));
  return { dir: path.dirname(emeraldArchive), manifest: { version: V, node: { version: '24.20.0', url: '', sha256: '' }, pty: { version: '1.1.0', integrity: '' }, emerald: { files: [], sha256: '', stage: 'stage-1166' } }, nodeArchive, emeraldArchive };
}

function deps(run: RemoteRunner, over: Partial<SetupDeps> = {}) {
  const pushes: SetupPush[] = [];
  const records: HostRecord[] = [];
  const connected: HostRecord[] = [];
  const logs: string[] = [];
  const kit = fakeKit();
  let t = 1000;
  const d: SetupDeps = {
    run,
    kit: async () => kit,
    setRecord: async (r) => void records.push(r),
    connect: async (r) => {
      connected.push(r);
      return DAEMON;
    },
    push: (p) => void pushes.push(p),
    appVersion: V,
    now: () => (t += 10),
    log: (m) => void logs.push(m),
    ...over,
  };
  return { d, pushes, records, connected, logs, kit };
}

test('parseShProbe reads a Mac and a Linux answer and refuses PowerShell 5.1 answering the sh probe', () => {
  assert.deepEqual(parseShProbe(0, 'Darwin arm64\n/Users/z\n'), { shell: 'sh', os: 'darwin', arch: 'arm64', home: '/Users/z' });
  assert.deepEqual(parseShProbe(0, 'Linux x86_64\n/home/z\n'), { shell: 'sh', os: 'linux', arch: 'x64', home: '/home/z' });
  assert.deepEqual(parseShProbe(0, 'Linux aarch64\n/home/z\n')?.arch, 'arm64');
  assert.equal(parseShProbe(0, 'C:\\Users\\zacha\r\n'), null);
  assert.equal(parseShProbe(1, 'Darwin arm64\n/Users/z\n'), null);
});

test('parsePowerShellProbe reads AMD64 and ARM64 and refuses a cmd.exe-style exit', () => {
  assert.deepEqual(parsePowerShellProbe(0, 'AMD64\r\nC:\\Users\\zacha\r\n'), { shell: 'powershell', os: 'win32', arch: 'x64', home: 'C:\\Users\\zacha' });
  assert.equal(parsePowerShellProbe(0, 'ARM64\r\nC:\\Users\\z\r\n')?.arch, 'arm64');
  assert.equal(parsePowerShellProbe(1, "'$env:PROCESSOR_ARCHITECTURE' is not recognized\r\n"), null);
  assert.equal(parsePowerShellProbe(0, 'AMD64\r\n/home/z\r\n'), null);
});

test("the kit's own command builders in both shells", () => {
  const ps = { home: WFS_HOME, shell: 'powershell' as const, nodeVersion: '24.20.0', kitVersion: V };
  const sh = { home: '/Users/z', shell: 'sh' as const, nodeVersion: '24.20.0', kitVersion: V };
  assert.equal(nodeCheckCommand(ps, '24.20.0'), `Test-Path -LiteralPath "${R}\\node-24.20.0\\node.exe"`);
  assert.equal(nodeCheckCommand(sh, '24.20.0'), 'if [ -x "/Users/z/.emerald-remote/node-24.20.0/bin/node" ]; then echo True; else echo False; fi');
  assert.equal(kitCliCommand(ps, ['hooks', 'install', '--home', R]), `& "${R}\\node-24.20.0\\node.exe" "${R}\\${V}\\cli\\dist\\main.js" hooks install --home "${R}"`);
  assert.equal(kitCliCommand(sh, ['hooks', 'install', '--home', '/Users/z/.emerald-remote']), `"/Users/z/.emerald-remote/node-24.20.0/bin/node" "/Users/z/.emerald-remote/${V}/cli/dist/main.js" hooks install --home "/Users/z/.emerald-remote"`);
  assert.equal(
    pruneCommand(ps, V, '24.20.0'),
    `Get-ChildItem -Directory -LiteralPath "${R}" | Where-Object { ($_.Name -match '^\\d+\\.\\d+\\.\\d+$' -and $_.Name -ne '${V}') -or ($_.Name -like 'node-*' -and $_.Name -ne 'node-24.20.0') } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`,
  );
  assert.equal(pruneCommand(sh, V, '24.20.0'), `cd "/Users/z/.emerald-remote" && for d in [0-9]*.[0-9]*.[0-9]* node-*; do [ -d "$d" ] && [ "$d" != "${V}" ] && [ "$d" != "node-24.20.0" ] && rm -rf "$d"; done; true`);
});

test('spawnRunner runs a node stub named by EMERALD_SSH and keeps the last stderr line', async () => {
  const dir = tmp();
  const stub = path.join(dir, 'stub-ssh.mjs');
  fs.writeFileSync(stub, "for (let i = 0; i < 3; i++) process.stderr.write('** WARNING: connection is not using a post-quantum key exchange algorithm.\\r\\n');\nprocess.stderr.write('real last\\r\\n\\r\\n');\nprocess.stdout.write(process.argv.slice(2).join('|'));\nprocess.exit(255);\n");
  const run = spawnRunner('node', { ...process.env, EMERALD_SSH: stub });
  const out = await run('ssh', ['-o', 'BatchMode=yes', 'host', 'echo hi']).done;
  assert.equal(out.code, 255);
  assert.equal(out.stderrLast, 'real last');
  assert.equal(out.stdout, '-o|BatchMode=yes|host|echo hi');
});

test("a first contact on wfs-db's shape probes twice, copies both archives, unpacks, installs the hooks and connects", async () => {
  const { run, calls } = fakeRunner(wfsAnswers(false));
  const { d, pushes, records, connected, kit } = deps(run);
  const result = await setupHost(wfs, d);
  assert.deepEqual(result, { ok: true, daemon: DAEMON });
  const o = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  const ssh = (cmd: string) => ({ tool: 'ssh', args: [...o, 'wfs-db', cmd] });
  const nodeName = 'node-24.20.0.tgz';
  const emName = `emerald-${V}.tgz`;
  assert.deepEqual(calls, [
    ssh('uname -sm; echo $HOME'),
    ssh('$env:PROCESSOR_ARCHITECTURE; $HOME'),
    ssh(`New-Item -ItemType Directory -Force -Path "${R}" | Out-Null`),
    ssh(`Test-Path -LiteralPath "${R}\\node-${KIT_NODE_VERSION}\\node.exe"`),
    { tool: 'scp', args: [...o, nodeName, `wfs-db:.emerald-remote/${nodeName}`], cwd: path.dirname(kit.nodeArchive) },
    { tool: 'scp', args: [...o, emName, `wfs-db:.emerald-remote/${emName}`], cwd: path.dirname(kit.emeraldArchive) },
    ssh(`New-Item -ItemType Directory -Force -Path "${R}\\node-${KIT_NODE_VERSION}" | Out-Null`),
    ssh(`tar -xzf "${R}\\${nodeName}" -C "${R}\\node-${KIT_NODE_VERSION}"`),
    ssh(`New-Item -ItemType Directory -Force -Path "${R}\\${V}" | Out-Null`),
    ssh(`tar -xzf "${R}\\${emName}" -C "${R}\\${V}"`),
    ssh(`Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path "${R}\\${nodeName}"`),
    ssh(`Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -Path "${R}\\${emName}"`),
    ssh(`& "${R}\\node-${KIT_NODE_VERSION}\\node.exe" "${R}\\${V}\\cli\\dist\\main.js" hooks install --home "${R}"`),
  ]);
  assert.deepEqual(pushes.map((p) => p.phase), ['probing', 'copying', 'copying', 'unpacking', 'starting', 'done']);
  assert.equal(new Set(pushes.map((p) => p.startedAt)).size, 1);
  assert.deepEqual(pushes.map((p) => p.bytes), [0, 0, 4000, 4000, 4000, 4000]);
  assert.ok(pushes.every((p) => p.host === 'wfs-db' && p.line === null));
  const probed = { name: 'wfs-db', destination: 'zacha@192.0.2.7', addedAt: 0, os: 'win32', arch: 'x64', shell: 'powershell', home: WFS_HOME };
  assert.deepEqual(records, [probed, { ...probed, kitVersion: V, nodeVersion: KIT_NODE_VERSION, kitStage: 'stage-1166' }]);
  assert.deepEqual(connected, [{ ...probed, kitVersion: V, nodeVersion: KIT_NODE_VERSION, kitStage: 'stage-1166' }]);
});

test('an added host is reached by its destination, and a second run with Node there copies the emerald archive alone', async () => {
  const { run, calls } = fakeRunner(wfsAnswers(true));
  const { d, pushes } = deps(run);
  const added: RemoteHost = { name: '192.0.2.7', destination: 'zacha@192.0.2.7', addedAt: 5, source: 'added' };
  assert.equal((await setupHost(added, d)).ok, true);
  assert.ok(calls.every((c) => c.args.includes('zacha@192.0.2.7') || c.args.some((a) => a.startsWith('zacha@192.0.2.7:'))));
  const scps = calls.filter((c) => c.tool === 'scp').map((c) => c.args[4]);
  assert.deepEqual(scps, [`emerald-${V}.tgz`]);
  assert.ok(!calls.some((c) => c.args.at(-1)!.includes('node-24.20.0.tgz')), 'no Node untar or remove');
  assert.deepEqual(pushes.map((p) => p.bytes), [0, 0, 1000, 1000, 1000, 1000]);
});

test('a same-version unpack over a held pty.node is tried again and goes through, and three failures end failed with tar\'s line (M9 fix 1166)', async () => {
  const held: RunOutcome = { code: 1, stdout: '', stderrLast: 'tar.exe: Error exit delayed from previous errors' };
  const emUntar = (args: readonly string[]): boolean => args.at(-1)!.startsWith('tar -xzf') && args.at(-1)!.includes(`emerald-${V}.tgz`);
  const failing = (times: number) => {
    let left = times;
    const base = wfsAnswers(true);
    return (tool: string, args: readonly string[]): RunOutcome => {
      if (tool === 'ssh' && emUntar(args) && left > 0) {
        left--;
        return held;
      }
      return base(tool, args);
    };
  };

  const once = fakeRunner(failing(1));
  const a = deps(once.run, { sleep: async () => {} });
  assert.equal((await setupHost(wfs, a.d)).ok, true);
  assert.equal(once.calls.filter((c) => emUntar(c.args)).length, 2);
  assert.ok(a.logs.includes('host wfs-db: unpack failed (exit 1): tar.exe: Error exit delayed from previous errors; trying again in 2 s'));

  const thrice = fakeRunner(failing(3));
  const b = deps(thrice.run, { sleep: async () => {} });
  assert.deepEqual(await setupHost(wfs, b.d), { ok: false, line: 'tar.exe: Error exit delayed from previous errors' });
  assert.equal(thrice.calls.filter((c) => emUntar(c.args)).length, 3);
});

test('a Linux host ends failed with the pinned line after the record says linux', async () => {
  const { run, calls } = fakeRunner((_t, args) => (args.at(-1) === 'uname -sm; echo $HOME' ? ok('Linux x86_64\n/home/z\n') : ok()));
  const { d, pushes, records } = deps(run);
  const result = await setupHost({ ...wfs, name: 'lin' }, d);
  const line = 'lin runs Linux, and a pane there waits for a Linux build of emerald.';
  assert.deepEqual(result, { ok: false, line });
  assert.equal(records[0]!.os, 'linux');
  assert.equal(calls.length, 1);
  assert.deepEqual(pushes.at(-1), { host: 'lin', phase: 'failed', bytes: 0, startedAt: pushes[0]!.startedAt, line });
});

test('a probe exiting 255 on the host key ends failed with that line, hands main the refusal and runs nothing more', async () => {
  const { run, calls } = fakeRunner(() => ({ code: 255, stdout: '', stderrLast: 'Host key verification failed.' }));
  const refusals: unknown[] = [];
  const { d, pushes } = deps(run, { refused: (r) => void refusals.push(r) });
  assert.deepEqual(await setupHost(wfs, d), { ok: false, line: 'Host key verification failed.' });
  assert.equal(calls.length, 1);
  assert.deepEqual(refusals, [{ kind: 'hostkey', line: 'Host key verification failed.' }]);
  assert.deepEqual(pushes.map((p) => p.phase), ['probing', 'failed']);
});

test("a checksum miss in the kit ends failed with the kit's line", async () => {
  const { run } = fakeRunner(wfsAnswers(false));
  const miss = 'the Node download did not match SHASUMS256.txt: node-v24.20.0-win-x64.zip';
  const { d, pushes } = deps(run, { kit: async () => { throw new Error(miss); } });
  assert.deepEqual(await setupHost(wfs, d), { ok: false, line: miss });
  assert.equal(pushes.at(-1)!.line, miss);
});

test('Cancel during the copy ends the setup failed with cancelled and untars nothing', async () => {
  let release: (o: RunOutcome) => void = () => {};
  const answer = wfsAnswers(false);
  const { run, calls } = fakeRunner((tool, args) => (tool === 'scp' ? new Promise<RunOutcome>((r) => (release = r)) : answer(tool, args)));
  const { d, pushes } = deps(run);
  const going = setupHost(wfs, d);
  while (!calls.some((c) => c.tool === 'scp')) await new Promise((r) => setTimeout(r, 1));
  cancelSetup('wfs-db');
  const result = await going;
  release(ok());
  assert.deepEqual(result, { ok: false, line: 'cancelled' });
  assert.equal(calls.filter((c) => c.tool === 'scp').length, 1);
  assert.ok(!calls.some((c) => c.args.at(-1)!.startsWith('tar ')));
  assert.equal(pushes.at(-1)!.line, 'cancelled');
});

test('a hooks install that exits 1 still reaches done, logged', async () => {
  const answer = wfsAnswers(false);
  const { run } = fakeRunner((tool, args) => (args.at(-1)!.includes('hooks install') ? { code: 1, stdout: '', stderrLast: 'no settings' } : answer(tool, args)));
  const { d, pushes, logs } = deps(run);
  assert.equal((await setupHost(wfs, d)).ok, true);
  assert.equal(pushes.at(-1)!.phase, 'done');
  assert.ok(logs.includes('host wfs-db: hooks install failed (exit 1): no settings'));
});

test('a nokit from the connect after the copy says so', async () => {
  const { run } = fakeRunner(wfsAnswers(true));
  const refusal = Object.assign(new Error("& : The term 'x' is not recognized"), { kind: 'nokit' as const });
  const { d, records } = deps(run, { connect: async () => { throw refusal; } });
  assert.deepEqual(await setupHost(wfs, d), { ok: false, line: "wfs-db still has no kit after the copy: & : The term 'x' is not recognized" });
  assert.equal(records.length, 1, 'the kit versions are not recorded without a daemon');
});

test('a second setup while one runs shares its promise', async () => {
  let release: (o: RunOutcome) => void = () => {};
  const answer = wfsAnswers(true);
  let held = false;
  const { run } = fakeRunner((tool, args) => {
    if (!held && args.at(-1) === 'uname -sm; echo $HOME') {
      held = true;
      return new Promise<RunOutcome>((r) => (release = (o) => r(o)));
    }
    return answer(tool, args);
  });
  const { d } = deps(run);
  const a = setupHost(wfs, d);
  const b = setupHost(wfs, d);
  assert.equal(a, b);
  release(answer('ssh', ['uname -sm; echo $HOME']));
  assert.equal((await a).ok, true);
});

test('the old kits are pruned once per run, at a connect whose daemon is the recorded kit, never on an older one, and again for a new daemon (M9 fix 1165)', async () => {
  resetPruned();
  const { run, calls } = fakeRunner(() => ok());
  const logs: string[] = [];
  const host: RemoteHost = { ...wfs, home: WFS_HOME, shell: 'powershell', kitVersion: V, nodeVersion: '24.20.0' };
  assert.equal(await pruneOldKits(host, { ...DAEMON, version: '0.1.1048' }, { run, log: (m) => void logs.push(m) }), false);
  assert.equal(calls.length, 0);
  assert.equal(await pruneOldKits(host, DAEMON, { run, log: (m) => void logs.push(m) }), true);
  assert.equal(await pruneOldKits(host, DAEMON, { run, log: (m) => void logs.push(m) }), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.args.at(-1), pruneCommand({ home: WFS_HOME, shell: 'powershell', nodeVersion: '24.20.0', kitVersion: V }, V, '24.20.0'));
  assert.deepEqual(logs, ['host wfs-db: old kits removed']);
  assert.equal(await pruneOldKits(host, { ...DAEMON, pid: 8, startedAt: 2 }, { run, log: (m) => void logs.push(m) }), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(logs, ['host wfs-db: old kits removed', 'host wfs-db: old kits removed']);
});
