import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SearchRuns, searchContents } from './search-files.ts';

// The temp folder by its long name (the M75 bullet: %TEMP% is 8.3 here).
function tempTree(): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-search-'));
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'c'));
  fs.writeFileSync(path.join(dir, 'top.txt'), 'nothing here\n');
  fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.txt'), 'one\ntwo\nthe needle sits here\n');
  fs.writeFileSync(path.join(dir, 'c', 'other.txt'), 'no match\n');
  return dir;
}

test('a contents search with no signal finds the word with its line', async () => {
  const dir = tempTree();
  try {
    const r = await searchContents(dir, 'needle');
    assert.equal(r.truncated, false);
    assert.deepEqual(r.hits.map((h) => [h.name, h.line]), [['a/b/deep.txt', 3]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a search whose signal is aborted before the call answers nothing, truncated', async () => {
  const dir = tempTree();
  try {
    const c = new AbortController();
    c.abort();
    assert.deepEqual(await searchContents(dir, 'needle', c.signal), { hits: [], truncated: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SearchRuns aborts the older search of a window, stops, and leaves other windows alone', () => {
  const runs = new SearchRuns();
  const first = runs.begin(1);
  const other = runs.begin(2);
  const second = runs.begin(1);
  assert.equal(first.aborted, true);
  assert.equal(second.aborted, false);
  // A late end for the first search keeps the second's entry, so stop
  // still reaches it.
  runs.end(1, first);
  runs.stop(1);
  assert.equal(second.aborted, true);
  assert.equal(other.aborted, false);
  // After an end with the current signal there is nothing left to stop.
  const third = runs.begin(1);
  runs.end(1, third);
  runs.stop(1);
  assert.equal(third.aborted, false);
});
