import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { envValue, findOnPath } from './launchers/find-on-path.ts';

test.after(removeTemps);

// A folder holding an empty tool.exe and tool.com: findOnPath only asks
// whether a candidate is a file.
function toolDir(): string {
  const dir = mkTemp('emerald-find-on-path-');
  fs.writeFileSync(path.join(dir, 'tool.exe'), '');
  fs.writeFileSync(path.join(dir, 'tool.com'), '');
  return dir;
}

test('findOnPath reads a PATH spelled in lower case (M9 fix 999)', () => {
  const dir = toolDir();
  assert.equal(findOnPath('tool', { path: dir }), path.join(dir, 'tool.exe'));
});

test('findOnPath reads a PATHEXT spelled in lower case (M9 fix 999)', () => {
  const dir = toolDir();
  assert.equal(findOnPath('tool', { Path: dir, pathext: '.COM' }), path.join(dir, 'tool.com'));
});

test('findOnPath with no PATH at all finds nothing (M9 fix 999)', () => {
  assert.equal(findOnPath('tool', {}), null);
});

test('envValue takes the exact key first, else any spelling, else undefined (M9 fix 999)', () => {
  assert.equal(envValue({ Path: 'a', PATH: 'b' }, 'PATH'), 'b');
  assert.equal(envValue({ comspec: 'c' }, 'ComSpec'), 'c');
  assert.equal(envValue({}, 'PATH'), undefined);
});
