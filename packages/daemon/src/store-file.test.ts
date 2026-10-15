import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { Logger } from './log.ts';
import { readFileRetried, setAsideBadFile, sweepStaleTemps, writeFileAtomic } from './store-file.ts';

function tempFile(name: string): string {
  return path.join(mkTemp('emerald-store-file-'), 'nested', name);
}

test.after(removeTemps);

function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (m) => lines.push(`info ${m}`), warn: (m) => lines.push(`warn ${m}`), error: (m) => lines.push(`error ${m}`) };
}

// Opens the file the way a scanner or an editor does, without sharing
// delete, so a rename over it is refused until the handle closes. Node's
// own opens share delete on Windows, so it takes another process.
// Resolves once the handle is open.
function holdOpen(file: string, ms: number, share: 'Read' | 'None' = 'Read'): Promise<ChildProcess> {
  const script =
    "$f = [IO.File]::Open($env:HOLD_FILE, 'Open', 'Read', $env:HOLD_SHARE); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); [Threading.Thread]::Sleep([int]$env:HOLD_MS); $f.Close()";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, HOLD_FILE: file, HOLD_MS: String(ms), HOLD_SHARE: share },
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('held')) resolve(child);
    });
    child.on('exit', (code) => reject(new Error(`holder exited ${code} before holding`)));
  });
}

function exited(child: ChildProcess): Promise<void> {
  return child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.on('exit', () => resolve()));
}

test('writeFileAtomic creates the folder, writes the text whole and leaves no temp file', () => {
  const file = tempFile('sessions.json');
  const log = recordingLogger();
  writeFileAtomic(file, 'one\n', log);
  writeFileAtomic(file, 'two\n', log);
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['sessions.json']);
  assert.deepEqual(log.lines, [], 'a rename that lands at once logs nothing');
});

test('a rename refused by a handle held for a moment is retried and lands once it closes (M9 fix 457)', { skip: process.platform !== 'win32' }, async () => {
  const file = tempFile('state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'old');
  // Measured on this box: the handle closes about 40 ms past the sleep
  // (Start-Sleep's own load added up to 200 more, so Thread.Sleep), so
  // 60 ms lets go near 100, inside the retries' 200 ms and past the
  // first try whatever the pipe's latency.
  const holder = await holdOpen(file, 60);
  const log = recordingLogger();
  writeFileAtomic(file, 'new', log);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.match(log.lines[0] ?? '', /^warn rename of state\.json refused \((EPERM|EBUSY|EACCES)\), trying again$/);
  assert.match(log.lines[1] ?? '', /^warn rename of state\.json landed on try \d$/);
  await exited(holder);
});

test('a rename refused past the retries throws with the old file whole, and the next write lands after the release', { skip: process.platform !== 'win32' }, async () => {
  const file = tempFile('prompts.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'old');
  const holder = await holdOpen(file, 1000);
  const log = recordingLogger();
  const started = Date.now();
  assert.throws(() => writeFileAtomic(file, 'new', log), (err: NodeJS.ErrnoException) => ['EPERM', 'EBUSY', 'EACCES'].includes(err.code ?? ''));
  const waited = Date.now() - started;
  assert.ok(waited >= 150 && waited < 900, `the retries waited about 200 ms, not ${waited}`);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old', 'the old file is whole');
  await exited(holder);
  writeFileAtomic(file, 'new', log);
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('readFileRetried waits out a reader that shares nothing (M9 fix 708)', { skip: process.platform !== 'win32' }, async () => {
  const file = tempFile('sessions.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'the list');
  const holder = await holdOpen(file, 120, 'None');
  const log = recordingLogger();
  // A bare read is refused while the handle shares nothing, which is what
  // made a store's load() answer an empty list.
  assert.throws(() => fs.readFileSync(file, 'utf8'), (err: NodeJS.ErrnoException) => err.code === 'EBUSY');
  assert.equal(readFileRetried(file, log), 'the list');
  assert.ok(log.lines.some((l) => /^warn read of sessions\.json refused \(EBUSY\), trying again$/.test(l)), log.lines.join(' | '));
  assert.ok(log.lines.some((l) => /^warn read of sessions\.json landed on try \d$/.test(l)), log.lines.join(' | '));
  await exited(holder);
});

test('readFileRetried on a missing file throws ENOENT and logs nothing (M9 fix 708)', () => {
  const log = recordingLogger();
  assert.throws(() => readFileRetried(tempFile('gone.json'), log), (err: NodeJS.ErrnoException) => err.code === 'ENOENT');
  assert.deepEqual(log.lines, []);
});

test('setAsideBadFile moves the file to a stamped name, a second in the same moment to a numbered one, and logs at error', () => {
  const file = tempFile('folders.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const log = recordingLogger();
  fs.writeFileSync(file, 'first');
  const a = setAsideBadFile(file, log);
  fs.writeFileSync(file, 'second');
  const b = setAsideBadFile(file, log);
  assert.ok(a !== null && b !== null && a !== b);
  assert.match(path.basename(a), /^folders\.json\.bad-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z(-\d+)?$/, 'no colon in the name');
  assert.equal(fs.readFileSync(a, 'utf8'), 'first');
  assert.equal(fs.readFileSync(b, 'utf8'), 'second');
  assert.equal(fs.existsSync(file), false);
  assert.equal(log.lines.length, 2);
  assert.ok(log.lines.every((l) => l.startsWith('error ') && l.includes('set aside as')));
});

test('setAsideBadFile on a file that cannot be moved answers null and says so', () => {
  const log = recordingLogger();
  assert.equal(setAsideBadFile(tempFile('gone.json'), log), null);
  assert.match(log.lines[0] ?? '', /could not be set aside/);
});

// Two daemons on one home write temps of their own (M9 fix 556); one that
// died between a write and its rename leaves its temp, which the start's
// sweep removes once it is a minute old, judged by its age alone.
test('a store\'s temp carries the pid, and the start\'s sweep removes a stale one and keeps a fresh one (M9 fix 556)', () => {
  const dir = mkTemp('emerald-store-sweep-');
  try {
    const old = (Date.now() - 2 * 60_000) / 1000;
    for (const name of ['sessions.json.123.tmp', 'state.json.tmp', 'folders.json.456.tmp', 'notes.tmp']) fs.writeFileSync(path.join(dir, name), 'x');
    for (const name of ['sessions.json.123.tmp', 'state.json.tmp', 'notes.tmp']) fs.utimesSync(path.join(dir, name), old, old);
    const removed = sweepStaleTemps(dir, { info() {}, warn() {}, error() {} });
    assert.deepEqual([...removed].sort(), ['sessions.json.123.tmp', 'state.json.tmp']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['folders.json.456.tmp', 'notes.tmp']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The temp's name is read through what an open does with it (M9 fix 556):
// a directory in the pid's temp spot makes the write fail and land
// nothing, and one in the old fixed spot lets it through, so the template
// losing the pid or going back to a fixed name fails one of the two.
test('writeFileAtomic writes through a temp named with this process\'s pid (M9 fix 556)', () => {
  const dir = mkTemp('emerald-store-pid-');
  const log = { info() {}, warn() {}, error() {} };
  const file = path.join(dir, 'state.json');
  fs.mkdirSync(`${file}.${process.pid}.tmp`);
  assert.throws(() => writeFileAtomic(file, 'x', log), (err: NodeJS.ErrnoException) => err.code === 'EISDIR');
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(`${file}.${process.pid}.tmp`, { recursive: true });
  fs.mkdirSync(`${file}.tmp`);
  writeFileAtomic(file, 'x', log);
  assert.equal(fs.readFileSync(file, 'utf8'), 'x');
});
