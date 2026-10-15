import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FolderWatchers } from './folder-watchers.ts';

// M9 fix 722: a wanted folder that could not be watched is tried again on
// a clock and pushed once when the watch takes, so a chat view whose
// transcript folder Claude Code makes at its first write reads it.

const RETRY_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tempRoot(tag: string): string {
  return fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), `emerald-fw-${tag}-`));
}

async function until(read: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (read()) return;
    await sleep(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a wanted folder made after set, its parent missing too, is watched within a retry and pushed once (M9 fix 722)', async () => {
  const root = tempRoot('late');
  const dir = path.join(root, 'a', 'b');
  const pushes: [string, boolean][] = [];
  const w = new FolderWatchers((d, r) => pushes.push([d, r]), RETRY_MS);
  try {
    w.set([dir]);
    await sleep(500);
    assert.deepEqual(pushes, []);
    fs.mkdirSync(dir, { recursive: true });
    await until(() => pushes.length > 0, 'the push on the watch taking');
    await sleep(300);
    assert.deepEqual(pushes, [[dir, true]]);
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    await until(() => pushes.length > 1, 'a change push once watched');
    assert.equal(pushes[1]?.[0], dir);
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a folder the next set drops is not retried (M9 fix 722)', async () => {
  const root = tempRoot('drop');
  const dir = path.join(root, 'a');
  const pushes: [string, boolean][] = [];
  const w = new FolderWatchers((d, r) => pushes.push([d, r]), RETRY_MS);
  try {
    w.set([dir]);
    w.set([]);
    fs.mkdirSync(dir);
    await sleep(500);
    assert.deepEqual(pushes, []);
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a folder there at set gets no push for being watched (M9 fix 722)', async () => {
  const root = tempRoot('there');
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir);
  const pushes: [string, boolean][] = [];
  const w = new FolderWatchers((d, r) => pushes.push([d, r]), RETRY_MS);
  try {
    w.set([dir]);
    await sleep(500);
    assert.deepEqual(pushes, []);
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a watched folder deleted and made again is watched again and pushed (M9 fix 722)', async () => {
  const root = tempRoot('again');
  const dir = path.join(root, 'a');
  fs.mkdirSync(dir);
  const pushes: [string, boolean][] = [];
  const w = new FolderWatchers((d, r) => pushes.push([d, r]), RETRY_MS);
  try {
    w.set([dir]);
    fs.rmSync(dir, { recursive: true, force: true });
    await until(() => pushes.some(([d, r]) => d === dir && r), 'the gone push');
    const afterGone = pushes.length;
    fs.mkdirSync(dir);
    await until(() => pushes.length > afterGone, 'the push on the watch taking again');
    assert.deepEqual(pushes[afterGone], [dir, true]);
    const afterTake = pushes.length;
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    await until(() => pushes.length > afterTake, 'a change push once watched again');
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('close stops the clock (M9 fix 722)', async () => {
  const root = tempRoot('close');
  const dir = path.join(root, 'a');
  const pushes: [string, boolean][] = [];
  const w = new FolderWatchers((d, r) => pushes.push([d, r]), RETRY_MS);
  try {
    w.set([dir]);
    w.close();
    fs.mkdirSync(dir);
    await sleep(500);
    assert.deepEqual(pushes, []);
  } finally {
    w.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
