import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistantText, editCounts, effortOf, movesHead, parseSteps, parseTurns, resultText, usageFold, usageList, usageOf, usageState } from './transcript.ts';
import type { Step, StepTurn } from './transcript.ts';

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

const tabsFixture = (): string =>
  [
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

test('parseTurns: a prompt opens a turn, the last text is its reply, the tools are counted and named', () => {
  const turns = parseTurns(tabsFixture());
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

// M9 fix 688: the chat view's parse. The lines are written by hand in the
// shapes Claude Code 2.1.300 writes (thinking text empty with its length
// beside it, a result's toolUseResult beside the tool_result part).
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown, at: string, extra: Record<string, unknown> = {}, isError = false) =>
  line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] }, timestamp: at, ...extra });
const toolOf = (turn: StepTurn, i: number) => {
  const s = turn.steps[i]!;
  assert.equal(s.kind, 'tool');
  return s as Extract<Step, { kind: 'tool' }>;
};

test('parseSteps: thinking, an Agent, a Read, an Edit and the reply, in order', () => {
  const text = [
    user('find where cdp.mjs sends keyDown', '2026-10-15T14:02:00.000Z'),
    turnLine([{ type: 'thinking', thinking: '', signature: 's' }], '2026-10-15T14:02:06.000Z', { thinkingDisplay: 'updates', thinkingDurationMs: 6000 }),
    turnLine([toolUse('a1', 'Agent', { subagent_type: 'Explore', description: 'where the harness sends keys', prompt: 'look' })], '2026-10-15T14:02:07.000Z'),
    result('a1', [{ type: 'text', text: 'found it' }], '2026-10-15T14:02:48.000Z'),
    turnLine([toolUse('r1', 'Read', { file_path: 'packages/app/scripts/cdp.mjs' })], '2026-10-15T14:02:50.000Z'),
    result('r1', 'the file', '2026-10-15T14:02:51.000Z', { toolUseResult: { type: 'text', file: { filePath: 'packages/app/scripts/cdp.mjs', numLines: 912, startLine: 1, totalLines: 912 } } }),
    turnLine([toolUse('e1', 'Edit', { file_path: 'packages/app/scripts/cdp.mjs', old_string: 'a', new_string: 'b' })], '2026-10-15T14:03:00.000Z'),
    result('e1', 'ok', '2026-10-15T14:03:01.000Z', { toolUseResult: { filePath: 'packages/app/scripts/cdp.mjs', structuredPatch: [{ lines: [' x', '-a', '+b', '+c', '+d'] }, { lines: ['-e', '+f', '+g', '+h', ' y'] }] } }),
    turnLine([{ type: 'text', text: 'It sends rawKeyDown now.' }], '2026-10-15T14:05:12.000Z'),
  ].join('\n');
  const turns = parseSteps(text);
  assert.equal(turns.length, 1);
  const t = turns[0]!;
  assert.equal(t.prompt, 'find where cdp.mjs sends keyDown');
  assert.deepEqual(t.steps.map((s) => s.kind), ['thinking', 'tool', 'tool', 'tool', 'text']);
  const thinking = t.steps[0]!;
  assert.ok(thinking.kind === 'thinking' && thinking.ms === 6000 && thinking.text === '');
  const agent = toolOf(t, 1);
  assert.equal(agent.arg, 'Explore: where the harness sends keys');
  assert.equal(resultText(agent), 'returned after 41s');
  const read = toolOf(t, 2);
  assert.equal(read.arg, 'packages/app/scripts/cdp.mjs');
  assert.equal(resultText(read), '912 lines');
  assert.equal(resultText(toolOf(t, 3)), '+6 −2');
  assert.deepEqual(t.steps[4], { kind: 'text', text: 'It sends rawKeyDown now.', at: Date.parse('2026-10-15T14:05:12.000Z') });
  assert.equal(t.endAt, Date.parse('2026-10-15T14:05:12.000Z'));
});

test('parseSteps: a passing Bash is exit 0, a failing one reads its code off the result', () => {
  const text = [
    user('run the tests', '2026-10-15T14:09:00.000Z'),
    turnLine([toolUse('b1', 'Bash', { command: 'npm run verify:browser' })], '2026-10-15T14:09:01.000Z'),
    result('b1', 'PASS', '2026-10-15T14:09:39.000Z', { toolUseResult: { stdout: 'PASS', stderr: '', interrupted: false } }),
    turnLine([toolUse('b2', 'Bash', { command: 'false' })], '2026-10-15T14:09:40.000Z'),
    result('b2', 'Exit code 2\nboom', '2026-10-15T14:09:41.000Z', { toolUseResult: 'Error: Exit code 2\nboom' }, true),
    turnLine([toolUse('b3', 'PowerShell', { command: 'x' })], '2026-10-15T14:09:42.000Z'),
    result('b3', [{ type: 'text', text: 'the shell went away' }], '2026-10-15T14:09:43.000Z', {}, true),
  ].join('\n');
  const t = parseSteps(text)[0]!;
  assert.equal(toolOf(t, 0).arg, 'npm run verify:browser');
  assert.equal(toolOf(t, 0).result?.exitCode, 0);
  assert.equal(resultText(toolOf(t, 0)), 'exit 0 · 38s');
  assert.equal(toolOf(t, 1).result?.error, true);
  assert.equal(resultText(toolOf(t, 1)), 'exit 2 · 1s');
  assert.equal(toolOf(t, 2).result?.exitCode, null);
  assert.equal(resultText(toolOf(t, 2)), 'error · 1s');
});

test('parseSteps: an image result carries its media type and size', () => {
  const text = [
    user('show me the page', '2026-10-15T14:10:00.000Z'),
    turnLine([toolUse('i1', 'Read', { file_path: 'after-key.png' })], '2026-10-15T14:10:01.000Z'),
    result('i1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], '2026-10-15T14:10:02.000Z', { toolUseResult: { type: 'image', file: { type: 'image/png', originalSize: 86016, dimensions: {} } } }),
  ].join('\n');
  const step = toolOf(parseSteps(text)[0]!, 0);
  assert.deepEqual(step.result?.image, { mediaType: 'image/png', bytes: 86016, data: 'AAAA' });
  assert.equal(resultText(step), '84 KB');
});

test('parseSteps: a pasted image rides on its prompt', () => {
  const text = [
    user([{ type: 'text', text: '[Image #1] look at this' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } }], '2026-10-15T14:10:00.000Z', { promptId: 'p1', imagePasteIds: [1] }),
    turnLine([{ type: 'text', text: 'Seen.' }], '2026-10-15T14:10:01.000Z'),
  ].join('\n');
  const turns = parseSteps(text);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.prompt, '[Image #1] look at this');
  assert.deepEqual(turns[0]!.images, [{ mediaType: 'image/png', data: 'BBBB' }]);
});

test("parseSteps: a slash command's images ride on its meta line", () => {
  const img = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
  const lines = (ids: boolean) => [
    user('<command-message>backlog</command-message>\n<command-name>/backlog</command-name>\n<command-args>[Image #1] file it [Image #2]</command-args>', '2026-10-15T14:10:00.000Z', ids ? { promptId: 'p2', uuid: 'u2' } : { uuid: 'u2' }),
    user([img('CCCC'), img('DDDD'), { type: 'text', text: 'Base directory for this skill: x' }], '2026-10-15T14:10:00.000Z', ids ? { isMeta: true, promptId: 'p2' } : { isMeta: true, parentUuid: 'u2' }),
    user([img('EEEE')], '2026-10-15T14:10:01.000Z', { isMeta: true, promptId: 'p9' }),
    turnLine([{ type: 'text', text: 'Filed.' }], '2026-10-15T14:10:02.000Z'),
  ].join('\n');
  for (const ids of [true, false]) {
    const turns = parseSteps(lines(ids));
    assert.equal(turns.length, 1);
    assert.equal(turns[0]!.prompt, '/backlog [Image #1] file it [Image #2]');
    assert.deepEqual(turns[0]!.images.map((i) => i.data), ['CCCC', 'DDDD'], `ids ${ids}`);
  }
});

test('parseSteps: a tool with no result yet is pending, and an edit\'s counts come from its strings', () => {
  const text = [
    user('edit it', '2026-10-15T14:11:00.000Z'),
    turnLine([toolUse('e1', 'Edit', { file_path: 'a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nX\nc' })], '2026-10-15T14:11:01.000Z'),
  ].join('\n');
  const pending = toolOf(parseSteps(text)[0]!, 0);
  assert.equal(pending.result, null);
  assert.equal(resultText(pending), '');
  assert.deepEqual(editCounts('a\nb\nc', 'a\nB\nX\nc'), { added: 2, removed: 1 });
  const done = toolOf(parseSteps(text + '\n' + result('e1', 'ok', '2026-10-15T14:11:02.000Z'))[0]!, 0);
  assert.equal(resultText(done), '+2 −1', 'no structuredPatch: the counts come off the input');
});

test('parseSteps: side-chain lines, a result for an unknown id, a broken line and an interrupt', () => {
  const text = [
    user('do the thing', '2026-10-15T14:12:00.000Z'),
    turnLine([toolUse('s1', 'Bash', { command: 'ls' })], '2026-10-15T14:12:01.000Z', { isSidechain: true }),
    turnLine([toolUse('m1', 'Bash', { command: 'ls' }), toolUse('m1', 'Bash', { command: 'ls' })], '2026-10-15T14:12:02.000Z'),
    result('zz', 'stray', '2026-10-15T14:12:03.000Z'),
    '{"type":"assistant","message":{"content":[{"type":"text","te',
    user([{ type: 'text', text: '[Request interrupted by user for tool use]' }], '2026-10-15T14:12:04.000Z', { interruptedMessageId: 'msg_1' }),
    user('[Request interrupted by user]', '2026-10-15T14:12:05.000Z'),
  ].join('\n');
  const turns = parseSteps(text);
  assert.equal(turns.length, 1);
  assert.deepEqual(turns[0]!.steps.map((s) => s.kind), ['tool', 'note', 'note']);
  assert.equal(toolOf(turns[0]!, 0).result, null, 'the stray result fills nothing');
  assert.equal(turns[0]!.endAt, Date.parse('2026-10-15T14:12:05.000Z'));
  // The one place the two readings differ: parseTurns takes the
  // interrupts as prompts.
  assert.equal(parseTurns(text).length, turns.length + 2);
});

test("parseSteps: the prompts are parseTurns' prompts", () => {
  const text = tabsFixture();
  assert.deepEqual(parseSteps(text).map((t) => [t.prompt, t.at, t.endAt]), parseTurns(text).map((t) => [t.prompt, t.at, t.endAt]));
});

// M9 fix 713: the model chip's effort, off the last main-chain assistant line.
test('effortOf: the last assistant line decides, side chains and broken lines skipped', () => {
  const user = line({ type: 'user', message: { role: 'user', content: 'go' } });
  const a = (effort?: string, extra: Record<string, unknown> = {}) => assistant([{ type: 'text', text: 'ok' }], effort === undefined ? extra : { effort, ...extra });
  assert.equal(effortOf([user, a('low'), a('high'), user].join('\n')), 'high');
  assert.equal(effortOf([a('low'), a()].join('\n')), null, 'the last line has none');
  assert.equal(effortOf([a('medium'), a('low', { isSidechain: true })].join('\n')), 'medium');
  assert.equal(effortOf([a('high'), '{"type":"assistant","effort":"lo'].join('\n')), 'high');
  assert.equal(effortOf([user, ''].join('\n')), null);
  assert.equal(effortOf(''), null);
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

// M9 fix 754: Claude Code's queue off its queue-operation lines, and a
// message absorbed mid-turn as a step of the open turn.
import { queueFold, queueList, queueState, queuedOf } from './transcript.ts';

const qop = (operation: string, content?: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'queue-operation', operation, timestamp: '2026-10-15T14:00:00.000Z', sessionId: 's', ...(content === undefined ? {} : { content }), ...extra });
const NOTE = '<task-notification>\n<task-id>x</task-id>\n</task-notification>';

test('queuedOf: an enqueue shows, and its absorbed remove takes it', () => {
  assert.deepEqual(queuedOf(qop('enqueue', 'fix the footer')), [{ text: 'fix the footer', at: Date.parse('2026-10-15T14:00:00.000Z') }]);
  assert.deepEqual(queuedOf([qop('enqueue', 'fix the footer'), qop('remove', 'fix the footer', { reason: 'absorbed_mid_turn' })].join('\n')), []);
});

test('queuedOf: a dequeue takes the oldest, a notification included', () => {
  assert.deepEqual(queuedOf([qop('enqueue', 'one'), qop('enqueue', 'two'), qop('dequeue')].join('\n')).map((m) => m.text), ['two']);
  assert.deepEqual(queuedOf([qop('enqueue', NOTE), qop('enqueue', 'mine'), qop('dequeue')].join('\n')).map((m) => m.text), ['mine']);
  assert.deepEqual(queuedOf([qop('enqueue', NOTE), qop('enqueue', '<agent-message from="x">hi')].join('\n')), []);
});

test('queuedOf: popOne takes its own message, popAll takes each', () => {
  const three = [qop('enqueue', 'a'), qop('enqueue', 'b'), qop('enqueue', 'c')];
  assert.deepEqual(queuedOf([...three, qop('popOne', 'b')].join('\n')).map((m) => m.text), ['a', 'c']);
  assert.deepEqual(queuedOf([...three, qop('popAll', 'a'), qop('popAll', 'b'), qop('popAll', 'c')].join('\n')), []);
});

test('queuedOf: a prompt line equal to a held message takes it', () => {
  const prompt = line({ type: 'user', isSidechain: false, message: { role: 'user', content: 'b' }, timestamp: '2026-10-15T14:01:00.000Z' });
  assert.deepEqual(queuedOf([qop('enqueue', 'a'), qop('enqueue', 'b'), prompt].join('\n')).map((m) => m.text), ['a']);
});

test('queueFold: a fold over the text split at every line boundary equals the whole', () => {
  const lines = [qop('enqueue', NOTE), qop('enqueue', 'a'), qop('enqueue', 'b'), qop('dequeue'), qop('popOne', 'b'), qop('enqueue', 'c')];
  const whole = lines.join('\n') + '\n';
  for (let cut = 0; cut <= lines.length; cut++) {
    const state = queueState();
    queueFold(state, lines.slice(0, cut).join('\n') + '\n');
    queueFold(state, lines.slice(cut).join('\n') + '\n');
    assert.deepEqual(queueList(state), queuedOf(whole), `cut at ${cut}`);
  }
  assert.deepEqual(queuedOf(whole).map((m) => m.text), ['a', 'c']);
});

test('parseSteps: a human queued_command attachment is a queued step of the open turn; a notification is not', () => {
  const attach = (attachment: Record<string, unknown>) => line({ type: 'attachment', isSidechain: false, timestamp: '2026-10-15T14:05:00.000Z', attachment });
  const text = [
    line({ type: 'user', isSidechain: false, message: { role: 'user', content: 'go' }, timestamp: '2026-10-15T14:00:00.000Z' }),
    assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    attach({ type: 'queued_command', prompt: 'also this', commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true, timestamp: '2026-10-15T14:02:00.000Z' }),
    attach({ type: 'queued_command', prompt: [{ type: 'text', text: 'see' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } }, { type: 'text', text: 'this' }], commandMode: 'prompt', origin: { kind: 'human' }, timestamp: '2026-10-15T14:03:00.000Z' }),
    attach({ type: 'queued_command', prompt: NOTE, commandMode: 'task-notification', origin: { kind: 'task-notification' } }),
  ].join('\n');
  const steps = parseSteps(text)[0]!.steps;
  assert.deepEqual(
    steps.filter((s) => s.kind === 'queued'),
    [
      { kind: 'queued', text: 'also this', at: Date.parse('2026-10-15T14:02:00.000Z') },
      { kind: 'queued', text: 'see\nthis', at: Date.parse('2026-10-15T14:03:00.000Z') },
    ],
  );
  assert.equal(steps.length, 3);
});
