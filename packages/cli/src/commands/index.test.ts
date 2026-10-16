import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands } from './index.ts';

// The table copies each command's name and summary so `emmer help` loads no
// command module (M9 fix 736); this holds the copies to the modules.
test('every entry loads its module, and the name and summary match the copy (M9 fix 736)', async () => {
  for (const entry of commands) {
    const loaded = await entry.load();
    assert.equal(loaded.name, entry.name);
    assert.equal(loaded.summary, entry.summary, `${entry.name}'s summary`);
  }
});

test('the commands are listed in help order (M9 fix 736)', () => {
  assert.deepEqual(
    commands.map((c) => c.name),
    ['ls', 'new', 'shell', 'send', 'read', 'wait', 'prompt', 'prompts', 'explain', 'activity', 'usage', 'conflicts', 'set', 'kill', 'resume', 'rm', 'focus', 'open', 'browser', 'hooks', 'mod-channel', 'skill', 'daemon', 'update', 'feed'],
  );
});
