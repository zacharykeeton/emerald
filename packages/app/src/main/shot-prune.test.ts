import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneShots, shotsToPrune } from './shot-prune.ts';

const DAY = 24 * 60 * 60 * 1000;

test('shotsToPrune answers the PNGs strictly older than 14 days, in input order', () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const entries = [
    { name: 'a.png', mtimeMs: now - 15 * DAY },
    { name: 'b.png', mtimeMs: now - 13 * DAY },
    { name: 'c.PNG', mtimeMs: now - 20 * DAY },
    { name: 'd.png', mtimeMs: now - 14 * DAY },
    { name: 'e.txt', mtimeMs: now - 30 * DAY },
  ];
  assert.deepEqual(shotsToPrune(entries, now), ['a.png', 'c.PNG']);
});

test('pruneShots removes the old PNGs from design and screenshots and leaves the rest', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-shot-prune-'));
  try {
    const now = Date.now();
    const old = new Date(now - 15 * DAY);
    for (const dir of ['design', 'screenshots', 'downloads']) fs.mkdirSync(path.join(home, dir));
    for (const rel of ['design/old.png', 'screenshots/old.png', 'downloads/old.png']) {
      const file = path.join(home, rel);
      fs.writeFileSync(file, 'x');
      fs.utimesSync(file, old, old);
    }
    fs.writeFileSync(path.join(home, 'design', 'new.png'), 'x');
    const lines: string[] = [];
    const n = await pruneShots(home, now, (m) => lines.push(m));
    assert.equal(n, 2);
    assert.equal(fs.existsSync(path.join(home, 'design', 'old.png')), false);
    assert.equal(fs.existsSync(path.join(home, 'screenshots', 'old.png')), false);
    assert.equal(fs.existsSync(path.join(home, 'design', 'new.png')), true);
    assert.equal(fs.existsSync(path.join(home, 'downloads', 'old.png')), true);
    assert.deepEqual(lines, ['shots: removed 2 PNGs older than 14 days from design and screenshots']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('pruneShots answers 0 and logs nothing on a home with neither folder', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-shot-prune-'));
  try {
    const lines: string[] = [];
    assert.equal(await pruneShots(home, Date.now(), (m) => lines.push(m)), 0);
    assert.deepEqual(lines, []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
