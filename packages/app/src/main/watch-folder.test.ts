import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { watchFolder } from './watch-folder.ts';

// M9 fix 481. os.tmpdir() is in 8.3 form on some boxes (a GitHub Actions runner's is
// C:\Users\RUNNER~1\...), and a bare fs.watch on a folder named that way
// aborts the process at its first change, so this case runs in a child:
// a failure is the child's exit code, not the test runner's death.
test('a folder named in short form is watched and reports a change, in a child process', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-watch-short-'));
  try {
    const helper = pathToFileURL(path.join(import.meta.dirname, 'watch-folder.ts')).href;
    const code = [
      `import fs from 'node:fs';`,
      `import path from 'node:path';`,
      `const { watchFolder } = await import(${JSON.stringify(helper)});`,
      `const dir = ${JSON.stringify(dir)};`,
      `let changes = 0;`,
      `const w = watchFolder(dir, () => { changes++; }, () => {});`,
      `if (w === null) { console.log('no watcher'); process.exit(2); }`,
      `fs.writeFileSync(path.join(dir, 'a.txt'), 'x');`,
      `setTimeout(() => { w.close(); console.log('changes', changes); process.exit(changes > 0 ? 0 : 3); }, 500);`,
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(r.status, 0, `child exit ${String(r.status)}: ${r.stdout}${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M9 fix 551: the rail relists only when a name came or went, so the
// watcher hands on the event's type: appends to a file already there are
// `change`, a new file is (at least) a `rename`.
test('a change to a file inside reports change, a new name reports rename, in a child process', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-watch-kind-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const helper = pathToFileURL(path.join(import.meta.dirname, 'watch-folder.ts')).href;
    const code = [
      `import fs from 'node:fs';`,
      `import path from 'node:path';`,
      `const { watchFolder } = await import(${JSON.stringify(helper)});`,
      `const dir = ${JSON.stringify(dir)};`,
      `const sleep = (ms) => new Promise((r) => setTimeout(r, ms));`,
      `let events = [];`,
      `const w = watchFolder(dir, (name, event) => { events.push(event + ':' + name); }, () => {});`,
      `if (w === null) { console.log('no watcher'); process.exit(2); }`,
      `await sleep(100);`,
      `for (let i = 0; i < 3; i++) { fs.appendFileSync(path.join(dir, 'a.txt'), 'y'); await sleep(50); }`,
      `await sleep(300);`,
      `const appends = events; events = [];`,
      `fs.writeFileSync(path.join(dir, 'b.txt'), 'z');`,
      `await sleep(300);`,
      `w.close();`,
      `console.log(JSON.stringify([appends, events]));`,
      `process.exit(appends.length > 0 && appends.every((e) => e === 'change:a.txt') && events.includes('rename:b.txt') ? 0 : 3);`,
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(r.status, 0, `child exit ${String(r.status)}: ${r.stdout}${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a watched folder that is deleted ends the watch once, and the spin stops', async () => {
  const base = fs.realpathSync.native(os.tmpdir());
  const parent = fs.mkdtempSync(path.join(base, 'emerald-watch-gone-'));
  const dir = path.join(parent, 'watched');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  try {
    let gone = 0;
    let changesAfterGone = 0;
    const w = watchFolder(
      dir,
      () => {
        if (gone > 0) changesAfterGone++;
      },
      () => {
        gone++;
      },
    );
    assert.ok(w !== null);
    // A change inside is a change, not a delete.
    fs.writeFileSync(path.join(dir, 'b.txt'), 'y');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(gone, 0, 'a file written inside does not end the watch');
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 100));
    const cpu = process.cpuUsage();
    await new Promise((r) => setTimeout(r, 500));
    const spent = process.cpuUsage(cpu);
    assert.equal(gone, 1, 'onGone once');
    assert.equal(changesAfterGone, 0, 'no change reported once the watch has ended');
    const ms = (spent.user + spent.system) / 1000;
    assert.ok(ms < 50, `${ms} ms of CPU in the 500 ms after the delete`);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a folder that is not there answers null', () => {
  const base = fs.realpathSync.native(os.tmpdir());
  assert.equal(watchFolder(path.join(base, 'emerald-watch-never-there-0f3a'), () => {}, () => {}), null);
});
