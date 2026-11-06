// M9 fix 501 (the ledger's M11): npm's claude.cmd is resolved to node on its
// script rather than run under cmd.exe; a shim that cannot be read runs as
// the shim with a note. Top level so tests.ps1's dist\*.test.js lists it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeLauncher, SHIM_NOTE, findClaude, resolveClaudeModDir } from './launchers/claude.ts';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-501-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));

// npm's current shim, the shape of %APPDATA%\npm\sass.cmd.
const NPM_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  '',
].join('\r\n');

const SCRIPT_REL = path.join('node_modules', '@anthropic-ai', 'claude-code', 'cli.js');

let n = 0;
function folder(): string {
  const dir = path.join(root, String(++n));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function shimFolder(opts: { script: boolean; node: boolean; text?: string }): string {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'claude.cmd'), opts.text ?? NPM_SHIM);
  if (opts.script) {
    fs.mkdirSync(path.dirname(path.join(dir, SCRIPT_REL)), { recursive: true });
    fs.writeFileSync(path.join(dir, SCRIPT_REL), '');
  }
  if (opts.node) fs.writeFileSync(path.join(dir, 'node.exe'), '');
  return dir;
}

// A home with no .local\bin, so this box's real claude.exe stays hidden.
const emptyHome = folder();

// npm's shim names its script with backslashes, which resolve to a file
// on Windows alone; a test that resolves one runs there (M9 fix 1019).
const windowsOnly = { skip: process.platform !== 'win32' };

function launcher(dirs: string[], home = emptyHome): ClaudeLauncher {
  return new ClaudeLauncher({ env: { PATH: dirs.join(path.delimiter), PATHEXT: '.EXE;.CMD;.BAT' }, home, platform: 'win32' });
}

test('a shim with node.exe beside it runs that node on the script', windowsOnly, () => {
  const dir = shimFolder({ script: true, node: true });
  const cmd = launcher([dir]).command(['--resume', 'a&b']);
  assert.deepEqual(cmd, { file: path.join(dir, 'node.exe'), args: [path.join(dir, SCRIPT_REL), '--resume', 'a&b'] });
});

test("claude is found on the session's own environment when the launch hands one in (M9 fix 996)", () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'claude.exe'), '');
  const cmd = launcher([]).command([], null, { PATH: dir, PATHEXT: '.EXE' });
  assert.equal(cmd.file, path.join(dir, 'claude.exe'));
});

test('with no node.exe beside the shim, the node on PATH runs the script', windowsOnly, () => {
  const dir = shimFolder({ script: true, node: false });
  const nodeDir = folder();
  fs.writeFileSync(path.join(nodeDir, 'node.exe'), '');
  const cmd = launcher([dir, nodeDir]).command([]);
  assert.equal(cmd.file, path.join(nodeDir, 'node.exe'));
  assert.deepEqual(cmd.args, [path.join(dir, SCRIPT_REL)]);
  assert.equal(cmd.note, undefined);
});

test('a shim whose script is missing runs as the shim, with the note', () => {
  const dir = shimFolder({ script: false, node: true });
  const cmd = launcher([dir]).command(['x']);
  assert.deepEqual(cmd, { file: path.join(dir, 'claude.cmd'), args: ['x'], note: SHIM_NOTE });
  assert.equal(SHIM_NOTE, 'claude.cmd could not be resolved; running the shim');
});

test("a one-line shim of verify:cli's shape runs as the shim, with the note", () => {
  const text = `@"C:\\Program Files\\nodejs\\node.exe" "C:\\x\\fake-claude.mjs" %*\r\n`;
  const dir = shimFolder({ script: false, node: false, text });
  const cmd = launcher([dir]).command([]);
  assert.deepEqual(cmd, { file: path.join(dir, 'claude.cmd'), args: [], note: SHIM_NOTE });
});

test("a claude.exe under the home's .local\\bin wins over the shim", () => {
  const dir = shimFolder({ script: true, node: true });
  const home = folder();
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'claude.exe'), '');
  const cmd = launcher([dir], home).command(['a']);
  assert.deepEqual(cmd, { file: path.join(home, '.local', 'bin', 'claude.exe'), args: ['a'] });
});

test('with the mod, --plugin-dir comes before the session arguments on the native and the resolved shim paths (M9 fix 725)', windowsOnly, () => {
  const home = folder();
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'claude.exe'), '');
  const native = new ClaudeLauncher({ env: { PATH: '' }, home, modDir: 'C:\\m', platform: 'win32' }).command(['--resume', 'x']);
  assert.deepEqual(native.args, ['--plugin-dir', 'C:\\m', '--resume', 'x']);
  const dir = shimFolder({ script: true, node: true });
  const shim = new ClaudeLauncher({ env: { PATH: dir, PATHEXT: '.EXE;.CMD;.BAT' }, home: emptyHome, modDir: 'C:\\m', platform: 'win32' }).command(['--resume', 'x']);
  assert.deepEqual(shim.args, [path.join(dir, SCRIPT_REL), '--plugin-dir', 'C:\\m', '--resume', 'x']);
  // M9 fix 741: the mod's channel command rides the launch's own env.
  const channel = { EMERALD_MOD_CHANNEL: JSON.stringify([process.execPath, path.resolve('C:\\m', '..', 'dist', 'main.js'), 'mod-channel']) };
  assert.deepEqual(native.env, channel);
  assert.deepEqual(shim.env, channel);
});

// M9 fix 1019: off Windows claude is the native installer's ~/.local/bin
// link or a bare claude on the PATH, run as it is.
function exeIn(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '');
  fs.chmodSync(file, 0o755);
  return file;
}

function unixLauncher(dirs: string[], home = emptyHome): ClaudeLauncher {
  return new ClaudeLauncher({ env: { PATH: dirs.join(path.delimiter) }, home, platform: 'linux' });
}

test('off Windows a claude on the PATH runs as it is (M9 fix 1019)', () => {
  const dir = folder();
  const claude = exeIn(dir, 'claude');
  assert.deepEqual(unixLauncher([dir]).command(['--resume', 'x']), { file: claude, args: ['--resume', 'x'] });
});

test("off Windows a claude under the home's .local/bin wins over the PATH's (M9 fix 1019)", () => {
  const dir = folder();
  exeIn(dir, 'claude');
  const home = folder();
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  const local = exeIn(path.join(home, '.local', 'bin'), 'claude');
  assert.equal(unixLauncher([dir], home).command([]).file, local);
});

test('off Windows a claude.cmd alone is not found, and the throw names claude (M9 fix 1019)', () => {
  const dir = shimFolder({ script: true, node: true });
  assert.throws(() => unixLauncher([dir]).command([]), { message: 'claude not found in ~/.local/bin or on PATH' });
});

test("resolveClaudeModDir answers off under EMERALD_CLAUDE_MOD=0 and the repo's cli/mod otherwise (M9 fix 725)", () => {
  assert.deepEqual(resolveClaudeModDir({ EMERALD_CLAUDE_MOD: '0' }), { dir: null, line: 'claude mod: off (EMERALD_CLAUDE_MOD=0)' });
  const on = resolveClaudeModDir({});
  const repoMod = path.resolve(import.meta.dirname, '..', '..', 'cli', 'mod');
  assert.equal(on.dir, repoMod);
  assert.equal(on.line, `claude mod: ${repoMod}`);
});

test("findClaude takes .local\\bin's claude.exe over the PATH's, then the PATH's claude.exe, and answers null with none (M9 fix 1084)", () => {
  const onPath = folder();
  fs.writeFileSync(path.join(onPath, 'claude.exe'), '');
  const env = { PATH: onPath, PATHEXT: '.EXE;.CMD' };
  const home = folder();
  assert.equal(findClaude(env, home, 'win32'), path.join(onPath, 'claude.exe'));
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'bin', 'claude.exe'), '');
  assert.equal(findClaude(env, home, 'win32'), path.join(home, '.local', 'bin', 'claude.exe'));
  assert.equal(findClaude({ PATH: folder(), PATHEXT: '.EXE' }, emptyHome, 'win32'), null);
});
