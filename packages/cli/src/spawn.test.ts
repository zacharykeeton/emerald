import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellIdsFor } from '@emerald/shared';
import { CliError } from './cli-error.ts';
import { shellIdsOf, shellSummary, shellUsage } from './shell-words.ts';
import { parseHostShellId, parseShellId } from './spawn.ts';

test('--shell takes the four ids and refuses anything else as a usage error (M9 fix 624)', () => {
  assert.equal(parseShellId(undefined, 'win32'), undefined);
  for (const id of ['pwsh', 'powershell', 'gitbash', 'cmd']) assert.equal(parseShellId(id, 'win32'), id);
  for (const bad of ['zsh', 'bash']) {
    assert.throws(
      () => parseShellId(bad, 'win32'),
      (err: unknown) => err instanceof CliError && err.exitCode === 64 && err.message === `--shell must be one of pwsh, powershell, gitbash, cmd, got "${bad}"`,
      `${bad} is no id; bash is WSL's name, not Git Bash's`,
    );
  }
});

test("the CLI's shell ids are shared's per platform, and the Windows words are today's (M9 fix 1018)", () => {
  for (const p of ['win32', 'darwin', 'linux']) assert.deepEqual(shellIdsOf(p), shellIdsFor(p), p);
  assert.equal(shellSummary('win32'), 'start a plain shell session in a folder; --shell picks pwsh, powershell, gitbash or cmd');
  const hostLine = '\n--host <name> starts it on that remote host through the window, which must be open; <dir> is then an absolute path there or ~';
  assert.equal(shellUsage('win32'), `emmer shell <dir> [--host <name>] [--name <label>] [--shell pwsh|powershell|gitbash|cmd] [--json] [-- <shell args>]${hostLine}`);
  assert.equal(shellSummary('darwin'), 'start a plain shell session in a folder; --shell picks zsh, bash or sh');
  assert.equal(shellUsage('linux'), `emmer shell <dir> [--host <name>] [--name <label>] [--shell zsh|bash|sh] [--json] [-- <shell args>]${hostLine}`);
  assert.equal(parseShellId('zsh', 'darwin'), 'zsh');
  assert.throws(
    () => parseShellId('pwsh', 'linux'),
    (err: unknown) => err instanceof CliError && err.exitCode === 64 && err.message === '--shell must be one of zsh, bash, sh, got "pwsh"',
  );
});

test('--shell with --host takes any id of either platform (M9 fix 1167)', () => {
  assert.equal(parseHostShellId(undefined), undefined);
  assert.equal(parseHostShellId('zsh'), 'zsh');
  assert.equal(parseHostShellId('cmd'), 'cmd');
  assert.throws(
    () => parseHostShellId('frob'),
    (err: unknown) => err instanceof CliError && err.exitCode === 64 && err.message === '--shell must be one of pwsh, powershell, gitbash, cmd, zsh, bash, sh, got "frob"',
  );
});
