import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Step, StepTurn } from '@emerald/shared';
import { pendingPlan, planBlocks, planFeedback, planPrompt, planSendGate, planTitle } from './plan-doc-model.ts';
import { planFile, planPath, planSessionId, tabKey } from './tabs-model.ts';

const turnOf = (steps: Step[]): StepTurn => ({ prompt: 'plan it', at: 0, endAt: null, steps, images: [] });
const tool = (name: string, input: Record<string, unknown>, result: Extract<Step, { kind: 'tool' }>['result'] = null): Step => ({ kind: 'tool', id: 'toolu_1', name, arg: '', input, at: 0, result });

test('pendingPlan reads the pending ExitPlanMode\'s text and file, null once it has a result or for another tool (M9 fix 1169)', () => {
  assert.deepEqual(pendingPlan([turnOf([tool('ExitPlanMode', { plan: '# P', planFilePath: 'C:/x/p.md' })])]), { toolUseId: 'toolu_1', text: '# P', path: 'C:/x/p.md' });
  assert.deepEqual(pendingPlan([turnOf([tool('ExitPlanMode', { planFilePath: 'C:/x/p.md' })])]), { toolUseId: 'toolu_1', text: null, path: 'C:/x/p.md' });
  assert.equal(pendingPlan([turnOf([tool('ExitPlanMode', { plan: '# P' }, { error: false, exitCode: null, endAt: 1, lines: null, added: null, removed: null, image: null })])]), null);
  assert.equal(pendingPlan([turnOf([tool('ExitPlanMode', {})])]), null);
  assert.equal(pendingPlan([turnOf([tool('Edit', { file_path: 'a', old_string: 'b', new_string: 'c' })])]), null);
  assert.equal(pendingPlan([]), null);
});

test('pendingPlan falls back to the last plans file written when the input is empty, as 2.1.322 writes it (M9 fix 1169)', () => {
  const write = (id: string, file: string, content: string): Step => ({ kind: 'tool', id, name: 'Write', arg: '', input: { file_path: file, content }, at: 0, result: null });
  const edit = (id: string, file: string): Step => ({ kind: 'tool', id, name: 'Edit', arg: '', input: { file_path: file, old_string: 'a', new_string: 'b' }, at: 0, result: null });
  const planFile = 'C:\\Users\\me\\.claude\\plans\\staged-shimmying-shamir.md';
  // The seat's real run: a Write of the plan and the ExitPlanMode in one message, the input empty.
  assert.deepEqual(pendingPlan([turnOf([write('w1', planFile, '# Add hello'), tool('ExitPlanMode', {})])]), { toolUseId: 'toolu_1', text: '# Add hello', path: planFile });
  // An Edit in a later turn: the path, no text (the file is read).
  assert.deepEqual(pendingPlan([turnOf([write('w1', planFile, '# Old')]), turnOf([edit('e1', planFile), tool('ExitPlanMode', {})])]), { toolUseId: 'toolu_1', text: null, path: planFile });
  // A project's plansDirectory with forward slashes.
  assert.equal(pendingPlan([turnOf([write('w1', 'C:/repo/.claude/plans/p.md', 'x'), tool('ExitPlanMode', {})])])?.path, 'C:/repo/.claude/plans/p.md');
  // A Markdown file elsewhere is not the plan.
  assert.equal(pendingPlan([turnOf([write('w1', 'C:/repo/docs/notes.md', 'x'), tool('ExitPlanMode', {})])]), null);
});

test('planBlocks cuts a plan into headings, list items and a fence, each with its line (M9 fix 1169)', () => {
  const blocks = planBlocks('# Plan\n\n## Steps\n\n1. Add the reader.\n2. Wire the card.\n\n```\nnpm test\n```\n');
  assert.deepEqual(
    blocks.map((b) => b.line),
    [1, 3, 5, 6, 8],
  );
  assert.deepEqual(
    blocks.map((b) => b.code),
    ['# Plan', '## Steps', '1. Add the reader.', '2. Wire the card.', '```'],
  );
  assert.ok(blocks[3]!.html.includes('<ol start="2">'), blocks[3]!.html);
  assert.ok(blocks[4]!.html.includes('<pre><code>npm test'), blocks[4]!.html);
  // CRLF reads as LF, and a nested list stays inside its item.
  const nested = planBlocks('- one\r\n  - inner\r\n- two\r\n');
  assert.deepEqual(
    nested.map((b) => b.line),
    [1, 3],
  );
  assert.ok(nested[0]!.html.includes('inner'));
});

test('planTitle takes the first heading, else the first line, cut at 80 (M9 fix 1169)', () => {
  assert.equal(planTitle('# Plan 1169\n\nSteps'), 'Plan 1169');
  assert.equal(planTitle('\nplain first\nsecond'), 'plain first');
  assert.equal(planTitle(''), '');
  const long = planTitle(`# ${'x'.repeat(100)}`);
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('…'));
});

test('planPrompt lists the comments by line and the general one last (M9 fix 1169)', () => {
  const text = planPrompt(
    [
      { rel: 'plan', line: 6, code: '2. Wire the card. ', text: ' Wire it after the reader.' },
      { rel: 'plan', line: 1, code: '# Plan', text: 'Name it.' },
    ],
    ' Keep it to one commit. ',
  );
  assert.equal(text, 'Comments on the plan:\n\nLine 1: # Plan\nName it.\n\nLine 6: 2. Wire the card.\nWire it after the reader.\n\nOverall: Keep it to one commit.');
  assert.equal(planPrompt([], ''), 'Comments on the plan:');
});

test('planSendGate sends only at the approval with a comment (M9 fix 1169)', () => {
  assert.deepEqual(planSendGate(undefined, 1), { enabled: false, note: 'No such session' });
  assert.deepEqual(planSendGate({ state: 'idle', needsInputReason: null }, 1), { enabled: false, note: 'The plan is not waiting for an answer' });
  assert.deepEqual(planSendGate({ state: 'needs-input', needsInputReason: 'question' }, 1), { enabled: false, note: 'The plan is not waiting for an answer' });
  assert.deepEqual(planSendGate({ state: 'needs-input', needsInputReason: 'permission' }, 0), { enabled: false, note: null });
  assert.deepEqual(planSendGate({ state: 'needs-input', needsInputReason: 'permission' }, 2), { enabled: true, note: null });
});

const dialog = (options: string[]) => [
  ' Ready to code?',
  " Here is Claude's plan:",
  ' # Plan 1169',
  ' Claude has written up a plan and is ready to execute. Would you like to proceed?',
  ...options,
  '      shift+tab to approve with this feedback',
  ' ctrl+g to edit in Notepad · plan-1169.md',
];

test('planFeedback finds the No, keep planning field off the pointer and on it (M9 fix 1169)', () => {
  assert.deepEqual(planFeedback(dialog(['❯ 1. Yes, and auto-accept edits', '  2. Yes, and manually approve edits', '  3. No, keep planning'])), { key: '3', pointer: false, typed: '' });
  assert.deepEqual(planFeedback(dialog(['❯ 1. Yes, and auto-accept edits', '  2. Yes, and manually approve edits', '  3. No, keep planning, tighter'])), { key: '3', pointer: false, typed: 'tighter' });
  assert.deepEqual(planFeedback(dialog(['  1. Yes, and auto-accept edits', '  2. Yes, and manually approve edits', '❯ 3. Tell Claude what to change'])), { key: '3', pointer: true, typed: '' });
  assert.deepEqual(planFeedback(dialog(['  1. Yes, and auto-accept edits', '  2. Yes, and manually approve edits', '❯ 3. tighter'])), { key: '3', pointer: true, typed: 'tighter' });
  assert.deepEqual(planFeedback(dialog(['❯ 1. Yes, and use ultraplan', '  2. Yes, and auto-accept edits', '  3. Yes, and manually approve edits', '  4. No, keep planning'])), { key: '4', pointer: false, typed: '' });
  // The question wrapped over two rows, as a narrow pane drew it on the seat's real run.
  assert.deepEqual(planFeedback([' Claude has written up a plan and is ready to execute. Would you like to', ' proceed?', '   1. Yes, and use auto mode', '   2. Yes, manually approve edits', ' ❯ 3. tighter']), { key: '3', pointer: true, typed: 'tighter' });
  // The real 2.1.322 dialog off the pointer: its field row draws the placeholder.
  assert.deepEqual(planFeedback(dialog(['❯ 1. Yes, and use auto mode', '  2. Yes, manually approve edits', '  3. Tell Claude what to change'])), { key: '3', pointer: false, typed: '' });
  assert.equal(planFeedback([' Do you want to make this edit to a.ts?', '❯ 1. Yes', '  2. Yes, allow all edits during this session', '  3. No']), null);
  assert.equal(planFeedback(['  1. Yes', '❯ 2. something typed']), null);
  assert.equal(planFeedback(['nothing numbered']), null);
});

test('planPath, planSessionId and planFile round-trip a session and a file with spaces (M9 fix 1169)', () => {
  const p = planPath('abc-123', 'C:\\Users\\me\\.claude\\plans\\my plan.md');
  assert.equal(planSessionId(p), 'abc-123');
  assert.equal(planFile(p), 'C:\\Users\\me\\.claude\\plans\\my plan.md');
  assert.equal(tabKey(p), 'emerald://plan/abc-123');
  assert.equal(planPath('abc-123'), 'emerald://plan/abc-123');
  assert.equal(planFile(planPath('abc-123')), null);
  assert.equal(planSessionId('emerald://review/abc-123'), null);
  assert.equal(planFile('file=C%3A%2Fp.md'), 'C:/p.md');
});
