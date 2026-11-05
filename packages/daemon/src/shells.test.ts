import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { ShellOption } from '@emerald/shared';
import { BASH_RC, CMD_MARKS, PROMPT_WRAPPER, ShellLauncher, ZSH_FILES, bashRc, cmdPrompt, isEmeraldMod, pluginDirs, zshDirFor } from './launchers/shell.ts';
import { silentLogger } from './log.ts';
import { SessionManager } from './session-manager.ts';
import { findShells, loginShell } from './shells.ts';

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

test("the default shell's pwsh is found on the session's own environment when the launch hands one in (M9 fix 996)", () => {
  const dir = mkTemp('emerald-996-');
  fs.writeFileSync(path.join(dir, 'pwsh.exe'), '');
  const launcher = new ShellLauncher({ bashrcPath: 'C:\\h\\emerald.bashrc', env: {}, platform: 'win32' });
  assert.equal(launcher.command([], null, { Path: dir }).file, path.join(dir, 'pwsh.exe'));
});

test("pluginDirs puts the mod first, keeps another tool's folders and drops an inherited emerald mod (M9 fix 833)", () => {
  const isMod = (dir: string) => dir.toLowerCase() === 'c:\\installed\\cli\\mod';
  assert.equal(pluginDirs('C:\\e\\cli\\mod', undefined, isMod, 'win32'), 'C:\\e\\cli\\mod');
  assert.equal(pluginDirs('C:\\e\\cli\\mod', 'C:\\mine\\plug', isMod, 'win32'), 'C:\\e\\cli\\mod;C:\\mine\\plug');
  assert.equal(pluginDirs('C:\\e\\cli\\mod', 'c:\\E\\cli\\mod;;C:\\mine\\plug', isMod, 'win32'), 'C:\\e\\cli\\mod;C:\\mine\\plug', 'our own folder once, case-blind, empty entries dropped');
  assert.equal(pluginDirs('C:\\e\\cli\\mod', 'C:\\installed\\cli\\mod;C:\\mine\\plug', isMod, 'win32'), 'C:\\e\\cli\\mod;C:\\mine\\plug', 'an inherited emerald mod dropped');
  assert.equal(pluginDirs(null, 'C:\\installed\\cli\\mod', isMod, 'win32'), '');
  const root = mkTemp('emerald-mod-');
  const mod = path.join(root, 'mod');
  const other = path.join(root, 'other');
  for (const [dir, name] of [[mod, 'emerald'], [other, 'other']] as const) {
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }));
  }
  assert.equal(isEmeraldMod(mod), true);
  assert.equal(isEmeraldMod(other), false);
  assert.equal(isEmeraldMod(path.join(root, 'missing')), false);
});

test('every shell launch names the emerald mod in CLAUDE_CODE_PLUGIN_DIRS beside its own variables (M9 fix 833)', () => {
  const launcher = new ShellLauncher({ bashrcPath: 'C:\\h\\emerald.bashrc', modDir: 'C:\\e\\cli\\mod', env: {}, platform: 'win32' });
  const gitbash: ShellOption = { id: 'gitbash', label: 'Git Bash', file: 'C:\\Git\\bin\\bash.exe' };
  const cmd: ShellOption = { id: 'cmd', label: 'Command Prompt', file: 'C:\\Windows\\System32\\cmd.exe' };
  const pwsh: ShellOption = { id: 'pwsh', label: 'PowerShell', file: 'C:\\pwsh\\pwsh.exe' };
  const rc = launcher.command([], gitbash);
  const bashArgs = launcher.command(['-c', 'exit 4'], gitbash);
  const c = launcher.command([], cmd);
  const p = launcher.command([], pwsh);
  for (const [what, got] of [['git bash', rc], ['git bash with args', bashArgs], ['cmd', c], ['powershell', p]] as const) {
    assert.equal(got.env?.['CLAUDE_CODE_PLUGIN_DIRS'], 'C:\\e\\cli\\mod', what);
  }
  assert.equal(rc.env?.['CHERE_INVOKING'], '1');
  assert.ok(c.env?.['PROMPT']?.startsWith(CMD_MARKS));
});

test('a real cmd shell reports its folder and moves with cd .., with no command ever running (fix 624)', { skip: process.platform !== 'win32' }, async () => {
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
// a file, and off Windows whether it is executable, hence the mode.
function fakeExe(dir: string, ...parts: string[]): string {
  const file = path.join(dir, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  fs.chmodSync(file, 0o755);
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
  const shells = findShells(envOf(dir, [path.dirname(pwsh)]), 'win32');
  assert.deepEqual(shells.slice(0, 2).map((o) => o.id), ['pwsh', 'powershell']);
  assert.equal(shells[0]!.file, pwsh);
  assert.equal(shells[0]!.label, 'PowerShell');
});

test('without pwsh the list starts with Windows PowerShell, the bare name when it is not on the PATH (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const shells = findShells(envOf(dir, []), 'win32');
  assert.equal(shells[0]!.id, 'powershell');
  assert.equal(shells[0]!.file, 'powershell.exe');
  assert.equal(shells[0]!.label, 'Windows PowerShell');
  const ps = fakeExe(dir, 'win', 'powershell.exe');
  assert.equal(findShells(envOf(dir, [path.dirname(ps)]), 'win32')[0]!.file, ps);
});

test('a bash.exe alone on the PATH is not Git Bash: it is WSL\'s on a box with WSL (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const bash = fakeExe(dir, 'System32', 'bash.exe');
  const shells = findShells(envOf(dir, [path.dirname(bash)]), 'win32');
  assert.equal(shells.some((o) => o.id === 'gitbash'), false);
});

test('Git Bash under ProgramFiles, under the per-user install, and beside git.exe on the PATH (fix 624)', () => {
  const pfDir = mkTemp('emerald-shells-');
  const pfBash = fakeExe(pfDir, 'pf', 'Git', 'bin', 'bash.exe');
  const fromPf = findShells(envOf(pfDir, []), 'win32').find((o) => o.id === 'gitbash');
  assert.deepEqual(fromPf, { id: 'gitbash', label: 'Git Bash', file: pfBash });

  const ladDir = mkTemp('emerald-shells-');
  const ladBash = fakeExe(ladDir, 'lad', 'Programs', 'Git', 'bin', 'bash.exe');
  assert.equal(findShells(envOf(ladDir, []), 'win32').find((o) => o.id === 'gitbash')?.file, ladBash);

  const gitDir = mkTemp('emerald-shells-');
  const git = fakeExe(gitDir, 'x', 'Git', 'cmd', 'git.exe');
  const besideBash = fakeExe(gitDir, 'x', 'Git', 'bin', 'bash.exe');
  assert.equal(findShells(envOf(gitDir, [path.dirname(git)]), 'win32').find((o) => o.id === 'gitbash')?.file, besideBash);
});

test('cmd is always there and last, ComSpec when it is a file (fix 624)', () => {
  const dir = mkTemp('emerald-shells-');
  const bare = findShells(envOf(dir, []), 'win32');
  assert.deepEqual(bare.at(-1), { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' });
  const comSpec = fakeExe(dir, 'sys', 'cmd.exe');
  const pwsh = fakeExe(dir, 'pwsh7', 'pwsh.exe');
  fakeExe(dir, 'pf', 'Git', 'bin', 'bash.exe');
  const full = findShells({ ...envOf(dir, [path.dirname(pwsh)]), ComSpec: comSpec }, 'win32');
  assert.deepEqual(full.map((o) => o.id), ['pwsh', 'powershell', 'gitbash', 'cmd']);
  assert.equal(full.at(-1)!.file, comSpec);
});

test('a lower-case path and comspec are read all the same (M9 fix 999)', () => {
  const dir = mkTemp('emerald-shells-');
  const pwsh = fakeExe(dir, 'pwsh7', 'pwsh.exe');
  const comSpec = fakeExe(dir, 'sys', 'cmd.exe');
  const shells = findShells({ path: path.dirname(pwsh), comspec: comSpec }, 'win32');
  assert.equal(shells[0]!.id, 'pwsh');
  assert.equal(shells[0]!.file, pwsh);
  assert.deepEqual(shells.at(-1), { id: 'cmd', label: 'Command Prompt', file: comSpec });
});

test('off Windows the login shell comes first, then zsh, bash and sh off the PATH, and sh is always there (M9 fix 1018)', () => {
  const dir = mkTemp('emerald-unix-shells-');
  const zsh = fakeExe(dir, 'a', 'zsh');
  const bash = fakeExe(dir, 'b', 'bash');
  const sh = fakeExe(dir, 'c', 'sh');
  const fish = fakeExe(dir, 'd', 'fish');
  const PATH = [path.dirname(zsh), path.dirname(bash), path.dirname(sh)].join(path.delimiter);
  const noUser = () => null;
  const withBash = findShells({ PATH, SHELL: bash }, 'linux', noUser);
  assert.deepEqual(withBash.map((o) => o.id), ['bash', 'zsh', 'sh']);
  assert.equal(withBash[0]!.file, bash);
  assert.deepEqual(withBash[1], { id: 'zsh', label: 'zsh', file: zsh });
  assert.deepEqual(findShells({ PATH, SHELL: fish }, 'darwin', noUser).map((o) => o.id), ['zsh', 'bash', 'sh'], 'a fish login shell is not listed');
  assert.deepEqual(findShells({ PATH: '' }, 'linux', noUser), [{ id: 'sh', label: 'sh', file: '/bin/sh' }]);
});

test('the login shell is SHELL when absolute, else the passwd entry, else /bin/sh (M9 fix 1018)', () => {
  const abs = path.resolve('/opt/x/zsh');
  assert.equal(loginShell({ SHELL: abs }, () => '/bin/bash'), abs);
  assert.equal(loginShell({ SHELL: 'zsh' }, () => path.resolve('/bin/bash')), path.resolve('/bin/bash'));
  assert.equal(loginShell({}, () => 'bash'), '/bin/sh');
  assert.equal(loginShell({}, () => null), '/bin/sh');
});

test('zsh runs as a login shell with ZDOTDIR on our folder, bash with the rc, sh bare, each with its own args alone, and a mod reaches them all (M9 fixes 1018 and 1068)', () => {
  const launcher = new ShellLauncher({ bashrcPath: '/h/emerald.bashrc', env: {}, platform: 'linux' });
  const zsh: ShellOption = { id: 'zsh', label: 'zsh', file: '/bin/zsh' };
  const bash: ShellOption = { id: 'bash', label: 'bash', file: '/bin/bash' };
  const sh: ShellOption = { id: 'sh', label: 'sh', file: '/bin/sh' };
  const ours = path.join('/h', 'emerald-zsh');
  assert.deepEqual(launcher.command([], zsh), { file: '/bin/zsh', args: ['-l'], env: { ZDOTDIR: ours } });
  assert.deepEqual(launcher.command([], zsh, { ZDOTDIR: '/u/z' }), { file: '/bin/zsh', args: ['-l'], env: { ZDOTDIR: ours, EMERALD_USER_ZDOTDIR: '/u/z' } }, 'the user\'s folder is handed on');
  assert.deepEqual(launcher.command([], zsh, { ZDOTDIR: ours }), { file: '/bin/zsh', args: ['-l'], env: { ZDOTDIR: ours } }, 'our own folder is not the user\'s');
  assert.deepEqual(launcher.command(['-c', 'exit 4'], zsh, { ZDOTDIR: '/u/z' }), { file: '/bin/zsh', args: ['-c', 'exit 4'] }, 'args alone, no ZDOTDIR');
  assert.deepEqual(launcher.command([], bash), { file: '/bin/bash', args: ['--rcfile', '/h/emerald.bashrc', '-i'] });
  assert.deepEqual(launcher.command([], sh), { file: '/bin/sh', args: [] });
  assert.deepEqual(launcher.command(['-c', 'exit 4'], bash), { file: '/bin/bash', args: ['-c', 'exit 4'] });
  assert.deepEqual(launcher.command([], null), { file: '/bin/sh', args: [] }, 'the null fallback off Windows');
  const modded = new ShellLauncher({ bashrcPath: '/h/emerald.bashrc', modDir: '/e/cli/mod', env: {}, platform: 'darwin' });
  for (const s of [zsh, bash, sh]) assert.equal(modded.command([], s).env?.['CLAUDE_CODE_PLUGIN_DIRS'], '/e/cli/mod', s.id);
});

test('the bash rc off Windows differs from Git Bash\'s in its folder line alone (M9 fix 1068)', () => {
  assert.equal(bashRc('cygpath'), BASH_RC);
  const pwd = bashRc('pwd');
  assert.ok(!pwd.includes('cygpath'));
  const a = BASH_RC.split('\n');
  const b = pwd.split('\n');
  assert.equal(a.length, b.length);
  assert.equal(a.filter((line, i) => line !== b[i]).length, 1);
});

test('the zsh files source the user\'s own of each name and put the hooks in front (M9 fix 1068)', () => {
  for (const [name, text] of Object.entries(ZSH_FILES)) {
    assert.ok(text.includes(`$__emerald_user_zdotdir/${name}`), name);
    assert.ok(text.endsWith('\n'), `${name} ends with a newline`);
  }
  const rc = ZSH_FILES['.zshrc'];
  assert.ok(rc.includes('precmd_functions=(__emerald_precmd $precmd_functions)'));
  assert.ok(rc.includes('preexec_functions=(__emerald_preexec $preexec_functions)'));
  assert.ok(rc.includes('9;9'));
  const login = ZSH_FILES['.zlogin'].split('\n').filter((line) => line.trim() !== '');
  assert.equal(login[login.length - 1], 'ZDOTDIR=$__emerald_user_zdotdir');
  assert.equal(zshDirFor(path.join('/h', 'emerald.bashrc')), path.join('/h', 'emerald-zsh'));
});

for (const id of ['bash', 'zsh'] as const) {
  const skip = process.platform === 'win32' || !findShells().some((s) => s.id === id);
  test(`a real ${id} row reports its folder, a running command, its exit codes and a cd (M9 fix 1068)`, { skip }, async () => {
    const bashrcPath = path.join(mkTemp('emerald-bashrc-'), 'emerald.bashrc');
    const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, bashrcPath });
    try {
      const dir = fs.realpathSync(mkTemp(`emerald-${id}-`));
      const s = manager.spawn({ kind: 'shell', shell: id, cwd: dir, cols: 80, rows: 24 });
      const info = () => manager.get(s.id).info;
      const write = (line: string) => manager.get(s.id).pty!.write(`${line}\r`);
      await until(`${id} to report its folder`, 15_000, () => info().shellCwd === dir);
      write('sleep 2');
      await until('sleep to read running', 5_000, () => info().command?.state === 'running');
      await until('sleep to end ok', 10_000, () => info().command?.state === 'ok' && info().command?.exitCode === 0);
      write('false');
      await until('false to read failed with 1', 10_000, () => info().command?.state === 'failed' && info().command?.exitCode === 1);
      write('cd /tmp');
      await until('the folder to follow cd /tmp', 10_000, () => info().shellCwd === fs.realpathSync('/tmp'));
      if (id === 'zsh') {
        for (const name of Object.keys(ZSH_FILES)) assert.ok(fs.existsSync(path.join(zshDirFor(bashrcPath), name)), name);
      }
    } finally {
      manager.killAll();
      manager.close();
    }
  });
}

test('a resumed zsh row that hosted a conversation gets claude --resume typed at its first prompt (M9 fix 1068)', { skip: process.platform === 'win32' || !findShells().some((s) => s.id === 'zsh') }, async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, bashrcPath: path.join(mkTemp('emerald-bashrc-'), 'emerald.bashrc') });
  try {
    const dir = fs.realpathSync(mkTemp('emerald-zsh-resume-'));
    const s = manager.spawn({ kind: 'shell', shell: 'zsh', cwd: dir, cols: 120, rows: 30 });
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-typed', cwd: dir, source: 'startup' }, Date.now());
    manager.applyHook(s.id, { hook_event_name: 'SessionEnd', session_id: 'conv-typed', cwd: dir }, Date.now());
    const exited = new Promise<void>((resolve) => manager.once('exit', () => resolve()));
    manager.kill(s.id);
    await exited;
    manager.resume(s.id, 120, 30);
    assert.ok(manager.get(s.id).typeAtPrompt, 'the line waits for the prompt');
    await until('the line to be typed', 15_000, () => manager.get(s.id).typeAtPrompt === null);
    let rows: string[] = [];
    await until('the typed line on the screen', 5_000, () => {
      void manager.get(s.id).pty!.screen().then((f) => { rows = f.rows; });
      return rows.some((row) => row.includes('claude --resume conv-typed'));
    });
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("off Windows pluginDirs joins on ':', case-blind on darwin and exact on linux (M9 fix 1018)", () => {
  const none = () => false;
  assert.equal(pluginDirs('/m', '/a:/b', none, 'linux'), '/m:/a:/b');
  assert.equal(pluginDirs('/m', '/M:/a', none, 'linux'), '/m:/M:/a', 'linux keeps a folder differing by case');
  assert.equal(pluginDirs('/m', '/M:/a', none, 'darwin'), '/m:/a', 'darwin drops it');
  assert.equal(pluginDirs('/m', '/m::/a', none, 'linux'), '/m:/a');
});

test('a real sh and a real bash run a line in a session (M9 fix 1018)', { skip: process.platform === 'win32' }, async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, bashrcPath: path.join(mkTemp('emerald-bashrc-'), 'emerald.bashrc') });
  try {
    for (const shell of ['sh', 'bash'] as const) {
      const dir = mkTemp(`emerald-${shell}-`);
      const s = manager.spawn({ kind: 'shell', shell, cwd: dir, cols: 80, rows: 24 });
      manager.get(s.id).pty!.write('echo emerald-$((6*7))\r');
      await until(`${shell} to print emerald-42`, 10_000, () => manager.get(s.id).pty!.readSince(0).data.toString('utf8').includes('emerald-42'));
    }
  } finally {
    manager.killAll();
    manager.close();
  }
});
