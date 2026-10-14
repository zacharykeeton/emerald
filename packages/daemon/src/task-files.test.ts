import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTaskFiles } from './task-files.js';

// A hook's session id is joined into the task folder's path (M9 fix 508),
// so one holding `..` must read nothing, however the folders lie.
test('readTaskFiles reads nothing for an id that is not an id, and a real one\'s folder (M9 fix 508)', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-task-files-')));
  try {
    const home = path.join(root, 'claude');
    const task = JSON.stringify({ id: '1', subject: 'the one', status: 'pending' });
    fs.mkdirSync(path.join(root, 'elsewhere'), { recursive: true });
    fs.writeFileSync(path.join(root, 'elsewhere', '1.json'), task);
    fs.mkdirSync(path.join(home, 'tasks', 'good-id'), { recursive: true });
    fs.writeFileSync(path.join(home, 'tasks', 'good-id', '1.json'), task);
    assert.deepEqual(await readTaskFiles('..\\..\\elsewhere', home), []);
    assert.deepEqual(await readTaskFiles('../../elsewhere', home), []);
    const read = await readTaskFiles('good-id', home);
    assert.equal(read.length, 1);
    assert.equal(read[0]!.subject, 'the one');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
