import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentOut, liveConversations, runningFigure, sameAgentsRunning } from './agents-running-model.ts';
import type { TeamMember } from '@emerald/shared';
import { aSession } from './test-support.ts';

test('liveConversations leaves out an exited row whatever its exit code (M9 fix 831)', () => {
  const live = aSession({ id: 'live', kind: 'claude', state: 'working', conversation: { id: 'c-live', cwd: 'C:/r', args: [] }, costUsd: 1.5 });
  const gone = aSession({ id: 'gone', kind: 'claude', state: 'exited', exitCode: null, conversation: { id: 'c-gone', cwd: 'C:/r', args: [] }, costUsd: 2 });
  assert.deepEqual(liveConversations([live, gone]), [['c-live', 1.5]]);
});

// M9 fix 277: the row's and the card's dollar figure with the forks'
// spend since the main thread's last request, and the bare figure
// again once nothing is running.

const running = { since: 1000, usd: 25.2, tokens: { up: 46_900_000, down: 12_300, cached: 46_000_000 }, requests: 9, agents: 9, models: {}, spend: {} };

test('runningFigure: the sum with a ~ on the row, both parts on the card, the agents on the tokens line', () => {
  const got = runningFigure(9.78, running);
  assert.ok(got !== null && got.running);
  // Cents at every figure since M9 fix 395: 9.78 + 25.2 is $34.98, not $35.
  assert.equal(got.row, '$34.98 ~');
  assert.equal(got.part, '+ ~$25.20 running');
  assert.equal(got.card, '$9.78 + ~$25.20 running');
  assert.equal(got.tokens, '+ 46.9M sent, 12.3k received by 9 agents running');
  assert.ok(got.rowTitle !== null && got.rowTitle.startsWith("$9.78 Claude Code's own figure + ~$25.20 by 9 agents running"));
  assert.equal(runningFigure(1, { ...running, usd: 0.5, agents: 1, requests: 1 })?.tokens, '+ 46.9M sent, 12.3k received by 1 agent running');
});

test('runningFigure: the bare figure with nothing running, no answer yet, or no figure to add to', () => {
  const bare = { row: '$9.78', rowTitle: null, part: null, card: '$9.78', tokens: null, running: false };
  assert.deepEqual(runningFigure(9.78, null), bare, 'no answer yet');
  assert.deepEqual(runningFigure(9.78, { since: 1, usd: null, tokens: { up: 0, down: 0, cached: 0 }, requests: 0, agents: 0, models: {}, spend: {} }), bare, 'the main thread moved past the agents');
  assert.deepEqual(runningFigure(9.78, { ...running, usd: 0 }), bare, 'nothing priced');
  assert.equal(runningFigure(null, running), null, 'no status line yet, so no figure on the row');
});

// M9 fix 322: the shaded pane's faster beat runs while an agent is out,
// not for a shell member or an agent that has returned.
test('agentOut: a running agent member, not a shell or a returned agent', () => {
  const member = (kind: TeamMember['kind'], outcome: TeamMember['outcome']): TeamMember => ({ id: `${kind}-${outcome}`, kind, type: null, description: null, command: null, startedAt: 1, endedAt: outcome === 'running' ? null : 2, outcome, cwd: null, branch: null, commits: [], activity: null });
  assert.equal(agentOut([]), false, 'no team');
  assert.equal(agentOut([member('agent', 'running')]), true, 'an agent out');
  assert.equal(agentOut([member('agent', 'returned')]), false, 'an agent back');
  assert.equal(agentOut([member('shell', 'running')]), false, 'a shell running');
  assert.equal(agentOut([member('shell', 'running'), member('agent', 'returned'), member('agent', 'running')]), true, 'one agent out among the rest');
});

// M9 fix 354: an answer that says what the held one says publishes
// nothing, so the equal case is read field by field, the models too.
test('sameAgentsRunning: equal answers, a changed field, a changed model, and the first answer', () => {
  assert.equal(sameAgentsRunning(undefined, running), false, 'no answer held yet');
  assert.equal(sameAgentsRunning(null, null), true);
  assert.equal(sameAgentsRunning(running, null), false);
  assert.equal(sameAgentsRunning(null, running), false);
  assert.equal(sameAgentsRunning(running, { ...running, tokens: { ...running.tokens } }), true, 'the same figures in a new object');
  assert.equal(sameAgentsRunning(running, { ...running, usd: 25.3 }), false);
  assert.equal(sameAgentsRunning(running, { ...running, tokens: { ...running.tokens, down: 1 } }), false);
  const withModels = { ...running, models: { a1: 'claude-opus-5', a2: 'claude-sonnet-5' } };
  assert.equal(sameAgentsRunning(withModels, { ...withModels, models: { a1: 'claude-opus-5', a2: 'claude-sonnet-5' } }), true);
  assert.equal(sameAgentsRunning(withModels, { ...withModels, models: { a1: 'claude-opus-5' } }), false);
  assert.equal(sameAgentsRunning(withModels, { ...withModels, models: { a1: 'claude-opus-5', a2: 'claude-haiku-4-5' } }), false);
  // M9 fix 372: the spend per agent is part of the answer too.
  const withSpend = { ...withModels, spend: { a1: 1.5, a2: 0.25 } };
  assert.equal(sameAgentsRunning(withSpend, { ...withSpend, spend: { a1: 1.5, a2: 0.25 } }), true);
  assert.equal(sameAgentsRunning(withSpend, { ...withSpend, spend: { a1: 1.5, a2: 0.3 } }), false);
  assert.equal(sameAgentsRunning(withSpend, { ...withSpend, spend: { a1: 1.5 } }), false);
});
