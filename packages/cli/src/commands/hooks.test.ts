import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyHomeFlag, hookOptions } from './hooks.ts';

// M9 fix 544: the settings file follows CLAUDE_CONFIG_DIR, which Claude
// Code honours, below --settings and CLAUDE_SETTINGS. Each case sets both
// variables as it needs them and puts them back.
function withEnv(settings: string | undefined, config: string | undefined, body: () => void): void {
  const saved = [process.env['CLAUDE_SETTINGS'], process.env['CLAUDE_CONFIG_DIR']];
  const put = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  put('CLAUDE_SETTINGS', settings);
  put('CLAUDE_CONFIG_DIR', config);
  try {
    body();
  } finally {
    put('CLAUDE_SETTINGS', saved[0]);
    put('CLAUDE_CONFIG_DIR', saved[1]);
  }
}

const flag = path.join(os.tmpdir(), 'flag', 'settings.json');
const named = path.join(os.tmpdir(), 'named', 'settings.json');
const config = path.join(os.tmpdir(), 'claude-config');

test('--settings wins over CLAUDE_SETTINGS and CLAUDE_CONFIG_DIR (M9 fix 544)', () => {
  withEnv(named, config, () => assert.equal(hookOptions(flag).settingsPath, flag));
});

test('CLAUDE_SETTINGS wins over CLAUDE_CONFIG_DIR (M9 fix 544)', () => {
  withEnv(named, config, () => assert.equal(hookOptions(undefined).settingsPath, named));
});

test('CLAUDE_CONFIG_DIR alone gives its settings.json (M9 fix 544)', () => {
  withEnv(undefined, config, () => assert.equal(hookOptions(undefined).settingsPath, path.join(config, 'settings.json')));
});

test('off Windows the hook is claude-hook.sh, on Windows claude-hook.cmd, shipped and installed alike (M9 fix 1021)', () => {
  const mac = hookOptions(undefined, 'darwin');
  assert.ok(mac.scriptDest.endsWith('claude-hook.sh'), mac.scriptDest);
  assert.ok(mac.scriptSource.endsWith('claude-hook.sh'), mac.scriptSource);
  const linux = hookOptions(undefined, 'linux');
  assert.ok(linux.scriptDest.endsWith('claude-hook.sh') && linux.scriptSource.endsWith('claude-hook.sh'));
  const win = hookOptions(undefined, 'win32');
  assert.ok(win.scriptDest.endsWith('claude-hook.cmd'), win.scriptDest);
  assert.ok(win.scriptSource.endsWith('claude-hook.cmd'), win.scriptSource);
});

test('neither variable gives ~/.claude/settings.json, and a CLAUDE_CONFIG_DIR of spaces the same (M9 fix 544)', () => {
  const home = path.join(os.homedir(), '.claude', 'settings.json');
  withEnv(undefined, undefined, () => assert.equal(hookOptions(undefined).settingsPath, home));
  withEnv(undefined, '   ', () => assert.equal(hookOptions(undefined).settingsPath, home));
});

test('--home puts the hook script under the named home (M9 fix 1084)', () => {
  const saved = process.env['EMERALD_HOME'];
  const home = path.join(os.tmpdir(), 'emerald-remote-1084');
  try {
    withEnv(undefined, undefined, () => {
      applyHomeFlag(home);
      assert.equal(hookOptions(undefined, 'win32').scriptDest, path.join(home, 'hooks', 'claude-hook.cmd'));
    });
    applyHomeFlag(undefined);
    assert.equal(process.env['EMERALD_HOME'], path.resolve(home), 'no flag leaves the home as it was');
  } finally {
    if (saved === undefined) delete process.env['EMERALD_HOME'];
    else process.env['EMERALD_HOME'] = saved;
  }
});
