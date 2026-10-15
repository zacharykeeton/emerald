import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphFolder } from './graph-folder.ts';
import { aSession } from './test-support.ts';

// M9 fix 590, with fix 114's hold kept: the truth table of the rail's
// Commits graph folder for a session with and without a branch.

test('a Claude started in a repository that a hook moves to a non-repo folder keeps the repository', () => {
  assert.equal(graphFolder(aSession({ kind: 'shell', claudeSessionId: 'c1', spawnCwd: 'C:\\x', groupCwd: 'C:\\repo', cwd: 'C:\\logs', branch: null }), 'C:\\repo'), 'C:\\repo');
  assert.equal(graphFolder(aSession({ kind: 'claude', claudeSessionId: null, spawnCwd: 'C:\\x', groupCwd: 'C:\\repo', cwd: 'C:\\logs', branch: null }), undefined), 'C:\\x');
});

test('a shell started in a repository that cds to a non-repo folder and starts Claude there shows that folder, and the repository again once Claude leaves', () => {
  const s = aSession({ claudeSessionId: 'c1', spawnCwd: 'C:\\code\\zorca', cwd: 'C:\\code\\remotion_test', groupCwd: 'C:\\code\\remotion_test', branch: null });
  assert.equal(graphFolder(s, 'C:\\code\\zorca'), 'C:\\code\\remotion_test');
  assert.equal(graphFolder({ ...s, claudeSessionId: null }, 'C:\\code\\zorca'), 'C:\\code\\zorca');
});

test('a bare shell started in a non-repo folder, back home from a repository, shows its own folder, whatever the spawn spelling', () => {
  assert.equal(graphFolder(aSession({ spawnCwd: 'C:\\x', cwd: 'C:\\x', groupCwd: 'C:\\x', branch: null }), 'C:\\r'), 'C:\\x');
  assert.equal(graphFolder(aSession({ spawnCwd: 'c:/x/', cwd: 'C:\\x', groupCwd: 'C:\\x', branch: null }), 'C:\\r'), 'C:\\x');
});

test('a bare shell started in a repository that cds to a log folder keeps the repository', () => {
  const s = aSession({ spawnCwd: 'C:\\repo', cwd: 'C:\\logs', groupCwd: 'C:\\logs', branch: null });
  assert.equal(graphFolder(s, 'C:\\repo'), 'C:\\repo');
  assert.equal(graphFolder(s, undefined), 'C:\\repo');
});

test('a git init in the folder shows the live cwd once the branch reads', () => {
  assert.equal(graphFolder(aSession({ spawnCwd: 'C:\\code\\zorca', cwd: 'C:\\x', groupCwd: 'C:\\x', branch: 'main' }), 'C:\\code\\zorca'), 'C:\\x');
});

test('an 8.3 spelling reads as away as a pure function; the daemon stores the real spelling since fix 711', () => {
  assert.equal(graphFolder(aSession({ spawnCwd: 'C:\\Users\\RUNNER~1\\x', cwd: 'C:\\Users\\runneradmin\\x', groupCwd: 'C:\\Users\\runneradmin\\x', branch: null }), 'C:\\r'), 'C:\\r');
});
