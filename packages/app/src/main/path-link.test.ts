import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { askPathLink, linkCommand, loginShellArgs, loginShellOf, readLook, runLoginShell } from './path-link.ts';
import type { ShellRun } from './path-link.ts';

// The PATH link on a Mac (M9 fix 1026): the line, the login shell asked,
// and when the window offers it.
test('linkCommand makes /usr/local/bin first and links the shim there', () => {
  assert.equal(
    linkCommand('/Applications/Emerald.app/Contents/Resources/bin/emmer'),
    'sudo mkdir -p /usr/local/bin && sudo ln -sf "/Applications/Emerald.app/Contents/Resources/bin/emmer" /usr/local/bin/emmer',
  );
});

test('loginShellArgs: interactive and login for zsh and bash, login alone otherwise', () => {
  assert.deepEqual(loginShellArgs('/bin/zsh', 'c'), ['-ilc', 'c']);
  assert.deepEqual(loginShellArgs('/usr/local/bin/bash', 'c'), ['-ilc', 'c']);
  assert.deepEqual(loginShellArgs('/bin/sh', 'c'), ['-lc', 'c']);
  assert.deepEqual(loginShellArgs('/opt/homebrew/bin/fish', 'c'), ['-lc', 'c']);
});

test('loginShellOf: SHELL, then the passwd entry, then zsh', () => {
  assert.equal(loginShellOf({ SHELL: '/bin/bash' }, '/bin/zsh'), '/bin/bash');
  assert.equal(loginShellOf({ SHELL: '' }, '/bin/sh'), '/bin/sh');
  assert.equal(loginShellOf({}, null), '/bin/zsh');
  assert.equal(loginShellOf({}, ''), '/bin/zsh');
});

test('readLook: exit 0 found, any other exit missing, a timeout or a spawn error unknown', () => {
  const r = (over: Partial<ShellRun>): ShellRun => ({ code: null, timedOut: false, error: null, ...over });
  assert.equal(readLook(r({ code: 0 })), 'found');
  assert.equal(readLook(r({ code: 1 })), 'missing');
  assert.equal(readLook(r({ code: 127 })), 'missing');
  assert.deepEqual(readLook(r({ timedOut: true })), { unknown: 'timed out after 3 s' });
  assert.deepEqual(readLook(r({ error: 'ENOENT' })), { unknown: 'ENOENT' });
});

function ask(platform: NodeJS.Platform, packaged: boolean, answer: ShellRun) {
  const calls: Array<{ shell: string; args: string[] }> = [];
  const log: string[] = [];
  const resourcesPath = path.join(path.sep, 'Applications', 'Emerald.app', 'Contents', 'Resources');
  const p = askPathLink({
    platform,
    packaged,
    resourcesPath,
    env: { SHELL: '/bin/zsh' },
    userShell: null,
    log: (m) => log.push(m),
    run: async (shell, args) => {
      calls.push({ shell, args });
      return answer;
    },
  });
  return { p, calls, log, resourcesPath };
}

test('askPathLink: nothing asked off a Mac or in a dev tree', async () => {
  for (const [platform, packaged] of [['win32', true], ['linux', true], ['darwin', false]] as const) {
    const a = ask(platform, packaged, { code: 1, timedOut: false, error: null });
    assert.equal(await a.p, null);
    assert.deepEqual(a.calls, []);
    assert.deepEqual(a.log, []);
  }
});

test('askPathLink on a packaged Mac: missing offers the line on the bundle shim, found and a timeout offer nothing', async () => {
  const missing = ask('darwin', true, { code: 1, timedOut: false, error: null });
  assert.equal(await missing.p, linkCommand(path.join(missing.resourcesPath, 'bin', 'emmer')));
  assert.deepEqual(missing.calls, [{ shell: '/bin/zsh', args: ['-ilc', 'command -v emmer'] }]);
  assert.deepEqual(missing.log, ["path link: emmer is not on the login shell's PATH; the window offers the link"]);
  const found = ask('darwin', true, { code: 0, timedOut: false, error: null });
  assert.equal(await found.p, null);
  assert.deepEqual(found.log, ["path link: emmer is on the login shell's PATH"]);
  const slow = ask('darwin', true, { code: null, timedOut: true, error: null });
  assert.equal(await slow.p, null);
  assert.deepEqual(slow.log, ['path link: could not ask the login shell /bin/zsh (timed out after 3 s); no note']);
});

test('runLoginShell on a real sh: a name on the PATH is found, a made-up one missing', { skip: process.platform === 'win32' }, async () => {
  assert.equal(readLook(await runLoginShell('/bin/sh', loginShellArgs('/bin/sh', 'command -v sh'), 3000)), 'found');
  assert.equal(readLook(await runLoginShell('/bin/sh', loginShellArgs('/bin/sh', 'command -v emmer-none-1026'), 3000)), 'missing');
  assert.deepEqual(readLook(await runLoginShell('/no/such/shell-1026', ['-lc', 'true'], 3000)), { unknown: 'ENOENT' });
});
