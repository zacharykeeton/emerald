import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoadSampler, StubReplay, indexSweep, parseStub, parseSweepLine, readTree, sweepScript, treePids, treeReading, walkTree } from './load-sampler.ts';
import type { ProcRow, Sweep } from './load-sampler.ts';
import { removeWithPatience } from '@emerald/shared/test-temp';

const MB = 1024 * 1024;
const row = (pid: number, ppid: number, cpuMs: number, rss: number = 10 * MB, name: string = `p${pid}`, startMs: number = -1): ProcRow => ({ pid, ppid, cpuMs, rss, name, startMs });
const sweep = (at: number, rows: ProcRow[]): Sweep => ({ at, rows, childCpuMs: 0, wallMs: 0 });

// A box: a root shell 100 with claude 200 under it, claude's node 300
// and a build 400 under that, a stranger 500, and 600 whose parent id
// names a pid nobody has (its parent exited).
const box = (cpu: Record<number, number>): ProcRow[] => [
  row(100, 1, cpu[100] ?? 0, 20 * MB, 'powershell'),
  row(200, 100, cpu[200] ?? 0, 300 * MB, 'node'),
  row(300, 200, cpu[300] ?? 0, 50 * MB, 'node'),
  row(400, 300, cpu[400] ?? 0, 400 * MB, 'tsc'),
  row(500, 1, cpu[500] ?? 0, 10 * MB, 'stranger'),
  row(600, 999, cpu[600] ?? 0, 10 * MB, 'orphan'),
];

test('treePids walks the tree from the root by parent id, the root first', () => {
  assert.deepEqual(treePids(100, box({})), [100, 200, 300, 400]);
  assert.deepEqual(treePids(300, box({})), [300, 400]);
  assert.deepEqual(treePids(500, box({})), [500]);
  assert.deepEqual(treePids(700, box({})), [], 'a root not on the box is no tree');
});

test('treePids survives a cycle a reused pid draws', () => {
  // 200's parent id names 300, which is 200's own child.
  const rows = [row(100, 1, 0), row(200, 300, 0), row(300, 200, 0)];
  assert.deepEqual(treePids(200, rows), [200, 300]);
});

test('treeReading is the cpu delta of the tree over the wall time, in percent of one core, with the working sets summed', () => {
  const a = sweep(10_000, box({ 100: 50, 200: 1000, 300: 200, 400: 5000, 500: 900 }));
  // Four seconds on: claude burnt 400 ms, its node 100, the build 7500,
  // the stranger 4000 (which is not the tree's).
  const b = sweep(14_000, box({ 100: 50, 200: 1400, 300: 300, 400: 12_500, 500: 4900 }));
  const r = treeReading(a, b, 100);
  assert.ok(r !== null);
  assert.equal(r.sample.at, 14_000);
  // 8000 ms of cpu over 4000 ms of wall is two cores.
  assert.equal(r.sample.cpu, 200);
  assert.equal(r.sample.rss, 770);
  assert.deepEqual(r.names, ['powershell', 'node', 'tsc'], 'the names in tree order, each once');
});

test('treeReading is null with no earlier sweep, a gone root, or no process of the tree in the earlier sweep', () => {
  const a = sweep(10_000, box({}));
  const b = sweep(14_000, box({}));
  assert.equal(treeReading(null, b, 100), null, 'the first sweep of a tree yields nothing');
  assert.equal(treeReading(a, b, 700), null, 'no root');
  const fresh = sweep(14_000, [...box({}), row(800, 1, 100, 10 * MB, 'new'), row(900, 800, 100, 10 * MB, 'newer')]);
  assert.equal(treeReading(a, fresh, 800), null, 'a tree that was not there before has no rate yet');
  assert.equal(treeReading(b, sweep(14_000, box({})), 100), null, 'no time has passed');
});

test('treeReading skips a process the box would not read the cpu of, and clamps a reused pid', () => {
  const a = sweep(10_000, [row(100, 1, 1000), row(200, 100, -1, 30 * MB), row(300, 100, 5000)]);
  const b = sweep(12_000, [row(100, 1, 1500), row(200, 100, -1, 30 * MB), row(300, 100, 100)]);
  const r = treeReading(a, b, 100);
  assert.ok(r !== null);
  // 500 ms over 2000 ms; 200's unreadable time and 300's drop count nothing.
  assert.equal(r.sample.cpu, 25);
  assert.equal(r.sample.rss, 50, 'the unreadable process still counts its memory');
});

test('treeReading keeps a tenth of a percent and caps the names at eight', () => {
  const rows = [row(1, 0, 0, MB, 'root')];
  for (let i = 2; i <= 12; i++) rows.push(row(i, 1, 0, MB, `w${i}`));
  const a = sweep(0, rows);
  const b = sweep(4000, rows.map((r) => ({ ...r, cpuMs: r.pid === 1 ? 5 : 0 })));
  const r = treeReading(a, b, 1);
  assert.ok(r !== null);
  assert.equal(r.sample.cpu, 0.1);
  assert.equal(r.names.length, 8);
});

test('a stranger whose parent id names a newer process is not in its tree (M9 fix 514)', () => {
  const rows = (strangerStart: number) => [
    row(100, 1, 0, 10 * MB, 'claude', 1000),
    row(200, 100, 0, 10 * MB, 'node', 2000),
    // 900 lists 100 as its parent from a launcher that exited long ago,
    // and 100 is a later process that drew the same number.
    row(900, 100, 0, 10 * MB, 'chrome', strangerStart),
  ];
  assert.deepEqual(treePids(100, rows(500)), [100, 200]);
  assert.deepEqual(treePids(100, rows(1000)), [100, 200, 900], 'an equal start keeps the edge');
  assert.deepEqual(treePids(100, rows(-1)), [100, 200, 900], 'an unknown start keeps the edge');
});

test('one index per sweep reads every tree as a fresh read per root does (M9 fix 516)', () => {
  // 600 rows, the first hundred roots, each later row under a root or a
  // row before it; the second sweep has every cpu time moved on.
  const rows = (cpu: number) =>
    Array.from({ length: 600 }, (_, i) => row(1000 + i, i < 100 ? 4 : 1000 + ((i * 7) % i), cpu + i * 3, (i + 1) * MB, `p${i % 13}`));
  const a = sweep(1000, rows(0));
  const b = sweep(5000, rows(40));
  const ia = indexSweep(a);
  const ib = indexSweep(b);
  for (let root = 1000; root < 1100; root++) {
    assert.deepEqual(readTree(ia, ib, root), treeReading(a, b, root), `root ${root}`);
    assert.deepEqual(walkTree(root, ib), treePids(root, b.rows), `walk ${root}`);
  }
  assert.ok(readTree(ia, ib, 1000) !== null, 'a root reads');
});

test('parseSweepLine reads a row\'s start time as a sixth element, and -1 without one (M9 fix 514)', () => {
  const s = parseSweepLine('{"at":1,"p":[[1,0,10,1048576,"a",1700000000000],[2,1,20,1048576,"b"],[3,1,20,1048576,"c","x"]]}');
  assert.ok(s !== null);
  assert.deepEqual(
    s.rows.map((r) => r.startMs),
    [1700000000000, -1, -1],
  );
});

test('parseSweepLine reads the child line and skips a malformed row', () => {
  const s = parseSweepLine('{"at":123,"c":40,"w":55,"p":[[1,0,10,1048576,"a"],[2,1,"x",1,"b"],[3,1,20,2097152,"c"]]}');
  assert.ok(s !== null);
  assert.equal(s.at, 123);
  assert.equal(s.childCpuMs, 40);
  assert.equal(s.wallMs, 55);
  assert.deepEqual(
    s.rows.map((r) => r.pid),
    [1, 3],
  );
  assert.equal(parseSweepLine('not json'), null);
  assert.equal(parseSweepLine('{"p":[]}'), null, 'no time');
});

test('sweepScript names the tick and the method', () => {
  const gp = sweepScript(4000, 'gp');
  assert.ok(gp.includes('$tick = 4000'));
  assert.ok(gp.includes('GetProcesses()'));
  assert.ok(gp.includes('NtQueryInformationProcess'));
  const cim = sweepScript(500, 'cim');
  assert.ok(cim.includes('$tick = 500'));
  assert.ok(cim.includes('Win32_Process'));
  assert.ok(!cim.includes('GetProcesses()'));
  assert.ok(sweepScript(1, 'gp').includes('$tick = 50'), 'floored');
});

test('LoadSampler writes the sweep script to scriptPath before its child runs it as a file', async () => {
  // The encoded-command form held the daemon's start for seconds under
  // the app (the antivirus on the command line); the file form is what
  // ships, so a start must leave the script on disk.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-load-'));
  const scriptPath = path.join(dir, 'load-sweep.ps1');
  const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as import('./log.ts').Logger;
  const sampler = new LoadSampler({ log, tickMs: 60_000, method: 'gp', scriptPath, targets: () => [], onTick: () => {} });
  sampler.start();
  try {
    assert.ok(fs.existsSync(scriptPath), 'the script file');
    assert.ok(fs.readFileSync(scriptPath, 'utf8').includes('$tick = 60000'));
  } finally {
    sampler.stop();
    removeWithPatience(dir);
  }
});

test('LoadSampler restarts a sweep child that stays alive and stops writing (M9 fix 515)', async () => {
  // One valid sweep, then silence with the process kept alive.
  const hung = `process.stdout.write('{"at":1,"c":0,"w":0,"p":[]}\\n'); setInterval(() => {}, 1000);`;
  const children: ChildProcess[] = [];
  const warns: string[] = [];
  const log = { info: () => {}, warn: (msg: string) => warns.push(msg), error: () => {} } as unknown as import('./log.ts').Logger;
  const sampler = new LoadSampler({
    log,
    tickMs: 100,
    restartMs: 50,
    spawnSweep: () => {
      const c = spawn(process.execPath, ['-e', hung], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(c);
      return c;
    },
    targets: () => [],
    onTick: () => {},
  });
  const first = new Promise<void>((resolve) => {
    const wait = setInterval(() => {
      if (children[0] !== undefined) {
        clearInterval(wait);
        if (children[0].exitCode !== null || children[0].signalCode !== null) resolve();
        else children[0].once('exit', () => resolve());
      }
    }, 10);
  });
  sampler.start();
  try {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (children.length < 2 || warns.length === 0)) await new Promise((r) => setTimeout(r, 25));
    await Promise.race([first, new Promise((r) => setTimeout(r, 1000))]);
    const hungWarns = warns.filter((w) => /^load sweep hung for \d+ s; restarting it$/.test(w));
    assert.ok(hungWarns.length >= 1, `the warn: ${JSON.stringify(warns)}`);
    assert.ok(!warns.some((w) => w.includes('the sweep child exited')), 'no second line for the killed child');
    assert.ok(children[0]!.exitCode !== null || children[0]!.signalCode !== null, 'the first child has exited');
    assert.ok(children.length >= 2, `spawned ${children.length} times`);
  } finally {
    sampler.stop();
    for (const c of children) c.kill();
  }
});

test('parseStub reads the lists by name and skips what is not the shape', () => {
  const m = parseStub('{"a":[{"cpu":10,"rss":100},{"cpu":"x","rss":1},{"cpu":20,"rss":200,"names":["node",3]}],"b":"no","c":[]}');
  assert.ok(m !== null);
  assert.deepEqual([...m.keys()], ['a', 'c']);
  assert.deepEqual(m.get('a'), [
    { cpu: 10, rss: 100 },
    { cpu: 20, rss: 200, names: ['node'] },
  ]);
  assert.equal(parseStub('[]'), null);
  assert.equal(parseStub('nope'), null);
});

test('StubReplay hands each named session its next entry per tick, stops at the end, and starts over when the text changes', () => {
  const replay = new StubReplay();
  const targets = [
    { id: 'A', name: 'alpha', pid: 1 },
    { id: 'B', name: 'beta', pid: 2 },
  ];
  const text = JSON.stringify({ alpha: [{ cpu: 10, rss: 100, names: ['node'] }, { cpu: 20, rss: 110 }], beta: [{ cpu: 5, rss: 50 }] });
  const t1 = replay.tick(text, targets, 1000);
  assert.deepEqual(t1.get('A'), { sample: { at: 1000, cpu: 10, rss: 100 }, names: ['node'] });
  assert.deepEqual(t1.get('B'), { sample: { at: 1000, cpu: 5, rss: 50 }, names: [] });
  const t2 = replay.tick(text, targets, 2000);
  assert.deepEqual(t2.get('A'), { sample: { at: 2000, cpu: 20, rss: 110 }, names: [] });
  assert.equal(t2.has('B'), false, 'beta is exhausted');
  const t3 = replay.tick(text, targets, 3000);
  assert.equal(t3.size, 0, 'both exhausted');
  const t4 = replay.tick(JSON.stringify({ alpha: [{ cpu: 30, rss: 120 }] }), targets, 4000);
  assert.deepEqual(t4.get('A'), { sample: { at: 4000, cpu: 30, rss: 120 }, names: [] });
  assert.equal(t4.has('B'), false, 'no longer named');
  assert.equal(replay.tick(null, targets, 5000).size, 0, 'no file, nothing');
});
