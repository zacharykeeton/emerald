import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { createUseRecord } from './use-record.ts';

after(() => removeTemps());

function lines(file: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('two writes give two lines with at from the clock (M9 fix 676)', () => {
  const dir = mkTemp('emerald-userec-');
  const file = path.join(dir, 'logs', 'usage.jsonl');
  let t = 1000;
  const rec = createUseRecord(file, () => {}, { now: () => t++ });
  rec.write({ ev: 'action', name: 'split-vertical', from: 'key', view: 'empty-pane' });
  rec.write({ ev: 'view-open', view: 'cheat-sheet' });
  assert.deepEqual(lines(file), [
    { at: 1000, ev: 'action', name: 'split-vertical', from: 'key', view: 'empty-pane' },
    { at: 1001, ev: 'view-open', view: 'cheat-sheet' },
  ]);
});

test('a refused line writes nothing and logs once over three tries', () => {
  const dir = mkTemp('emerald-userec-');
  const file = path.join(dir, 'usage.jsonl');
  const logged: string[] = [];
  const rec = createUseRecord(file, (m) => logged.push(m));
  rec.write({ ev: 'action', name: 'not-a-feature', from: 'key' });
  rec.write({ ev: 'typed', text: 'secret' });
  rec.write(null);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(logged, ['usage record: a line refused']);
});

test('rotation keeps four generations and never a fifth, the newest lines in the current file', () => {
  const dir = mkTemp('emerald-userec-');
  const file = path.join(dir, 'usage.jsonl');
  let t = 0;
  const rec = createUseRecord(file, () => {}, { now: () => t++, rotateAtBytes: 200 });
  for (let i = 0; i < 100; i++) rec.write({ ev: 'view-close', view: 'file-tab', ms: i });
  for (const n of [1, 2, 3, 4]) assert.ok(fs.existsSync(path.join(dir, `usage.${n}.jsonl`)), `usage.${n}.jsonl`);
  assert.equal(fs.existsSync(path.join(dir, 'usage.5.jsonl')), false);
  const current = lines(file);
  assert.equal(current.at(-1)?.ms, 99);
  for (const gen of [1, 2, 3, 4]) {
    const each = lines(path.join(dir, `usage.${gen}.jsonl`));
    assert.ok(Number(each.at(-1)?.ms) < Number(current[0]?.ms), `generation ${gen} is older than the current file`);
  }
  assert.ok(fs.statSync(file).size <= 200);
});
