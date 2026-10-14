import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GAP_MS, gapNotice, gapState, installingNotice, readMarker, secondsToGo, writeMarker } from './install-gap.ts';

const t0 = Date.parse('2026-09-18T10:00:00.000Z');
const marker = { version: '0.1.274', at: new Date(t0).toISOString() };

test('the three states: another version young is the gap, this version or an old one is fresh, no marker is none (M9 fix 282)', () => {
  assert.equal(gapState(null, '0.1.258', t0 + 20000), 'none');
  assert.equal(gapState(marker, '0.1.258', t0 + 20000), 'gap');
  assert.equal(gapState(marker, '0.1.258', t0 + GAP_MS - 1), 'gap');
  assert.equal(gapState(marker, '0.1.258', t0 + GAP_MS), 'fresh');
  assert.equal(gapState(marker, '0.1.274', t0 + 20000), 'fresh');
  assert.equal(gapState({ version: '0.1.274', at: 'not a date' }, '0.1.258', t0), 'fresh');
});

test('the seconds to go count down from the minute in tens and never reach zero', () => {
  assert.equal(secondsToGo(marker, t0 + 20000), 40);
  assert.equal(secondsToGo(marker, t0 + 24000), 40);
  assert.equal(secondsToGo(marker, t0 + 26000), 30);
  assert.equal(secondsToGo(marker, t0 + 90000), 10);
  assert.equal(secondsToGo(marker, t0), 60);
});

test('the two notices', () => {
  assert.deepEqual(installingNotice('0.1.274'), { title: 'Installing emerald 0.1.274', body: 'The window closes now and comes back on its own in about a minute.' });
  assert.deepEqual(gapNotice(marker, t0 + 20000), { title: 'Still installing emerald 0.1.274', body: 'About 40 s to go; the window comes back on its own.' });
});

test('the marker round-trips through the file, and a missing or malformed file reads as none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-gap-'));
  const file = path.join(dir, 'installing.json');
  assert.equal(readMarker(file), null);
  writeMarker(file, '0.1.274', t0);
  assert.deepEqual(readMarker(file), marker);
  fs.writeFileSync(file, '{"version": 1}');
  assert.equal(readMarker(file), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
