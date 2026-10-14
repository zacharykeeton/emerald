import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { ShellOption } from '@emerald/shared';
import { CMD_MARKS, PROMPT_WRAPPER, ShellLauncher, cmdPrompt } from './launchers/shell.ts';
import { silentLogger } from './log.ts';
import { SessionManager } from './session-manager.ts';
import { findShells } from './shells.ts';

test.after(removeTemps);

async function until(what: string, ms: number, pred: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('cmd gets the marks in front of the prompt it inherited, once (fix 624)', () => {
  assert.equal(cmdPrompt(undefined), CMD_MARKS + '$P$G');
  assert.equal(cmdPrompt(''), CMD_MARKS + '$P$G');
  assert.equal(cmdPrompt('$N$G'), CMD_MARKS + '$N$G');
  assert.equal(cmdPrompt(CMD_MARKS + '$N$G'), CMD_MARKS + '$N$G', 'a daemon started from a cmd row does not write them twice');
});

test('the launcher runs Git Bash with the rc, cmd with the PROMPT, and keeps the PowerShell wrapper for PowerShell alone (fix 624)', () => {
  const launcher = new ShellLauncher({ bashrcPath: 'C:\\h\\emerald.bashrc' });
  const gitbash: ShellOption = { id: 'gitbash', label: 'Git Bash', file: 'C:\\Git\\bin\\bash.exe' };
  const cmd: ShellOption = { id: 'cmd', label: 'Command Prompt', file: 'C:\\Windows\\System32\\cmd.exe' };
  const pwsh: ShellOption = { id: 'pwsh', label: 'PowerShell', file: 'C:\\pwsh\\pwsh.exe' };
  assert.deepEqual(launcher.command([], gitbash), { file: gitbash.file, args: ['--rcfile', 'C:\\h\\emerald.bashrc', '-i'], env: { CHERE_INVOKING: '1' } });
  assert.deepEqual(launcher.command(['-c', 'exit 4'], gitbash), { file: gitbash.file, args: ['-c', 'exit 4'] });
  const c = launcher.command([], cmd);
  assert.equal(c.file, cmd.file);
  assert.ok(c.env?.['PROMPT']?.startsWith(CMD_MARKS));
  const p = launcher.command([], pwsh);
  assert.equal(p.file, pwsh.file);
  assert.equal(p.args.at(-1), PROMPT_WRAPPER);
  for (const other of [launcher.command([], gitbash), c]) assert.ok(!other.args.includes(PROMPT_WRAPPER), "fix 505's Enter handler stays PowerShell's");
});

test('a real cmd shell reports its folder and moves with cd .., with no command ever running (fix 624)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, bashrcPath: path.join(mkTemp('emerald-bashrc-'), 'emerald.bashrc') });
  try {
    const dir = fs.realpathSync.native(mkTemp('emerald-cmd-'));
    const s = manager.spawn({ kind: 'shell', shell: 'cmd', cwd: dir, cols: 80, rows: 24 });
    const info = () => manager.get(s.id).info;
    await until('the cmd prompt to report its folder', 10_000, () => info().shellCwd?.toLowerCase() === dir.toLowerCase());
    manager.get(s.id).pty!.write('cd ..\r');
    await until('the folder to move up', 10_000, () => info().shellCwd?.toLowerCase() === path.dirname(dir).toLowerCase());
    assert.equal(info().command, null, 'cmd writes no C, so no command reads running');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test(
  'a real Git Bash shell reports its folder, a failing and a passing command, and writes its rc (fix 624)',
  { skip: findShells().some((s) => s.id === 'gitbash') ? false : 'Git Bash is not installed on this box' },
  async () => {
    const bashrcPath = path.join(mkTemp('emerald-bashrc-'), 'emerald.bashrc');
    const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, bashrcPath });
    try {
      const dir = fs.realpathSync.native(mkTemp('emerald-gitbash-'));
      const s = manager.spawn({ kind: 'shell', shell: 'gitbash', cwd: dir, cols: 80, rows: 24 });
      const info = () => manager.get(s.id).info;
      await until('the Git Bash prompt to report its folder', 15_000, () => info().shellCwd?.toLowerCase() === dir.toLowerCase());
      manager.get(s.id).pty!.write('false\r');
      await until('false to fail with 1', 10_000, () => info().command?.state === 'failed' && info().command?.exitCode === 1);
      manager.get(s.id).pty!.write('true\r');
      await until('true to pass with 0', 10_000, () => info().command?.state === 'ok' && info().command?.exitCode === 0);
      assert.ok(fs.existsSync(bashrcPath), 'the rc was written before the launch');
    } finally {
      manager.killAll();
      manager.close();
    }
  },
);

// An empty file where an exe would be: findShells only asks whether it is
// a file.
function fakeExe(dir: string, ...parts: string[]): string {
  const file = path.join(dir, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
}

function envOf(dir: string, pathDirs: string[]): NodeJS.ProcessEnv {
  return {
    PATH: pathDirs.join(path.delimiter),
    PATHEXT: '.EXE',
    ProgramFiles: path.join(dir, 'pf'),
    LOCALAPPDATA: path.join(dir, 'lad'),
    ComSpec: path.join(dir, 'nowhere', 'cmd.exe'),
  };
}

test('with pwsh.exe on the PATH the list starts pwsh, powershell, and the default is pwsh (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const pwsh = fakeExe(dir, 'pwsh7', 'pwsh.exe');
  const shells = findShells(envOf(dir, [path.dirname(pwsh)]));
  assert.deepEqual(shells.slice(0, 2).map((o) => o.id), ['pwsh', 'powershell']);
  assert.equal(shells[0]!.file, pwsh);
  assert.equal(shells[0]!.label, 'PowerShell');
});

test('without pwsh the list starts with Windows PowerShell, the bare name when it is not on the PATH (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const shells = findShells(envOf(dir, []));
  assert.equal(shells[0]!.id, 'powershell');
  assert.equal(shells[0]!.file, 'powershell.exe');
  assert.equal(shells[0]!.label, 'Windows PowerShell');
  const ps = fakeExe(dir, 'win', 'powershell.exe');
  assert.equal(findShells(envOf(dir, [path.dirname(ps)]))[0]!.file, ps);
});

test('a bash.exe alone on the PATH is not Git Bash: it is WSL\'s on a box with WSL (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const bash = fakeExe(dir, 'System32', 'bash.exe');
  const shells = findShells(envOf(dir, [path.dirname(bash)]));
  assert.equal(shells.some((o) => o.id === 'gitbash'), false);
});

test('Git Bash under ProgramFiles, under the per-user install, and beside git.exe on the PATH (fix 624)', () => {
  const pfDir = mkTemp('emerald-shells-');
  const pfBash = fakeExe(pfDir, 'pf', 'Git', 'bin', 'bash.exe');
  const fromPf = findShells(envOf(pfDir, [])).find((o) => o.id === 'gitbash');
  assert.deepEqual(fromPf, { id: 'gitbash', label: 'Git Bash', file: pfBash });

  const ladDir = mkTemp('emerald-shells-');
  const ladBash = fakeExe(ladDir, 'lad', 'Programs', 'Git', 'bin', 'bash.exe');
  assert.equal(findShells(envOf(ladDir, [])).find((o) => o.id === 'gitbash')?.file, ladBash);

  const gitDir = mkTemp('emerald-shells-');
  const git = fakeExe(gitDir, 'x', 'Git', 'cmd', 'git.exe');
  const besideBash = fakeExe(gitDir, 'x', 'Git', 'bin', 'bash.exe');
  assert.equal(findShells(envOf(gitDir, [path.dirname(git)])).find((o) => o.id === 'gitbash')?.file, besideBash);
});

test('cmd is always there and last, ComSpec when it is a file (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const bare = findShells(envOf(dir, []));
  assert.deepEqual(bare.at(-1), { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' });
  const comSpec = fakeExe(dir, 'sys', 'cmd.exe');
  const pwsh = fakeExe(dir, 'pwsh7', 'pwsh.exe');
  fakeExe(dir, 'pf', 'Git', 'bin', 'bash.exe');
  const full = findShells({ ...envOf(dir, [path.dirname(pwsh)]), ComSpec: comSpec });
  assert.deepEqual(full.map((o) => o.id), ['pwsh', 'powershell', 'gitbash', 'cmd']);
  assert.equal(full.at(-1)!.file, comSpec);
});
