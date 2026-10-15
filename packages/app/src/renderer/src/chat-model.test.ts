import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askHeading, faceOf, hintText, opensMenu, parseChatPanes, serializeChatPanes, spinnerOf } from './chat-model.ts';

test('chatPanes: the pairs round trip, and a corrupt entry reads as nothing', () => {
  const panes = new Map([
    ['p1', 's1'],
    ['p2', 's2'],
  ]);
  assert.deepEqual(parseChatPanes(serializeChatPanes(panes)), panes);
  assert.equal(parseChatPanes(null).size, 0);
  assert.equal(parseChatPanes('{not json').size, 0);
  assert.equal(parseChatPanes('{"p1":"s1"}').size, 0);
  assert.deepEqual([...parseChatPanes('[["p1","s1"],["p2"],[3,"s"],"x"]')], [['p1', 's1']]);
});

test('faceOf: the chat only while the pane holds the session it was turned on', () => {
  const panes = new Map([['p1', 's1']]);
  assert.equal(faceOf(panes, 'p1', 's1'), 'chat');
  assert.equal(faceOf(panes, 'p1', 's2'), 'terminal', 'another session in the pane');
  assert.equal(faceOf(panes, 'p2', 's1'), 'terminal');
  assert.equal(faceOf(panes, 'p1', null), 'terminal');
});

// Claim 8's rows, read off Claude Code 2.1.300 on 2026-10-15 (M9 fix
// 688's claims, recorded in docs/DONE.md at the close-out).
test('spinnerOf: the word and the tokens received off the spinner row', () => {
  assert.deepEqual(spinnerOf(['❯ run it', '', '✢ Proofing…', '', '────', '❯', '────']), { word: 'Proofing', down: null });
  assert.deepEqual(spinnerOf(['● Pinging localhost six times · 2s', '✶ Forging… (3s · ↓ 88 tokens)', '────']), { word: 'Forging', down: '88' });
  assert.deepEqual(spinnerOf(['✢ Forging… (running PreToolUse hooks… 0/3 · 2s · ↓ 8 tokens)']), { word: 'Forging', down: '8' });
  assert.deepEqual(spinnerOf(['* Forging… (1m 40s · ↓ 3.1k tokens)']), { word: 'Forging', down: '3.1k' });
});

test('spinnerOf: a screen with no spinner, and a tool row, read nothing', () => {
  assert.equal(spinnerOf(['● Running 1 shell command…', '  Running 1 shell command…', '❯', '  ⏸ manual mode on']), null);
  assert.equal(spinnerOf([]), null);
});

// M9 fix 690: the sidebar card's four strings, pinned here so the two
// files cannot drift apart.
test('askHeading: the four reasons and none', () => {
  assert.equal(askHeading('permission'), 'Claude is asking permission');
  assert.equal(askHeading('agent-permission'), 'A subagent is asking permission');
  assert.equal(askHeading('question'), 'Claude has a question');
  assert.equal(askHeading('elicitation'), 'Waiting on you');
  assert.equal(askHeading(null), 'Waiting on you');
});

test('opensMenu: a picker command first in the box, case-sensitive', () => {
  assert.equal(opensMenu('/model'), true);
  assert.equal(opensMenu(' /model opus'), true);
  assert.equal(opensMenu('/compact'), false);
  assert.equal(opensMenu('model'), false);
  assert.equal(opensMenu('/Model'), false);
});

test('hintText: by the state', () => {
  assert.equal(hintText('working'), 'Sent when the turn ends');
  assert.equal(hintText('needs-input'), 'The ask takes the keys');
  assert.equal(hintText('idle'), '');
  assert.equal(hintText(undefined), '');
});
