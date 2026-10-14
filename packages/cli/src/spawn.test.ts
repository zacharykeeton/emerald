import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError } from './cli-error.ts';
import { parseShellId } from './spawn.ts';

test('--shell takes the four ids and refuses anything else as a usage error (M9 fix 624)', () => {
  assert.equal(parseShellId(undefined), undefined);
  for (const id of ['pwsh', 'powershell', 'gitbash', 'cmd']) assert.equal(parseShellId(id), id);
  for (const bad of ['zsh', 'bash']) {
    assert.throws(
      () => parseShellId(bad),
      (err: unknown) => err instanceof CliError && err.exitCode === 64 && err.message === `--shell must be one of pwsh, powershell, gitbash, cmd, got "${bad}"`,
      `${bad} is no id; bash is WSL's name, not Git Bash's`,
    );
  }
});
