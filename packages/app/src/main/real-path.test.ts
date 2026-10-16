import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realPath } from './real-path.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-path-'));
fs.writeFileSync(path.join(dir, 'a.md'), '# a\n');
const long = fs.realpathSync.native(dir);
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('realPath: the long spelling of a folder, a file and a file not made yet (M9 fix 751)', () => {
  assert.equal(realPath(dir), long);
  assert.equal(realPath(path.join(dir, 'a.md')), path.join(long, 'a.md'));
  assert.equal(realPath(path.join(dir, 'new.md')), path.join(long, 'new.md'));
  const gone = path.join(dir, 'gone', 'x.md');
  assert.equal(realPath(gone), gone);
  assert.equal(realPath('src/a.ts'), 'src/a.ts');
});

test('realPath: a short 8.3 temp folder comes back long', { skip: os.tmpdir().includes('~') ? false : '8.3 names are off on this box' }, () => {
  assert.ok(!realPath(dir).includes('~'), realPath(dir));
});
