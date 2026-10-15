import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_MENU, insideFolder, pathCandidate, resolveIn } from './chat-paths.ts';

test('the path menu is the rail items in order, a rule before the mention and the copy (M9 fix 717)', () => {
  assert.deepEqual(PATH_MENU.map((i) => i.label), ['Open in a tab', 'Open in a pane', 'Open with Windows', 'Reveal in Explorer', 'Mention in the message', 'Copy path']);
  assert.deepEqual(PATH_MENU.filter((i) => i.separator === true).map((i) => i.label), ['Mention in the message', 'Copy path']);
});

test('pathCandidate reads a path with its line, and refuses what is not one (M9 fix 716)', () => {
  assert.deepEqual(pathCandidate('docs/PLAN.md:12'), { rel: 'docs/PLAN.md', line: 12 });
  assert.deepEqual(pathCandidate('ChatView.tsx:372:5'), { rel: 'ChatView.tsx', line: 372 });
  assert.deepEqual(pathCandidate(' src\\a.ts '), { rel: 'src\\a.ts', line: null });
  for (const no of ['npm run build', 'https://x.io/a', '-v', 'foo', 'a*b.ts', '', 'x'.repeat(261) + '.ts']) assert.equal(pathCandidate(no), null, no);
});

test('resolveIn makes a path absolute in the folder, and insideFolder tells (M9 fix 716)', () => {
  const up = resolveIn('C:\\repo', '../x.md');
  assert.equal(up, 'C:\\x.md');
  assert.equal(insideFolder('C:\\repo', up!), false);
  assert.equal(resolveIn('C:\\repo', '//host/x.png'), null);
  assert.equal(resolveIn('C:\\repo', '\\\\host\\x'), null);
  assert.equal(resolveIn('C:\\repo', 'C:/repo/a/./b.ts'), 'C:\\repo\\a\\b.ts');
  assert.equal(resolveIn('C:\\repo', 'docs/a%20b.md#top'), 'C:\\repo\\docs\\a b.md');
  assert.equal(resolveIn('C:\\repo', 'a%E0.md'), null);
  assert.equal(resolveIn('', 'a.md'), null);
  assert.equal(insideFolder('C:\\Repo', 'c:\\repo\\docs\\a.md'), true);
  assert.equal(insideFolder('C:\\repo', 'C:\\repository\\a.md'), false);
});
