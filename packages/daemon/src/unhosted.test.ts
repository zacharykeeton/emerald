import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silentLogger } from './log.ts';
import { UnhostedSessions } from './unhosted.ts';

const T0 = 1_700_000_000_000;
const conv = 'conv-plain-terminal';
const cwd = 'C:/code/elsewhere';

test('an unhosted conversation runs the state machine on a bare record and hands back the transitions (M9 fix 233)', () => {
  const u = new UnhostedSessions(silentLogger);
  assert.deepEqual(u.apply(conv, { hook_event_name: 'SessionStart', session_id: conv, cwd, source: 'startup' }, T0), { outcome: 'applied', from: 'starting', to: 'idle' });
  assert.deepEqual(u.apply(conv, { hook_event_name: 'UserPromptSubmit', session_id: conv, cwd, prompt: 'go' }, T0 + 1000), { outcome: 'applied', from: 'idle', to: 'working' });
  // A tool call mid-turn moves nothing.
  assert.deepEqual(u.apply(conv, { hook_event_name: 'PreToolUse', session_id: conv, cwd, tool_name: 'Read' }, T0 + 2000), { outcome: 'applied' });
  const listed = u.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, conv);
  assert.equal(listed[0]?.state, 'working');
  assert.equal(listed[0]?.cwd, cwd);
  assert.equal(listed[0]?.groupCwd, cwd);
  assert.equal(listed[0]?.claudeSessionId, conv);
  assert.deepEqual(u.apply(conv, { hook_event_name: 'Stop', session_id: conv, cwd }, T0 + 5000), { outcome: 'applied', from: 'working', to: 'done' });
  // The end forgets it; a later hook starts afresh.
  u.apply(conv, { hook_event_name: 'SessionEnd', session_id: conv, cwd, reason: 'exit' }, T0 + 6000);
  assert.deepEqual(u.list(), []);
});

test('a conversation first seen mid-turn still opens a span at its prompt, and one seen without a SessionStart is placed by its hooks', () => {
  const u = new UnhostedSessions(silentLogger);
  const r = u.apply(conv, { hook_event_name: 'UserPromptSubmit', session_id: conv, cwd, prompt: 'first words' }, T0);
  assert.equal(r.to, 'working');
  assert.equal(u.list()[0]?.cwd, cwd);
});

test('two conversations are two records, and a foreign id on a conversation is dropped as it is on a pane', () => {
  const u = new UnhostedSessions(silentLogger);
  u.apply('one', { hook_event_name: 'UserPromptSubmit', session_id: 'one', cwd }, T0);
  u.apply('two', { hook_event_name: 'UserPromptSubmit', session_id: 'two', cwd }, T0);
  assert.deepEqual(u.list().map((s) => [s.id, s.state]), [['one', 'working'], ['two', 'working']]);
  // A nested claude -p's hook, were it ever posted under the outer id, is foreign to it.
  assert.deepEqual(u.apply('one', { hook_event_name: 'Stop', session_id: 'nested', cwd }, T0 + 1000), { outcome: 'applied' });
  assert.equal(u.list()[0]?.state, 'working');
});

test('a conversation silent past the bound is aged out and one that posted inside it is kept (M9 fix 460)', () => {
  const u = new UnhostedSessions(silentLogger, { ageOutAfterMs: 60_000, sweepEveryMs: 3_600_000 });
  try {
    u.apply('quiet', { hook_event_name: 'UserPromptSubmit', session_id: 'quiet', cwd }, T0);
    u.apply('busy', { hook_event_name: 'UserPromptSubmit', session_id: 'busy', cwd }, T0);
    u.apply('busy', { hook_event_name: 'PreToolUse', session_id: 'busy', cwd, tool_name: 'Read' }, T0 + 50_000);
    // Exactly at the bound is still inside it.
    u.sweep(T0 + 60_000);
    assert.deepEqual(u.list().map((s) => s.id), ['quiet', 'busy']);
    u.sweep(T0 + 61_000);
    assert.deepEqual(u.list().map((s) => [s.id, s.state]), [['busy', 'working']]);
    // A hook after the age-out starts the conversation afresh.
    u.apply('quiet', { hook_event_name: 'UserPromptSubmit', session_id: 'quiet', cwd }, T0 + 70_000);
    assert.deepEqual(u.list().map((s) => s.id), ['busy', 'quiet']);
  } finally {
    u.stop();
  }
});
