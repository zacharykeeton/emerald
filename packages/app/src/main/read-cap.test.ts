import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCapped } from './read-cap.ts';

// M9 fix 483: the read itself is bounded, whatever the stat said. A
// size hint smaller than the file stands in for a file that grew
// between the stat and the read, which is hard to stage for real.
test('readCapped reads a file at or under the cap whole and refuses one over it, past a stale size', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-readcap-'));
  try {
    const file = (name: string, bytes: number) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, Buffer.alloc(bytes, 97));
      return p;
    };
    assert.equal((await readCapped(file('under', 10), 10, 16))?.length, 10);
    assert.equal((await readCapped(file('grew', 10), 2, 16))?.length, 10, 'a file grown past its stat size is read to its end');
    assert.equal((await readCapped(file('at', 16), 3, 16))?.length, 16, 'exactly the cap is read');
    assert.equal(await readCapped(file('over', 17), 3, 16), null, 'one byte over is refused');
    assert.equal(await readCapped(file('far', 1000), 3, 16), null, 'a file that grew far past the cap is refused, not read');
    assert.equal((await readCapped(file('empty', 0), 0, 16))?.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
