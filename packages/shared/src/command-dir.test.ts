import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandDir, resolveDir } from './command-dir.ts';

const cwd = 'C:\\Users\\z\\code\\emerald';

test('commandDir: a plain command runs in the cwd', () => {
  assert.equal(commandDir('git commit -m x', cwd), cwd);
  assert.equal(commandDir('npm test && git commit -m x', cwd), cwd);
});

test('commandDir: a leading cd names the folder, relative to the cwd', () => {
  assert.equal(commandDir('cd ../emerald-wt/m61 && git commit -m x', cwd), 'C:\\Users\\z\\code\\emerald-wt\\m61');
  assert.equal(commandDir('  cd packages/app; git commit -m x', cwd), 'C:\\Users\\z\\code\\emerald\\packages\\app');
  assert.equal(commandDir('cd "C:/tmp/a b" && git merge x', cwd), 'C:/tmp/a b');
  assert.equal(commandDir("cd '/c/Users/z/wt' && git commit", cwd), 'C:\\Users\\z\\wt', 'a Git Bash spelling comes back in Windows form (M9 fix 107)');
});

test('commandDir: a Git Bash or WSL drive path on a Windows cwd is that drive, and ~ is the home when given (M9 fix 107)', () => {
  assert.equal(commandDir('cd /c/Users/RUNNER~1/AppData/Local/Temp/emerald-ct1-repo-agent && git add agent.txt && git commit -q -m G1', cwd), 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\emerald-ct1-repo-agent');
  assert.equal(commandDir('cd /mnt/d/wt/x; git commit', cwd), 'D:\\wt\\x');
  assert.equal(commandDir('cd /c && git status', cwd), 'C:\\');
  assert.equal(commandDir('cd /tmp/x && git commit', cwd), '/tmp/x', 'a bare posix folder is left alone');
  assert.equal(commandDir('cd /c/Users/z/wt && git commit', '/home/z/code'), '/c/Users/z/wt', 'and so is every target on a posix cwd');
  assert.equal(commandDir('cd ~/code/wt && git commit', cwd, 'C:\\Users\\z'), 'C:\\Users\\z\\code\\wt');
  assert.equal(commandDir('cd ~ && git commit', cwd, 'C:\\Users\\z'), 'C:\\Users\\z');
  assert.equal(commandDir('cd ~/x && git commit', cwd), cwd, 'without a home the tilde is unknowable and the cwd stands');
  assert.equal(commandDir('git -C /c/Users/z/wt commit', cwd), 'C:\\Users\\z\\wt');
});


test('commandDir: a cd that is not the first command is not read', () => {
  assert.equal(commandDir('git commit -m x && cd ../other', cwd), cwd);
});

test('commandDir: git -C names the folder', () => {
  assert.equal(commandDir('git -C ../emerald-wt/m58 commit -m x', cwd), 'C:\\Users\\z\\code\\emerald-wt\\m58');
  assert.equal(commandDir('git --no-optional-locks -C D:\\wt log', cwd), 'D:\\wt');
});

test('resolveDir: keeps the separator of the cwd and folds dots', () => {
  assert.equal(resolveDir('/home/z/code/emerald', '../wt/./x'), '/home/z/code/wt/x');
  assert.equal(resolveDir('/home/z', '/abs'), '/abs');
  assert.equal(resolveDir('C:\\a\\b', '..\\..\\c'), 'C:\\c');
});

test("commandDir: PowerShell's folder changes name the folder too (M9 fix 106)", () => {
  assert.equal(commandDir('Set-Location ../emerald-wt/m61; git commit -m x', cwd), 'C:\\Users\\z\\code\\emerald-wt\\m61');
  assert.equal(commandDir("Set-Location -Path 'C:\\tmp\\a b'; git merge x", cwd), 'C:\\tmp\\a b');
  assert.equal(commandDir('Push-Location -LiteralPath packages\\app; git commit -m x', cwd), 'C:\\Users\\z\\code\\emerald\\packages\\app');
  assert.equal(commandDir('cd ..\\other; git commit -m x', cwd), 'C:\\Users\\z\\code\\other');
  assert.equal(commandDir('set-location D:\\wt && git commit', cwd), 'D:\\wt');
  assert.equal(commandDir('Set-Location; git status', cwd), cwd);
});
