import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, TeamMember } from '@emerald/shared';
import { askHeadParts, askNotice, toastAnswer } from './ask-notify-model.ts';
import { aSession } from './test-support.ts';

// M9 fix 1199: a permission ask answered from its toast, and the card's head.

type Asked = NonNullable<SessionInfo['askedFor']>;

const asked = (over: Partial<Asked> = {}): Asked => ({ words: 'Bash: echo hi', tool: 'Bash', input: 'echo hi', description: null, rule: null, reason: null, toolUseId: 'u1', agentId: null, at: 0, ...over });

const asking = (over: Partial<SessionInfo> = {}): SessionInfo => aSession({ id: 's1', name: 'Name', state: 'needs-input', needsInputReason: 'permission', askedFor: asked(), ...over });

const DIALOG = [' Bash command', '  echo hi', ' Do you want to proceed?', ' > 1. Yes', '   2. No', ' Esc to cancel'];

test('askNotice (M9 fix 1199): a permission ask the mod named gets its two-line body and an ask, every other arrival none', () => {
  assert.equal(askNotice(asking({ state: 'done', needsInputReason: null })), null, 'a done session');
  assert.equal(askNotice(asking({ needsInputReason: 'question' })), null, 'a question');
  assert.equal(askNotice(asking({ askedFor: asked({ input: null }) })), null, 'a permission with no input');
  assert.equal(askNotice(asking({ askedFor: asked({ toolUseId: null }) })), null, 'a permission with no call id');
  assert.deepEqual(askNotice(asking()), { sessionId: 's1', title: 'Name', body: 'Claude asks to run Bash:\necho hi', ask: { toolUseId: 'u1', command: 'echo hi' } });
  const member = { id: 'a1', kind: 'agent', type: 'Explore' } as TeamMember;
  const agent = askNotice(asking({ needsInputReason: 'agent-permission', askedFor: asked({ agentId: 'a1' }), team: [member] }));
  assert.equal(agent?.title, 'Name · Explore');
  assert.equal(agent?.body, 'Agent Explore asks to run Bash:\necho hi');
  assert.equal(askNotice(asking({ needsInputReason: 'agent-permission', askedFor: asked({ agentId: 'gone' }), team: [member] }))?.title, 'Name · agent', 'no member found reads as agent');
});

test('toastAnswer (M9 fix 1199): each drop in order, then Allow once as 1 and Deny as Escape', () => {
  const base = { session: asking(), toolUseId: 'u1', index: 0, rows: DIALOG, answered: false };
  assert.deepEqual(toastAnswer({ ...base, answered: true, session: undefined }), { dropped: 'already answered' });
  assert.deepEqual(toastAnswer({ ...base, session: undefined }), { dropped: 'the session is gone' });
  assert.deepEqual(toastAnswer({ ...base, session: asking({ state: 'working' }) }), { dropped: 'the ask is over' });
  assert.deepEqual(toastAnswer({ ...base, session: asking({ needsInputReason: 'question' }) }), { dropped: 'the ask is over' });
  assert.deepEqual(toastAnswer({ ...base, toolUseId: 'other' }), { dropped: 'another ask is up' });
  assert.deepEqual(toastAnswer({ ...base, index: 2 }), { dropped: 'no such action' });
  assert.deepEqual(toastAnswer({ ...base, rows: null }), { dropped: 'the screen could not be read' });
  assert.deepEqual(toastAnswer({ ...base, rows: [' > ', ' some reply'] }), { dropped: 'the screen shows no permission dialog' });
  assert.deepEqual(toastAnswer(base), { keys: '1', allowed: true });
  assert.deepEqual(toastAnswer({ ...base, index: 1 }), { keys: '\x1b', allowed: false });
});

test('askHeadParts (M9 fix 1199): the rule, else the reason, else no why line; the agent suffix on the description', () => {
  assert.deepEqual(askHeadParts(asked({ rule: 'Bash(echo:*)', reason: 'ask rule' }), null), { desc: null, why: 'Rule: Bash(echo:*)' });
  assert.deepEqual(askHeadParts(asked({ reason: 'ask rule' }), null), { desc: null, why: 'ask rule' });
  assert.deepEqual(askHeadParts(asked({ description: 'Say hi' }), null), { desc: 'Say hi', why: null });
  assert.deepEqual(askHeadParts(asked({ description: 'Say hi' }), 'Explore'), { desc: 'Say hi for agent Explore', why: null });
  assert.deepEqual(askHeadParts(asked(), 'Explore'), { desc: 'for agent Explore', why: null });
});
