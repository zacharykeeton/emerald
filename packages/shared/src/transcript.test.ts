import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantText, movesHead, parseTurns, usageFold, usageList, usageOf, usageState } from './transcript.ts';

const line = (o: unknown): string => JSON.stringify(o);
const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
  line({ parentUuid: 'p', isSidechain: false, type: 'assistant', message: { role: 'assistant', content }, ...extra });

test('assistantText: the first line of the first text part of an assistant line', () => {
  assert.equal(assistantText(assistant([{ type: 'text', text: '\n  Reading the log.\nThen the diff.' }])), 'Reading the log.');
  // A thinking part before the text is skipped, not read as nothing.
  assert.equal(assistantText(assistant([{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'Done.' }])), 'Done.');
});

test('assistantText: a tool_use-only line and a thinking-only line say nothing', () => {
  assert.equal(assistantText(assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }])), null);
  assert.equal(assistantText(assistant([{ type: 'thinking', thinking: 'let me see', signature: 'x' }])), null);
});

test('assistantText: a side chain line, a user line and broken JSON say nothing', () => {
  assert.equal(assistantText(assistant([{ type: 'text', text: 'From a subagent.' }], { isSidechain: true })), null);
  assert.equal(assistantText(line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } })), null);
  assert.equal(assistantText('{"type":"assistant","message":{"content":[{"type":"text","te'), null);
  assert.equal(assistantText(''), null);
  assert.equal(assistantText('"a string"'), null);
});

test('assistantText: blank text is nothing', () => {
  assert.equal(assistantText(assistant([{ type: 'text', text: '  \n\n ' }])), null);
  assert.equal(assistantText(assistant([{ type: 'text', text: '' }, { type: 'text', text: 'second' }])), 'second');
});

const user = (content: unknown, at: string, extra: Record<string, unknown> = {}) => line({ type: 'user', message: { role: 'user', content }, timestamp: at, ...extra });
const turnLine = (content: unknown[], at: string, extra: Record<string, unknown> = {}) => line({ type: 'assistant', message: { role: 'assistant', content }, timestamp: at, ...extra });
const tool = (name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id: 't', name, input });

test('parseTurns: a prompt opens a turn, the last text is its reply, the tools are counted and named', () => {
  const text = [
    line({ type: 'ai-title', aiTitle: 'Fix the tabs' }),
    user('the tabs are broken', '2026-09-13T09:12:00.000Z'),
    turnLine([{ type: 'text', text: 'Looking.' }, tool('Read', { file_path: 'C:/repo/src/tabs.ts' })], '2026-09-13T09:12:05.000Z'),
    user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }], '2026-09-13T09:12:06.000Z'),
    turnLine([tool('Edit', { file_path: 'C:/repo/src/tabs.ts' }), tool('Read', { file_path: 'C:/repo/src/tabs.ts' }), tool('Bash', { command: 'git commit -m "x"' }), tool('Bash', { command: 'git status' }), tool('PowerShell', { command: 'git merge --no-ff x' })], '2026-09-13T09:15:00.000Z'),
    turnLine([{ type: 'text', text: 'Two files changed.\nThe tests pass.' }], '2026-09-13T09:18:00.000Z'),
    user('<command-name>/clear</command-name>\n<command-args></command-args>', '2026-09-13T09:20:00.000Z'),
    user('<local-command-stdout>done</local-command-stdout>', '2026-09-13T09:20:01.000Z'),
    user('now fix them', '2026-09-13T10:00:00.000Z'),
  ].join('\n');
  const turns = parseTurns(text);
  assert.equal(turns.length, 3);
  const first = turns[0]!;
  assert.equal(first.prompt, 'the tabs are broken');
  assert.equal(first.at, Date.parse('2026-09-13T09:12:00.000Z'));
  assert.equal(first.endAt, Date.parse('2026-09-13T09:18:00.000Z'));
  assert.equal(first.reply, 'Two files changed.\nThe tests pass.');
  assert.equal(first.toolCalls, 6);
  assert.deepEqual(first.filesEdited, ['C:/repo/src/tabs.ts']);
  assert.deepEqual(first.filesRead, ['C:/repo/src/tabs.ts']);
  assert.equal(first.commits, 2, 'a PowerShell tool merge counts too (M9 fix 106)');
  assert.equal(turns[1]!.prompt, '/clear');
  assert.equal(turns[1]!.reply, null);
  assert.equal(turns[2]!.prompt, 'now fix them');
  assert.equal(turns[2]!.endAt, null);
});

test('parseTurns: meta lines, side-chain lines and broken lines are skipped', () => {
  const text = [
    user('<local-command-caveat>x</local-command-caveat>', '2026-09-13T09:00:00.000Z', { isMeta: true }),
    user('hello', '2026-09-13T09:01:00.000Z'),
    turnLine([{ type: 'text', text: 'From a subagent.' }], '2026-09-13T09:01:30.000Z', { isSidechain: true }),
    '{"type":"assistant","message":{"content":[{"type":"text","te',
    turnLine([{ type: 'text', text: 'Hi.' }], '2026-09-13T09:02:00.000Z'),
  ].join('\n');
  const turns = parseTurns(text);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.reply, 'Hi.');
  assert.equal(parseTurns('').length, 0);
});

test('movesHead names the git commands that can move HEAD and nothing else', () => {
  for (const c of ['git commit -m "x"', 'git add -A && git commit -q -F msg.txt', 'cd packages/app && git merge --no-ff fix-rail', 'git rebase main', 'GIT_EDITOR=true git rebase --continue']) assert.ok(movesHead(c), c);
  for (const c of ['git status', 'git log --oneline -5', 'npm run commit', 'echo commit', 'commit && git status', 'git stash; echo merge']) assert.ok(!movesHead(c), c);
});

// M9 fix 252: the per-request usage. A value is a token count, or (M9
// fix 278) the cache_creation object naming the 1-hour share.
const usageLine = (id: string | null, at: string, usage: Record<string, number | Record<string, number>>, extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', isSidechain: false, timestamp: at, message: { id, role: 'assistant', model: 'claude-opus-5', usage, content: [] }, ...extra });

test('usageOf: one entry per message id with the last streamed line\'s figures, in time order, side chains skipped', () => {
  const text = [
    // A reply streamed as two lines: the first block's line carries the
    // usage as it stood, the second the whole request's.
    usageLine('msg_1', '2026-09-16T10:00:00.000Z', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 4000, output_tokens: 10 }),
    usageLine('msg_1', '2026-09-16T10:00:03.000Z', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 4000, output_tokens: 136 }),
    usageLine('msg_2', '2026-09-16T10:01:00.000Z', { input_tokens: 5, cache_read_input_tokens: 4100, output_tokens: 20 }, { agentId: 'a1', isSidechain: true }),
    // A side-chain line naming no agent cannot be credited.
    usageLine('msg_3', '2026-09-16T10:02:00.000Z', { input_tokens: 1, output_tokens: 1 }, { isSidechain: true }),
    // An older transcript's line with no message id counts on its own.
    usageLine(null, '2026-09-16T09:59:00.000Z', { input_tokens: 7, output_tokens: 3 }),
    line({ type: 'user', timestamp: '2026-09-16T10:03:00.000Z', message: { role: 'user', content: 'hi' } }),
    '{"type":"assistant","message":{"usage":{',
  ].join('\n');
  const got = usageOf(text);
  assert.deepEqual(got, [
    { at: Date.parse('2026-09-16T09:59:00.000Z'), agentId: null, model: 'claude-opus-5', fresh: 7, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 3 },
    { at: Date.parse('2026-09-16T10:00:03.000Z'), agentId: null, model: 'claude-opus-5', fresh: 2, cacheWrite: 100, cacheWrite1h: 0, cacheRead: 4000, output: 136 },
    { at: Date.parse('2026-09-16T10:01:00.000Z'), agentId: 'a1', model: 'claude-opus-5', fresh: 5, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 4100, output: 20 },
  ]);
});

// M9 fix 278: the split Claude Code puts on a line that names it, read
// apart from the whole cacheWrite figure, and 0 on a line whose usage
// carries no cache_creation object (every line before the split).
test('usageOf: the 1-hour share of a cache write reads off cache_creation, and 0 without it', () => {
  const withSplit = usageLine('msg_1', '2026-09-16T10:00:00.000Z', {
    input_tokens: 2,
    cache_creation_input_tokens: 1000,
    cache_read_input_tokens: 0,
    output_tokens: 10,
    cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
  });
  const noSplit = usageLine('msg_2', '2026-09-16T10:01:00.000Z', { input_tokens: 1, cache_creation_input_tokens: 50, cache_read_input_tokens: 0, output_tokens: 5 });
  const got = usageOf([withSplit, noSplit].join('\n'));
  assert.equal(got[0]!.cacheWrite1h, 600, 'the split read off cache_creation');
  assert.equal(got[0]!.cacheWrite, 1000, 'the whole figure is unchanged');
  assert.equal(got[1]!.cacheWrite1h, 0, 'no cache_creation object reads as 0');
});

test("usageOf: an agent's own file takes the agent named by the caller for its lines", () => {
  const text = usageLine('msg_5', '2026-09-16T10:00:00.000Z', { input_tokens: 1, output_tokens: 2 }, { isSidechain: true });
  assert.deepEqual(usageOf(text, 'a9').map((m) => m.agentId), ['a9']);
  // A line that names its agent keeps that name over the caller's.
  const named = usageLine('msg_6', '2026-09-16T10:00:00.000Z', { input_tokens: 1, output_tokens: 2 }, { isSidechain: true, agentId: 'a1' });
  assert.deepEqual(usageOf(named, 'a9').map((m) => m.agentId), ['a1']);
});

test('usageOf: a line with no timestamp or no usage block is not a request', () => {
  const text = [
    line({ type: 'assistant', message: { id: 'msg_9', usage: { input_tokens: 1 }, content: [] } }),
    line({ type: 'assistant', timestamp: '2026-09-16T10:00:00.000Z', message: { id: 'msg_8', content: [{ type: 'text', text: 'no usage' }] } }),
  ].join('\n');
  assert.deepEqual(usageOf(text), []);
});

// M9 fix 528: a fold over a text cut in two, with a streamed update of
// one id on each side of the cut, gives what a parse of the whole gives.
test('usageFold: two halves folded into one state list as usageOf of the whole', () => {
  const lines = [
    usageLine('msg_1', '2026-09-16T10:00:00.000Z', { input_tokens: 2, output_tokens: 10 }),
    usageLine('msg_2', '2026-09-16T10:01:00.000Z', { input_tokens: 3, output_tokens: 20 }),
    usageLine(null, '2026-09-16T09:59:00.000Z', { input_tokens: 7, output_tokens: 3 }),
    // The cut falls here: msg_1 and msg_2 each stream an update after it.
    usageLine('msg_1', '2026-09-16T10:00:04.000Z', { input_tokens: 2, output_tokens: 140 }),
    usageLine('msg_3', '2026-09-16T10:02:00.000Z', { input_tokens: 1, output_tokens: 5 }),
    usageLine('msg_2', '2026-09-16T10:01:05.000Z', { input_tokens: 3, output_tokens: 90 }),
  ];
  const whole = lines.join('\n') + '\n';
  const state = usageState();
  usageFold(state, lines.slice(0, 3).join('\n') + '\n', null);
  usageFold(state, lines.slice(3).join('\n') + '\n', null);
  assert.deepEqual(usageList(state), usageOf(whole));
  assert.deepEqual(usageList(state).map((m) => m.output), [3, 140, 90, 5]);
});
