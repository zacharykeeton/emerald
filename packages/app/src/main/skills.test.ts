import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { frontmatter, readSkills } from './skills.ts';

test.after(removeTemps);

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// A user home with alpha, a nameless beta with a folded description, a
// stray file and an empty folder; a project with its own alpha and a
// gamma with no frontmatter.
function fixture(): { claudeDir: string; folder: string } {
  const root = mkTemp('emerald-skills-');
  const claudeDir = path.join(root, 'claude');
  const folder = path.join(root, 'work');
  write(path.join(claudeDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: "The user\'s alpha"\n---\nbody\n');
  write(path.join(claudeDir, 'skills', 'beta', 'SKILL.md'), '---\r\ndescription: >\r\n  Folded over\r\n  two lines\r\n---\r\nbody\r\n');
  write(path.join(claudeDir, 'skills', 'notes.txt'), 'not a skill');
  fs.mkdirSync(path.join(claudeDir, 'skills', 'empty'), { recursive: true });
  write(path.join(folder, '.claude', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: The project\'s alpha\n---\n');
  write(path.join(folder, '.claude', 'skills', 'gamma', 'SKILL.md'), '# gamma\n\nNo frontmatter here.\n');
  return { claudeDir, folder };
}

test('readSkills: the project first, a user skill of the same name skipped, each scope in name order', async () => {
  const { claudeDir, folder } = fixture();
  assert.deepEqual(await readSkills(claudeDir, folder), [
    { name: 'alpha', description: "The project's alpha", scope: 'project' },
    { name: 'gamma', description: '', scope: 'project' },
    { name: 'beta', description: 'Folded over two lines', scope: 'user' },
  ]);
});

test('readSkills: no folder gives the user skills alone; a missing home gives none', async () => {
  const { claudeDir, folder } = fixture();
  assert.deepEqual(await readSkills(claudeDir, null), [
    { name: 'alpha', description: "The user's alpha", scope: 'user' },
    { name: 'beta', description: 'Folded over two lines', scope: 'user' },
  ]);
  assert.deepEqual(await readSkills(path.join(folder, 'no-such-home'), null), []);
});

test('frontmatter: quotes stripped once, a literal block joined, an unclosed block is none', () => {
  const fm = frontmatter("---\nname: 'x'\ndescription: |-\n  one\n\n  two\nother: y\n---\n");
  assert.equal(fm.get('name'), 'x');
  assert.equal(fm.get('description'), 'one  two');
  assert.equal(fm.get('other'), 'y');
  assert.equal(frontmatter('---\nname: x\n').size, 0);
});
