import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findingPlace, findingsHead, findingsOf, fixPrompt, isReviewPrompt } from './chat-findings.ts';
import type { Finding } from './chat-findings.ts';

// M9 fix 1170: the two shapes Claude Code 2.1.322 prints for a forked
// /code-review, the formatter's list (the bundle's `Ut`) and the fork's
// own one line per finding.

const LIST =
  '3 findings, most severe first:\n\n' +
  '1. `notes.txt:2`: The second line is never read.\n\n   Failure scenario: A two-line file stops the loop at line 1.\n\n' +
  '2. `notes.txt:3`: The last line is dropped.\n   It never reaches the writer.\n\n   Failure scenario: Three lines read as two.\n\n' +
  '3. `src/a.ts`: The save is not awaited.';

test('findingsOf reads the formatter\'s list (M9 fix 1170)', () => {
  const r = findingsOf(LIST);
  assert.notEqual(r, null);
  assert.equal(r!.shape, 'list');
  assert.deepEqual(r!.findings, [
    { n: 1, file: 'notes.txt', line: 2, summary: 'The second line is never read.', scenario: 'A two-line file stops the loop at line 1.' },
    { n: 2, file: 'notes.txt', line: 3, summary: 'The last line is dropped.\nIt never reaches the writer.', scenario: 'Three lines read as two.' },
    { n: 3, file: 'src/a.ts', line: null, summary: 'The save is not awaited.', scenario: null },
  ]);
});

test('findingsOf (M9 fix 1170): one finding, eleven findings dedented by their own number\'s width, a range\'s first line', () => {
  const one = findingsOf('1 finding:\n\n1. `a.ts:4`: Off by one.\n\n   Failure scenario: An empty list.');
  assert.deepEqual(one, { shape: 'list', findings: [{ n: 1, file: 'a.ts', line: 4, summary: 'Off by one.', scenario: 'An empty list.' }] });
  const items = Array.from({ length: 11 }, (_, i) => {
    const pad = ' '.repeat(`${i + 1}. `.length);
    return `${i + 1}. \`f${i + 1}.ts:${i + 1}\`: First line ${i + 1}.\n${pad}Second line ${i + 1}.`;
  });
  const eleven = findingsOf(`11 findings, most severe first:\n\n${items.join('\n\n')}`);
  assert.equal(eleven?.findings.length, 11);
  assert.equal(eleven!.findings[10]!.summary, 'First line 11.\nSecond line 11.', 'item 11 dedented by four spaces');
  assert.equal(eleven!.findings[8]!.summary, 'First line 9.\nSecond line 9.', 'item 9 by three');
  const range = findingsOf('1 finding:\n\n1. `src/x.ts:10-12`: A range.');
  assert.equal(range!.findings[0]!.file, 'src/x.ts');
  assert.equal(range!.findings[0]!.line, 10);
});

test('findingsOf (M9 fix 1170): anything neither shape reads is null, drawn as the divider', () => {
  assert.equal(findingsOf('No findings.'), null);
  assert.equal(findingsOf('(none)'), null);
  assert.equal(findingsOf('3 findings, most severe first:\n\n1. `a.ts:1`: One.\n\n2. `b.ts:2`: Two.'), null, 'a head of three over two items');
  assert.equal(findingsOf('2 findings, most severe first:\n\n2. `a.ts:1`: One.\n\n1. `b.ts:2`: Two.'), null, 'an item numbered out of order');
});

test('findingsOf reads the fork\'s own lines (M9 fix 1170)', () => {
  const r = findingsOf('Reviewed the diff.\n- `notes.txt:2` — The loop stops one line early.\nsrc/b.ts:7 — The save is not awaited.');
  assert.deepEqual(r, {
    shape: 'lines',
    findings: [
      { n: 1, file: 'notes.txt', line: 2, summary: 'The loop stops one line early.', scenario: null },
      { n: 2, file: 'src/b.ts', line: 7, summary: 'The save is not awaited.', scenario: null },
    ],
  });
});

// The <result> of the task notification the first real run wrote
// (verify:chat's findings-real, Claude Code 2.1.322, 2026-11-12), the
// scenario cut short.
const REAL_RESULT =
  '```json\n[\n  {\n    "file": "even.js",\n    "line": 2,\n    "summary": "isEven now checks for odd: `n % 2 === 1` is true for odd numbers.",\n    "failure_scenario": "isEven(2) returns false and isEven(3) returns true."\n  }\n]\n```\n\nThe diff changes one line in `C:\\x\\even.js`, and it isn\'t committed yet. It is the only real bug.';

test('findingsOf reads a background review\'s JSON, fenced or bare (M9 fix 1170)', () => {
  assert.deepEqual(findingsOf(REAL_RESULT), {
    shape: 'json',
    findings: [{ n: 1, file: 'even.js', line: 2, summary: 'isEven now checks for odd: `n % 2 === 1` is true for odd numbers.', scenario: 'isEven(2) returns false and isEven(3) returns true.' }],
  });
  const bare = findingsOf('[{"file":"a.ts","line":"10-12","summary":"A range."},{"file":"b.ts","line":0,"summary":"No line.","failure_scenario":null},{"file":"c.ts","summary":"Absent line."}]');
  assert.deepEqual(
    bare?.findings.map((f) => [f.n, f.file, f.line, f.scenario]),
    [
      [1, 'a.ts', 10, null],
      [2, 'b.ts', null, null],
      [3, 'c.ts', null, null],
    ],
  );
  assert.equal(findingsOf('```json\n[]\n```'), null, 'an empty array is No findings., drawn as before');
  assert.equal(findingsOf('[{"file":"a.ts"}]'), null, 'a finding with no summary');
  assert.equal(findingsOf('[1, 2]'), null);
  assert.equal(findingsOf('```json\n[{"file": \n```'), null, 'JSON that does not parse');
});

test('isReviewPrompt (M9 fix 1170): /code-review and its alias, with any arguments', () => {
  assert.equal(isReviewPrompt('/code-review'), true);
  assert.equal(isReviewPrompt('/code-review high --fix'), true);
  assert.equal(isReviewPrompt('/review'), true);
  assert.equal(isReviewPrompt('/code-reviewer'), false);
  assert.equal(isReviewPrompt('review this'), false);
});

test('fixPrompt, findingPlace and findingsHead (M9 fix 1170)', () => {
  const f = (n: number, file: string, line: number | null, summary: string): Finding => ({ n, file, line, summary, scenario: null });
  assert.equal(fixPrompt([f(2, 'notes.txt', 3, 'The last line is dropped.')]), 'Fix finding 2 of the code review above. 2: notes.txt:3, The last line is dropped.');
  assert.equal(
    fixPrompt([f(1, 'notes.txt', 2, 'The second line is never read.'), f(3, 'src/a.ts', null, 'The save is not awaited')]),
    'Fix findings 1 and 3 of the code review above. 1: notes.txt:2, The second line is never read. 3: src/a.ts, The save is not awaited.',
  );
  assert.equal(
    fixPrompt([f(1, 'a.ts', 1, 'One.'), f(3, 'b.ts', 2, 'Two lines\n   of it.'), f(4, 'c.ts', null, 'Why?'), f(5, 'd.ts', 9, 'Five!')]),
    'Fix findings 1, 3, 4 and 5 of the code review above. 1: a.ts:1, One. 3: b.ts:2, Two lines of it. 4: c.ts, Why? 5: d.ts:9, Five!',
  );
  assert.equal(findingPlace(f(1, 'a.ts', 4, '')), 'a.ts:4');
  assert.equal(findingPlace(f(1, 'a.ts', null, '')), 'a.ts');
  assert.equal(findingsHead(1), 'Code review · 1 finding');
  assert.equal(findingsHead(3), 'Code review · 3 findings');
});
