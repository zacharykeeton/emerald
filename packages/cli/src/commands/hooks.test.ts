import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hookOptions } from './hooks.ts';

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

test('neither variable gives ~/.claude/settings.json, and a CLAUDE_CONFIG_DIR of spaces the same (M9 fix 544)', () => {
  const home = path.join(os.homedir(), '.claude', 'settings.json');
  withEnv(undefined, undefined, () => assert.equal(hookOptions(undefined).settingsPath, home));
  withEnv(undefined, '   ', () => assert.equal(hookOptions(undefined).settingsPath, home));
});
