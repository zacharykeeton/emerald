import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexCodes, indexStatuses, letterAt, letterFor, parsePorcelain, parseStatus, statusAt } from './git-status-model.ts';

// git status --porcelain=v1 -z: NUL-terminated entries, a rename with its
// old path as one more field, an untracked or ignored folder as one entry
// with a trailing slash.
const z = (...entries: string[]) => entries.join('\0') + '\0';

test('parsePorcelain: the four statuses, an unstaged change over a staged one, a rename', () => {
  const out = z('?? new.txt', '!! node_modules/', ' M src/a.ts', 'M  src/b.ts', 'MM src/c.ts', 'A  src/d.ts', 'R  src/new.ts', 'src/old.ts', 'D  gone.ts');
  const s = parsePorcelain(out, 'C:/repo');
  assert.equal(s['C:\\repo\\new.txt'], 'untracked');
  assert.equal(s['C:\\repo\\node_modules'], 'ignored');
  assert.equal(s['C:\\repo\\src\\a.ts'], 'modified', 'a work tree change');
  assert.equal(s['C:\\repo\\src\\b.ts'], 'staged', 'an index change only');
  assert.equal(s['C:\\repo\\src\\c.ts'], 'modified', 'both: the unstaged one is still to be dealt with');
  assert.equal(s['C:\\repo\\src\\d.ts'], 'staged', 'an added file');
  assert.equal(s['C:\\repo\\src\\new.ts'], 'staged', 'the renamed-to path');
  assert.equal(s['C:\\repo\\src\\old.ts'], undefined, 'the renamed-from path is gone');
  assert.equal(s['C:\\repo\\gone.ts'], 'staged', 'a staged delete');
});

test('parsePorcelain rolls folders up to the strongest status beneath, stopping at the repo root', () => {
  const s = parsePorcelain(z('!! a/ignored.log', 'A  a/b/staged.ts', '?? a/b/c/new.ts', ' M a/b/c/d/changed.ts'), 'C:\\repo');
  assert.equal(s['C:\\repo\\a\\b\\c\\d'], 'modified');
  assert.equal(s['C:\\repo\\a\\b\\c'], 'modified', 'modified beats untracked');
  assert.equal(s['C:\\repo\\a\\b'], 'modified');
  assert.equal(s['C:\\repo\\a'], 'modified');
  assert.equal(s['C:\\repo'], undefined, 'the root is not a row');
  const t = parsePorcelain(z('!! a/ignored.log', 'A  a/b/staged.ts', '?? a/c/new.ts'), 'C:\\repo');
  assert.equal(t['C:\\repo\\a\\b'], 'staged');
  assert.equal(t['C:\\repo\\a\\c'], 'untracked');
  assert.equal(t['C:\\repo\\a'], 'untracked', 'untracked beats staged');
  assert.deepEqual(parsePorcelain('', 'C:\\repo'), {}, 'a clean tree');
  const u = parsePorcelain(z('!! a/node_modules/', '!! a/b/dist/'), 'C:\\repo');
  assert.equal(u['C:\\repo\\a\\node_modules'], 'ignored');
  assert.equal(u['C:\\repo\\a\\b\\dist'], 'ignored');
  assert.equal(u['C:\\repo\\a\\b'], undefined, 'ignored does not roll up');
  assert.equal(u['C:\\repo\\a'], undefined, 'a folder is dim only when git lists the folder');
});

test('statusAt: own status, else the untracked or ignored folder above when git itself listed it, else clean, without case', () => {
  const out = z('?? fresh/', '!! node_modules/', ' M src/a.ts');
  const index = indexStatuses(parsePorcelain(out, 'C:\\Repo'));
  const codes = indexCodes(parseStatus(out, 'C:\\Repo').files);
  assert.equal(statusAt(index, 'C:\\repo\\src\\a.ts', codes), 'modified');
  assert.equal(statusAt(index, 'C:\\repo\\SRC', codes), 'modified', 'the rolled-up folder, any case');
  assert.equal(statusAt(index, 'C:\\repo\\fresh\\deep\\file.ts', codes), 'untracked', 'inside a listed untracked folder');
  assert.equal(statusAt(index, 'C:\\repo\\node_modules\\x\\index.js', codes), 'ignored', 'inside a listed ignored folder');
  assert.equal(statusAt(index, 'C:\\repo\\src\\b.ts', codes), undefined, 'a clean file beside a changed one');
  assert.equal(statusAt(index, 'D:\\elsewhere\\x.ts', codes), undefined, 'outside the repo');
});

test('statusAt: a rolled-up folder tints itself but does not paint its own listed siblings (M9 fix 334)', () => {
  const out = z('?? src/new.ts');
  const index = indexStatuses(parsePorcelain(out, 'C:\\repo'));
  const codes = indexCodes(parseStatus(out, 'C:\\repo').files);
  assert.equal(statusAt(index, 'C:\\repo\\src', codes), 'untracked', 'the rolled-up ancestor still tints itself');
  assert.equal(statusAt(index, 'C:\\repo\\src\\new.ts', codes), 'untracked', 'the listed file');
  assert.equal(statusAt(index, 'C:\\repo\\src\\old.ts', codes), undefined, 'a clean tracked sibling does not inherit the rollup');
});

test('parseStatus lists the files with their codes, and letterFor picks the letter the column shows (M45)', () => {
  const { files } = parseStatus(z('?? new.txt', '!! node_modules/', ' M src/a.ts', 'M  src/b.ts', 'MM src/c.ts', 'A  src/d.ts', 'R  src/new.ts', 'src/old.ts', ' D gone.ts'), 'C:/repo');
  assert.deepEqual(
    files.map((f) => `${f.code}|${f.status}|${f.path}`),
    [
      '??|untracked|C:\\repo\\new.txt',
      '!!|ignored|C:\\repo\\node_modules',
      ' M|modified|C:\\repo\\src\\a.ts',
      'M |staged|C:\\repo\\src\\b.ts',
      'MM|modified|C:\\repo\\src\\c.ts',
      'A |staged|C:\\repo\\src\\d.ts',
      'R |staged|C:\\repo\\src\\new.ts',
      ' D|modified|C:\\repo\\gone.ts',
    ],
    'the files in git order, never a folder of the rollup',
  );
  assert.equal(letterFor('??'), null, 'untracked shows no letter');
  assert.equal(letterFor('!!'), null, 'ignored shows no letter');
  assert.equal(letterFor(' M'), 'M');
  assert.equal(letterFor('M '), 'M', 'a staged change is still an M');
  assert.equal(letterFor('MM'), 'M');
  assert.equal(letterFor('A '), 'A');
  assert.equal(letterFor('AM'), 'M', 'the work tree letter wins, it is the one still to deal with');
  assert.equal(letterFor(' D'), 'D');
  assert.equal(letterFor('R '), 'R');
  assert.equal(letterFor('  '), null);
  const codes = indexCodes(files);
  assert.equal(letterAt(codes, 'C:\\REPO\\src\\A.ts'), 'M', 'any case');
  assert.equal(letterAt(codes, 'C:\\repo\\src'), null, 'a folder has no letter');
  assert.equal(letterAt(codes, 'C:\\repo\\new.txt'), null);
});
