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
function fixture(): { claudeDir: string; folder: string; root: string } {
  const root = mkTemp('emerald-skills-');
  const claudeDir = path.join(root, 'claude');
  const folder = path.join(root, 'work');
  write(path.join(claudeDir, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: "The user\'s alpha"\n---\nbody\n');
  write(path.join(claudeDir, 'skills', 'beta', 'SKILL.md'), '---\r\ndescription: >\r\n  Folded over\r\n  two lines\r\n---\r\nbody\r\n');
  write(path.join(claudeDir, 'skills', 'notes.txt'), 'not a skill');
  fs.mkdirSync(path.join(claudeDir, 'skills', 'empty'), { recursive: true });
  write(path.join(folder, '.claude', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: The project\'s alpha\n---\n');
  write(path.join(folder, '.claude', 'skills', 'gamma', 'SKILL.md'), '# gamma\n\nNo frontmatter here.\n');
  return { claudeDir, folder, root };
}

test('readSkills: the project first, a user skill of the same name skipped, each scope in name order', async () => {
  const { claudeDir, folder, root } = fixture();
  assert.deepEqual(await readSkills(claudeDir, folder, root), [
    { name: 'alpha', description: "The project's alpha", scope: 'project' },
    { name: 'gamma', description: '', scope: 'project' },
    { name: 'beta', description: 'Folded over two lines', scope: 'user' },
  ]);
});

test('readSkills: no folder gives the user skills alone; a missing home gives none', async () => {
  const { claudeDir, folder, root } = fixture();
  assert.deepEqual(await readSkills(claudeDir, null, root), [
    { name: 'alpha', description: "The user's alpha", scope: 'user' },
    { name: 'beta', description: 'Folded over two lines', scope: 'user' },
  ]);
  assert.deepEqual(await readSkills(path.join(folder, 'no-such-home'), null, root), []);
});

test('frontmatter: quotes stripped once, a literal block joined, an unclosed block is none', () => {
  const fm = frontmatter("---\nname: 'x'\ndescription: |-\n  one\n\n  two\nother: y\n---\n");
  assert.equal(fm.get('name'), 'x');
  assert.equal(fm.get('description'), 'one  two');
  assert.equal(fm.get('other'), 'y');
  assert.equal(frontmatter('---\nname: x\n').size, 0);
});

const skill = (file: string, name: string, desc = '') => write(file, `---\nname: ${name}\ndescription: ${desc}\n---\n`);

test('readSkills: the walk reads every level up to the repository root, nearest first', async () => {
  const root = mkTemp('emerald-skills-');
  fs.mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
  skill(path.join(root, 'repo', '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha', "The root's alpha");
  skill(path.join(root, 'repo', '.claude', 'skills', 'delta', 'SKILL.md'), 'delta');
  skill(path.join(root, 'repo', 'sub', '.claude', 'skills', 'alpha', 'SKILL.md'), 'alpha', "The sub's alpha");
  skill(path.join(root, '.claude', 'skills', 'outside', 'SKILL.md'), 'outside');
  fs.mkdirSync(path.join(root, 'repo', 'sub', 'deep'), { recursive: true });
  skill(path.join(root, 'claude', 'skills', 'beta', 'SKILL.md'), 'beta');
  assert.deepEqual(await readSkills(path.join(root, 'claude'), path.join(root, 'repo', 'sub', 'deep'), path.join(root, 'home')), [
    { name: 'alpha', description: "The sub's alpha", scope: 'project' },
    { name: 'delta', description: '', scope: 'project' },
    { name: 'beta', description: '', scope: 'user' },
  ]);
});

test('readSkills: with no repository the walk stops before the home folder', async () => {
  const root = mkTemp('emerald-skills-');
  skill(path.join(root, 'h', '.claude', 'skills', 'homeskill', 'SKILL.md'), 'homeskill');
  skill(path.join(root, 'h', 'a', '.claude', 'skills', 'mid', 'SKILL.md'), 'mid');
  fs.mkdirSync(path.join(root, 'h', 'a', 'b'), { recursive: true });
  fs.mkdirSync(path.join(root, 'claude'), { recursive: true });
  assert.deepEqual(await readSkills(path.join(root, 'claude'), path.join(root, 'h', 'a', 'b'), path.join(root, 'h')), [
    { name: 'mid', description: '', scope: 'project' },
  ]);
});

test("readSkills: a worktree reads the main checkout's skills after its own", async () => {
  const root = mkTemp('emerald-skills-');
  fs.mkdirSync(path.join(root, 'main', '.git', 'worktrees', 'wt1'), { recursive: true });
  fs.mkdirSync(path.join(root, 'main', '.git', 'worktrees', 'wt2'), { recursive: true });
  skill(path.join(root, 'main', '.claude', 'skills', 'batch', 'SKILL.md'), 'batch');
  skill(path.join(root, 'main', '.claude', 'skills', 'shared', 'SKILL.md'), 'shared', "main's");
  write(path.join(root, 'wt1', '.git'), 'gitdir: ' + path.join(root, 'main', '.git', 'worktrees', 'wt1').replace(/\\/g, '/') + '\n');
  skill(path.join(root, 'wt1', '.claude', 'skills', 'shared', 'SKILL.md'), 'shared', "the worktree's");
  write(path.join(root, 'wt2', '.git'), 'gitdir: ../main/.git/worktrees/wt2\n');
  fs.mkdirSync(path.join(root, 'claude'), { recursive: true });
  const home = path.join(root, 'home');
  assert.deepEqual(await readSkills(path.join(root, 'claude'), path.join(root, 'wt1'), home), [
    { name: 'batch', description: '', scope: 'project' },
    { name: 'shared', description: "the worktree's", scope: 'project' },
  ]);
  const second = await readSkills(path.join(root, 'claude'), path.join(root, 'wt2'), home);
  assert.ok(second.some((s) => s.name === 'batch'));
});

test("readSkills: an enabled plugin's skills are named <plugin>:<skill>; a disabled one's are not read", async () => {
  const root = mkTemp('emerald-skills-');
  const claudeDir = path.join(root, 'claude');
  const onDir = path.join(root, 'plugin-cache', 'on');
  const offDir = path.join(root, 'plugin-cache', 'off');
  write(path.join(claudeDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'on-plugin@market': [{ scope: 'user', installPath: onDir, version: '1.0.0' }], 'off-plugin@market': [{ scope: 'user', installPath: offDir, version: '1.0.0' }] } }));
  write(path.join(claudeDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'on-plugin@market': true, 'off-plugin@market': false } }));
  for (const d of [onDir, offDir]) write(path.join(d, 'skills', 'brainstorm', 'SKILL.md'), "---\nname: brainstorm\ndescription: The plugin's brainstorm\n---\n");
  assert.deepEqual(await readSkills(claudeDir, null, root), [
    { name: 'on-plugin:brainstorm', description: "The plugin's brainstorm", scope: 'plugin' },
  ]);
});
