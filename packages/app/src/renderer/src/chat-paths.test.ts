import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_MENU, drivePathsIn, folderPath, insideFolder, pathCandidate, promptParts, resolveIn } from './chat-paths.ts';

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

test('folderPath answers a path inside the folder and null outside it (M9 fix 756)', () => {
  assert.equal(folderPath('C:\\repo', 'docs/a.md'), 'C:\\repo\\docs\\a.md');
  assert.equal(folderPath('C:\\repo', '../x.md'), null);
  assert.equal(folderPath('C:\\repo', 'C:/other/x.ts'), null);
  assert.equal(folderPath('C:\\repo', 'C:/repo/x.ts'), 'C:\\repo\\x.ts');
  assert.equal(folderPath('', 'a.md'), null);
});

test('drivePathsIn finds the drive paths in a run of text with their lines, and promptParts links the files among them (M9 fix 1099)', () => {
  const found = drivePathsIn('Read C:\\Users\\me\\Temp\\h.md and docs/PLAN.md, C:/x/y.ts:12 and https://e.io/a');
  assert.deepEqual(
    found.map((l) => [l.text, l.abs, l.line]),
    [
      ['C:\\Users\\me\\Temp\\h.md', 'C:\\Users\\me\\Temp\\h.md', null],
      ['C:/x/y.ts:12', 'C:\\x\\y.ts', 12],
    ],
  );
  const prompt = 'Read C:\\Users\\me\\Temp\\h.md and do what it says.';
  const file = (abs: string) => (abs === 'C:\\Users\\me\\Temp\\h.md' ? ('file' as const) : undefined);
  assert.deepEqual(promptParts(prompt, '', file), {
    parts: [
      { text: 'Read ', path: null, line: null },
      { text: 'C:\\Users\\me\\Temp\\h.md', path: 'C:\\Users\\me\\Temp\\h.md', line: null },
      { text: ' and do what it says.', path: null, line: null },
    ],
    ask: [],
  });
  assert.deepEqual(promptParts(prompt, '', () => undefined), { parts: [{ text: prompt, path: null, line: null }], ask: ['C:\\Users\\me\\Temp\\h.md'] });
  assert.deepEqual(promptParts(prompt, '', () => 'other'), { parts: [{ text: prompt, path: null, line: null }], ask: [] });
});

test('promptParts links a relative path, an @ mention and a bare name inside the folder, never one outside it or a non-file (M9 fix 1135)', () => {
  const text = 'Compare docs/PLAN.md, @docs/a.md and README.md, not ../x.md or docs/none.md.';
  const files = new Set(['C:\\repo\\docs\\PLAN.md', 'C:\\repo\\docs\\a.md', 'C:\\repo\\README.md']);
  const known = (abs: string) => (files.has(abs) ? ('file' as const) : abs === 'C:\\repo\\docs\\none.md' ? ('other' as const) : undefined);
  const plain = (t: string) => ({ text: t, path: null, line: null });
  assert.deepEqual(promptParts(text, 'C:\\repo', known), {
    parts: [
      plain('Compare '),
      { text: 'docs/PLAN.md', path: 'C:\\repo\\docs\\PLAN.md', line: null },
      plain(', '),
      { text: '@docs/a.md', path: 'C:\\repo\\docs\\a.md', line: null },
      plain(' and '),
      { text: 'README.md', path: 'C:\\repo\\README.md', line: null },
      plain(', not ../x.md or docs/none.md.'),
    ],
    ask: [],
  });
  assert.deepEqual(promptParts(text, 'C:\\repo', () => undefined), {
    parts: [plain(text)],
    ask: ['C:\\repo\\docs\\PLAN.md', 'C:\\repo\\docs\\a.md', 'C:\\repo\\README.md', 'C:\\repo\\docs\\none.md'],
  });
  assert.equal(promptParts('see docs/PLAN.md:12', 'C:\\repo', known).parts[1]?.line, 12);
  assert.deepEqual(promptParts(text, '', known).parts, [plain(text)]);
});
