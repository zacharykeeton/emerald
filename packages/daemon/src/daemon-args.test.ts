import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyDaemonArgs } from './daemon-args.ts';

test('--home and --pipe set both variables, the home resolved (M9 fix 1079)', () => {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(applyDaemonArgs(['--home', 'rel-home', '--pipe', '\\\\.\\pipe\\x'], env), null);
  assert.equal(env['EMERALD_HOME'], path.resolve('rel-home'));
  assert.equal(env['EMERALD_PIPE'], '\\\\.\\pipe\\x');
});

test('an unknown flag and a bare --home give their lines (M9 fix 1079)', () => {
  assert.equal(applyDaemonArgs(['--nope'], {}), 'emmerd: unknown argument --nope');
  assert.equal(applyDaemonArgs(['--home'], {}), 'emmerd: --home needs a value');
  assert.equal(applyDaemonArgs(['--pipe'], {}), 'emmerd: --pipe needs a value');
});

test('--ssh-connection sets SSH_CONNECTION beside --home and --pipe, and a bare one gives its line (M9 fix 1091)', () => {
  const env: NodeJS.ProcessEnv = {};
  assert.equal(applyDaemonArgs(['--home', 'h', '--pipe', 'p', '--ssh-connection', '10.0.0.5 51234 10.0.0.9 22'], env), null);
  assert.equal(env['SSH_CONNECTION'], '10.0.0.5 51234 10.0.0.9 22');
  assert.equal(env['EMERALD_PIPE'], 'p');
  assert.equal(applyDaemonArgs(['--ssh-connection'], {}), 'emmerd: --ssh-connection needs a value');
});

test('no argument changes nothing (M9 fix 1079)', () => {
  const env: NodeJS.ProcessEnv = { EMERALD_HOME: 'kept' };
  assert.equal(applyDaemonArgs([], env), null);
  assert.deepEqual(env, { EMERALD_HOME: 'kept' });
});
