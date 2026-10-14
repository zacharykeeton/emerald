import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rotateLogAtStart } from './log.ts';

// M9 fix 499: emmerd.log keeps one generation past its threshold, moved
// aside at a start.
test('the daemon log rotates past its threshold, keeping one generation', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-log-'));
  try {
    const file = path.join(dir, 'emmerd.log');
    const old = path.join(dir, 'emmerd.1.log');
    assert.equal(rotateLogAtStart(file), null, 'no file answers null');

    fs.writeFileSync(file, Buffer.alloc(9 * 1024 * 1024, 'a'));
    assert.equal(rotateLogAtStart(file), 9 * 1024 * 1024);
    assert.equal(fs.existsSync(file), false, 'the live file is moved');
    assert.equal(fs.statSync(old).size, 9 * 1024 * 1024);

    fs.writeFileSync(file, Buffer.alloc(9 * 1024 * 1024 + 1, 'b'));
    assert.equal(rotateLogAtStart(file), 9 * 1024 * 1024 + 1);
    assert.equal(fs.readFileSync(old, 'utf8').slice(0, 1), 'b', 'a second rotation replaces the older generation');

    fs.writeFileSync(file, Buffer.alloc(1024, 'c'));
    assert.equal(rotateLogAtStart(file), null, 'a small file is left');
    assert.equal(fs.statSync(file).size, 1024);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
