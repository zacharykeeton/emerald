import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { savePastedPng } from './paste-file.ts';

test.after(removeTemps);

test('savePastedPng: writes paste-<now>.png and prunes the pastes over a day old', () => {
  const dir = mkTemp('emerald-paste-');
  const now = Date.now();
  const old = path.join(dir, 'paste-1.png');
  const recent = path.join(dir, 'paste-2.png');
  const other = path.join(dir, 'other.png');
  for (const p of [old, recent, other]) fs.writeFileSync(p, 'y');
  const at = (ms: number) => new Date(now - ms);
  fs.utimesSync(old, at(25 * 3600e3), at(25 * 3600e3));
  fs.utimesSync(recent, at(3600e3), at(3600e3));
  fs.utimesSync(other, at(25 * 3600e3), at(25 * 3600e3));
  const file = savePastedPng(dir, Buffer.from('x'), now);
  assert.equal(file, path.join(dir, `paste-${now}.png`));
  assert.equal(fs.readFileSync(file, 'utf8'), 'x');
  assert.equal(fs.existsSync(old), false, 'the day-old paste is gone');
  assert.equal(fs.existsSync(recent), true, 'the hour-old paste stays');
  assert.equal(fs.existsSync(other), true, 'a file not named paste-* stays');
});

test('savePastedPng: a missing folder is made', () => {
  const dir = path.join(mkTemp('emerald-paste-'), 'a', 'b');
  const file = savePastedPng(dir, Buffer.from('z'), 5);
  assert.equal(fs.readFileSync(file, 'utf8'), 'z');
});
