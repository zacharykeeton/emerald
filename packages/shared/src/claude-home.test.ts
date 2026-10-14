import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { claudeConfigDir, claudeHome } from './claude-home.ts';

// Each case sets both variables as it needs them and puts them back.
function withEnv(own: string | undefined, config: string | undefined, body: () => void): void {
  const saved = [process.env['EMERALD_CLAUDE_HOME'], process.env['CLAUDE_CONFIG_DIR']];
  const put = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  put('EMERALD_CLAUDE_HOME', own);
  put('CLAUDE_CONFIG_DIR', config);
  try {
    body();
  } finally {
    put('EMERALD_CLAUDE_HOME', saved[0]);
    put('CLAUDE_CONFIG_DIR', saved[1]);
  }
}

const config = path.join(os.tmpdir(), 'claude-config');
const own = path.join(os.tmpdir(), 'emerald-claude-home');

test('neither variable set gives ~/.claude', () => {
  withEnv(undefined, undefined, () => assert.equal(claudeHome(), path.join(os.homedir(), '.claude')));
});

test('CLAUDE_CONFIG_DIR alone gives it', () => {
  withEnv(undefined, config, () => assert.equal(claudeHome(), config));
});

test('both set gives EMERALD_CLAUDE_HOME', () => {
  withEnv(own, config, () => assert.equal(claudeHome(), own));
});

test('an empty EMERALD_CLAUDE_HOME with CLAUDE_CONFIG_DIR set gives CLAUDE_CONFIG_DIR', () => {
  withEnv('  ', config, () => assert.equal(claudeHome(), config));
});

// M9 fix 544: where Claude Code keeps its settings, which the hooks
// install reads; a harness's EMERALD_CLAUDE_HOME never moves it.
test('claudeConfigDir: unset gives ~/.claude, set gives it, spaces give ~/.claude', () => {
  withEnv(undefined, undefined, () => assert.equal(claudeConfigDir(), path.join(os.homedir(), '.claude')));
  withEnv(undefined, config, () => assert.equal(claudeConfigDir(), config));
  withEnv(undefined, '   ', () => assert.equal(claudeConfigDir(), path.join(os.homedir(), '.claude')));
});

test('claudeConfigDir: EMERALD_CLAUDE_HOME set does not move it', () => {
  withEnv(own, undefined, () => assert.equal(claudeConfigDir(), path.join(os.homedir(), '.claude')));
  withEnv(own, config, () => assert.equal(claudeConfigDir(), config));
});
