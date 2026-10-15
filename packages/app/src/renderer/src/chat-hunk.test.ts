import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Step, StepResult, StepTurn } from '@emerald/shared';
import { editHunk, lineOf, pendingEdit } from './chat-hunk.ts';

test('editHunk numbers the rows from the line the edit starts on (M9 fix 717)', () => {
  const rows = editHunk('one\nalpha\nthree', 'one\nbeta\ngamma\nthree', 2);
  assert.deepEqual(
    rows.map((r) => `${r.kind} ${r.text} ${r.line}`),
    ['context one 2', 'removed alpha 3', 'added beta 3', 'added gamma 4', 'context three 5'],
  );
  assert.deepEqual(
    editHunk('one\nalpha\nthree', 'one\nbeta\ngamma\nthree', null).map((r) => r.line),
    [null, null, null, null, null],
  );
});

test('editHunk folds past forty rows (M9 fix 717)', () => {
  const old = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const rows = editHunk(old, '', 1);
  assert.equal(rows.length, 41);
  assert.deepEqual(rows[40], { kind: 'more', text: '… 10 more lines', line: null });
  assert.ok(rows.slice(0, 40).every((r) => r.kind === 'removed'));
});

test('lineOf reads a CRLF text and answers null for an absent string (M9 fix 717)', () => {
  assert.equal(lineOf('zero\r\none\r\nalpha\r\nthree\r\n', 'one\nalpha'), 2);
  assert.equal(lineOf('zero\none\n', 'nope'), null);
  assert.equal(lineOf('zero\n', ''), null);
});

const turnOf = (steps: Step[]): StepTurn => ({ prompt: 'p', at: null, endAt: null, steps, images: [] });
const edit = (result: StepResult | null): Step => ({ kind: 'tool', id: 'e', name: 'Edit', arg: 'a.ts', input: { file_path: 'C:\\r\\a.ts', old_string: 'a', new_string: 'b' }, at: null, result });

test('pendingEdit finds an Edit waiting last, and nothing else (M9 fix 717)', () => {
  assert.deepEqual(pendingEdit([turnOf([edit(null)])]), { path: 'C:\\r\\a.ts', oldString: 'a', newString: 'b' });
  const done: StepResult = { error: false, exitCode: null, endAt: null, lines: null, added: 1, removed: 1, image: null };
  assert.equal(pendingEdit([turnOf([edit(done)])]), null);
  assert.equal(pendingEdit([turnOf([{ kind: 'tool', id: 'b', name: 'Bash', arg: 'ls', input: { command: 'ls' }, at: null, result: null }])]), null);
  assert.equal(pendingEdit([turnOf([edit(null), { kind: 'text', text: 'ok', at: null }])]), null);
  assert.equal(pendingEdit([]), null);
});
