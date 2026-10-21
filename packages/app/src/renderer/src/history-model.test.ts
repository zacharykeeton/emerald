import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSession,
  countPrompts,
  encodeProjectDir,
  focusedProject,
  groupByProject,
  indexHistory,
  isBareCommand,
  matches,
  nameOf,
  parseHistoryLine,
  parseTranscriptHead,
  parseTranscriptTail,
  promptsText,
  remoteIdsIn,
  restoreOpenedFolds,
  samePath,
  sameTranscriptCost,
  sortNewest,
  transcriptsOf,
} from './history-model.ts';
import type { HistorySession } from '../../preload/api.ts';

const T0 = Date.parse('2026-09-11T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

// The shapes Claude Code writes, cut down to the fields the model reads.
const user = (text: string, at: number, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', message: { role: 'user', content: text }, cwd: 'C:\\code\\emerald', gitBranch: 'main', sessionId: 'abc', timestamp: iso(at), ...extra });
const assistant = (content: unknown[], at: number, model = 'claude-opus-5') =>
  line({ type: 'assistant', message: { role: 'assistant', model, content }, cwd: 'C:\\code\\emerald', sessionId: 'abc', timestamp: iso(at) });

test('encodeProjectDir turns every character that is not a letter or digit into a dash', () => {
  assert.equal(encodeProjectDir('C:\\Users\\Zed\\code\\emerald'), 'C--Users-Zed-code-emerald');
  assert.equal(encodeProjectDir('C:\\Users\\Zed\\Downloads\\kit-2026-05-27 (1)\\one_on_one_kit'), 'C--Users-Zed-Downloads-kit-2026-05-27--1--one-on-one-kit');
});

test('parseHistoryLine reads a prompt line and rejects anything else', () => {
  assert.deepEqual(parseHistoryLine('{"display":"fix the tests","pastedContents":{},"timestamp":1000,"project":"C:\\\\code","sessionId":"abc"}'), {
    sessionId: 'abc',
    display: 'fix the tests',
    timestamp: 1000,
    project: 'C:\\code',
  });
  assert.equal(parseHistoryLine('{"display":"cut off","time'), null);
  assert.equal(parseHistoryLine(''), null);
  assert.equal(parseHistoryLine('{"display":"no id","timestamp":1,"project":"x"}'), null);
});

test('indexHistory groups prompts by session with the first prompt, the count and the latest project', () => {
  const text = [
    { display: 'first', timestamp: T0, project: 'C:\\a', sessionId: 's1' },
    { display: 'second', timestamp: T0 + 1000, project: 'C:\\a\\sub', sessionId: 's1' },
    { display: 'other', timestamp: T0 + 500, project: 'C:\\b', sessionId: 's2' },
  ]
    .map(line)
    .join('');
  const index = indexHistory(text);
  assert.deepEqual(index.get('s1'), { prompts: 2, firstPrompt: 'first', firstAt: T0, lastAt: T0 + 1000, project: 'C:\\a\\sub', firstAsk: 'first', firstAskAt: T0 });
  assert.deepEqual(index.get('s2'), { prompts: 1, firstPrompt: 'other', firstAt: T0 + 500, lastAt: T0 + 500, project: 'C:\\b', firstAsk: 'other', firstAskAt: T0 + 500 });
});

test('parseTranscriptHead takes the ai-title, the cwd, the branch, the first real prompt and the start time', () => {
  const text =
    line({ type: 'ai-title', aiTitle: 'Emerald M19 history', sessionId: 'abc' }) +
    line({ type: 'mode', mode: 'normal' }) +
    user('<local-command-caveat>Caveat: the messages below</local-command-caveat>', T0, { isMeta: true }) +
    user('<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>', T0 + 100) +
    user('<local-command-stdout>(no content)</local-command-stdout>', T0 + 200) +
    user('Read docs/PLAN.md first.\nThen build it.', T0 + 300) +
    assistant([{ type: 'text', text: 'On it.' }], T0 + 400);
  const head = parseTranscriptHead(text, true);
  assert.deepEqual(head, { title: 'Emerald M19 history', cwd: 'C:\\code\\emerald', branch: 'main', name: null, firstAsk: 'Read docs/PLAN.md first.', firstPrompt: '/clear', startedAt: T0, remoteIds: [] });
});

test('parseTranscriptHead without a title or a slash command uses the first typed prompt, and drops a cut last line', () => {
  const whole = user('hello there\nsecond line', T0) + assistant([{ type: 'text', text: 'hi' }], T0 + 1);
  const cut = whole.slice(0, -10);
  const head = parseTranscriptHead(cut);
  assert.equal(head.title, null);
  assert.equal(head.firstPrompt, 'hello there');
  assert.equal(head.startedAt, T0);
});

test('parseTranscriptHead reads a prompt that came with an image as its text block', () => {
  const text = line({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image', source: {} }] },
    cwd: 'C:\\x',
    groupCwd: 'C:\\x',
    timestamp: iso(T0),
  });
  assert.equal(parseTranscriptHead(text, true).firstPrompt, 'what is this');
});

test('parseTranscriptTail finds the model, the last time and the last message, prompt or reply', () => {
  const replyLast =
    user('do it', T0) +
    assistant([{ type: 'tool_use', name: 'Bash' }], T0 + 1000) +
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] }, cwd: 'C:\\x', timestamp: iso(T0 + 2000) }) +
    assistant([{ type: 'text', text: 'Done.\nTwo files changed.' }], T0 + 3000, 'claude-fable-5-1') +
    line({ type: 'system', timestamp: iso(T0 + 4000) });
  assert.deepEqual(parseTranscriptTail(replyLast, true), { name: null, model: 'claude-fable-5-1', lastAt: T0 + 4000, preview: { who: 'agent', text: 'Done.' }, remoteIds: [] });
  const promptLast = assistant([{ type: 'text', text: 'Done.' }], T0) + user('now the tests', T0 + 1000);
  assert.deepEqual(parseTranscriptTail(promptLast, true).preview, { who: 'you', text: 'now the tests' });
});

test('parseTranscriptTail drops the cut first line of a chunk', () => {
  const whole = assistant([{ type: 'text', text: 'first' }], T0) + assistant([{ type: 'text', text: 'second' }], T0 + 1);
  const tail = parseTranscriptTail(whole.slice(20));
  assert.equal(tail.preview?.text, 'second');
});

test('countPrompts counts typed prompts only', () => {
  const text =
    user('one', T0) +
    user('meta', T0, { isMeta: true }) +
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] }, timestamp: iso(T0) }) +
    assistant([{ type: 'text', text: 'r' }], T0) +
    user('two', T0);
  assert.equal(countPrompts(text, true), 2);
});

// M9 fix 920: a compaction's summary is Claude Code's, never a prompt.
const compactSummary = (at: number) => user('This session is being continued from a previous conversation that ran out of context.', at, { isCompactSummary: true, isVisibleInTranscriptOnly: true });
const compactBoundary = (at: number) => line({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 1000 }, timestamp: iso(at) });

test('parseTranscriptHead, parseTranscriptTail and countPrompts skip a compaction\'s summary (M9 fix 920)', () => {
  assert.equal(parseTranscriptHead(compactBoundary(T0) + compactSummary(T0) + user('real one', T0 + 1000), true).firstPrompt, 'real one');
  const tail = parseTranscriptTail(user('do it', T0) + assistant([{ type: 'text', text: 'Done.' }], T0 + 1000) + compactBoundary(T0 + 2000) + compactSummary(T0 + 3000), true);
  assert.deepEqual(tail.preview, { who: 'agent', text: 'Done.' });
  assert.equal(countPrompts(user('one', T0) + compactSummary(T0 + 1000), true), 1);
});

test('countPrompts counts a typed /compact once (M9 fix 956)', () => {
  const p = { promptId: 'p956' };
  const text =
    user('hello', T0) +
    user('/compact', T0 + 1000, p) +
    compactBoundary(T0 + 1500) +
    compactSummary(T0 + 1600) +
    user('<local-command-caveat>Caveat: the messages below</local-command-caveat>', T0 + 1005, { isMeta: true, ...p }) +
    user('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args></command-args>', T0 + 1005, p) +
    user('<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>', T0 + 1900, p);
  assert.equal(countPrompts(text, true), 3 - 1);
});

test('buildSession prefers the history index for counts and times and the transcript for the rest', () => {
  const head = { title: 'A title', name: null, firstAsk: null, cwd: 'C:\\code\\emerald', branch: 'main', firstPrompt: 'from transcript', startedAt: T0 + 5, remoteIds: ['session_a'] };
  const tail = { name: null, model: 'claude-opus-5', lastAt: T0 + 100, preview: { who: 'agent' as const, text: 'Done.' }, remoteIds: ['session_c', 'session_a'] };
  const s = buildSession('abc', 'C:\\claude\\projects\\x\\abc.jsonl', { prompts: 7, firstPrompt: 'from index', firstAt: T0, lastAt: T0 + 900, project: 'C:\\code', firstAsk: null, firstAskAt: null }, head, tail, 3);
  assert.equal(s!.title, 'A title');
  assert.equal(s!.prompts, 7);
  assert.equal(s!.startedAt, T0);
  assert.equal(s!.lastAt, T0 + 900);
  assert.equal(s!.cwd, 'C:\\code\\emerald');
  assert.equal(s!.model, 'claude-opus-5');
  // The remote ids in order, head, sweep, tail, each once (M70).
  assert.deepEqual(buildSession('abc', 'p', undefined, head, tail, 3, ['session_b', 'session_a'])!.remoteIds, ['session_a', 'session_b', 'session_c']);
  // No index: the transcript's own count and times, the first prompt as
  // the title, and the first prompt as the preview when the tail had none.
  const bare = buildSession('abc', 'p', undefined, { ...head, title: null }, { name: null, model: null, lastAt: T0 + 50, preview: null, remoteIds: [] }, 3);
  assert.equal(bare!.title, 'from transcript');
  assert.equal(bare!.prompts, 3);
  assert.equal(bare!.startedAt, T0 + 5);
  assert.equal(bare!.lastAt, T0 + 50);
  assert.deepEqual(bare!.preview, { who: 'you', text: 'from transcript' });
  // No cwd anywhere: not a session the panel can show.
  assert.equal(buildSession('abc', 'p', undefined, { ...head, cwd: null }, tail, null), null);
});

function session(id: string, cwd: string, project: string, lastAt: number, extra: Partial<HistorySession> = {}): HistorySession {
  return { id, title: id, cwd, project, cwdExists: true, branch: null, model: null, prompts: 1, startedAt: lastAt, lastAt, preview: null, path: id, remoteIds: [], ...extra };
}

test('remoteIdsIn reads every remote_session_change attachment once, in order, and parses nothing else (M70)', () => {
  const change = (id: string) => line({ type: 'attachment', attachment: { type: 'remote_session_change', url: `https://claude.ai/code/${id}`, commit: 'Claude-Session: x' }, timestamp: iso(T0) });
  const text = change('session_first') + user('hello', T0) + '{not json remote_session_change\n' + change('session_second') + change('session_first') + line({ type: 'attachment', attachment: { type: 'other', url: 'https://claude.ai/code/session_no' } });
  assert.deepEqual(remoteIdsIn(text, true), ['session_first', 'session_second']);
  // A head chunk drops its torn last line; a tail chunk its first.
  assert.deepEqual(remoteIdsIn(text.slice(0, -5), false, 'head'), ['session_first', 'session_second']);
  assert.deepEqual(parseTranscriptHead(text, true).remoteIds, ['session_first', 'session_second']);
  assert.deepEqual(parseTranscriptTail(text, true).remoteIds, ['session_first', 'session_second']);
});

test('transcriptsOf keeps the transcripts that name a remote id, whole, with the facts a history lane needs (M70)', () => {
  const list = [session('a', 'C:/x', 'C:/x', T0, { remoteIds: ['session_1', 'session_2'], title: 'First' }), session('b', 'C:/y', 'C:/y', T0 + 1), session('c', 'C:/z', 'C:/z', T0 + 2, { remoteIds: ['session_3'], cwdExists: false })];
  assert.deepEqual(transcriptsOf(list), [
    { id: 'a', title: 'First', cwd: 'C:/x', cwdExists: true, path: 'a', startedAt: T0, lastAt: T0, remoteIds: ['session_1', 'session_2'] },
    { id: 'c', title: 'c', cwd: 'C:/z', cwdExists: false, path: 'c', startedAt: T0 + 2, lastAt: T0 + 2, remoteIds: ['session_3'] },
  ]);
});

test('samePath ignores case and the kind of slash', () => {
  assert.ok(samePath('C:\\Code\\Emerald', 'c:/code/emerald/'));
  assert.ok(!samePath('C:\\code\\emerald', 'C:\\code\\emerald2'));
});

test('matches needs every word somewhere in the title, preview, folder, branch or model', () => {
  const s = session('a', 'C:\\code\\emerald', 'C:\\code\\emerald', 1, { title: 'Fix the tabs', branch: 'm11', preview: { who: 'agent', text: 'Two files changed' }, model: 'claude-opus-5' });
  assert.ok(matches(s, ''));
  assert.ok(matches(s, 'tabs'));
  assert.ok(matches(s, 'TABS emerald'));
  assert.ok(matches(s, 'm11 files'));
  assert.ok(matches(s, 'opus'));
  assert.ok(!matches(s, 'tabs missing'));
});

test('sortNewest and groupByProject keep the newest first, groups in order of their newest row', () => {
  const rows = sortNewest([session('old', 'C:\\a', 'C:\\a', 1), session('new', 'C:\\b', 'C:\\b', 3), session('mid', 'C:\\a\\x', 'C:\\a', 2)]);
  assert.deepEqual(
    rows.map((s) => s.id),
    ['new', 'mid', 'old'],
  );
  const groups = groupByProject(rows);
  assert.deepEqual(
    groups.map((g) => [g.project, g.sessions.map((s) => s.id)]),
    [
      ['C:\\b', ['new']],
      ['C:\\a', ['mid', 'old']],
    ],
  );
});

test('focusedProject finds the group by the conversation id first, then by the folder as a whole-segment prefix', () => {
  const groups = groupByProject([session('a1', 'C:\\code\\emerald', 'C:\\code\\emerald', 3), session('b1', 'C:\\code\\other', 'C:\\code\\other', 2), session('c1', 'C:\\code', 'C:\\code', 1)]);
  const focused = (cwd: string, claudeSessionId: string | null = null, conversation: { id: string } | null = null) => ({ claudeSessionId, conversation, cwd });
  assert.equal(focusedProject(groups, null), null);
  // The bound id wins over the folder, and a conversation last hosted counts the same.
  assert.equal(focusedProject(groups, focused('C:\\code\\emerald', 'b1')), 'C:\\code\\other');
  assert.equal(focusedProject(groups, focused('C:\\elsewhere', null, { id: 'a1' })), 'C:\\code\\emerald');
  // A shell in a subfolder of the repository, the deepest project wins over its parent.
  assert.equal(focusedProject(groups, focused('c:/code/emerald/packages/app')), 'C:\\code\\emerald');
  assert.equal(focusedProject(groups, focused('C:\\code\\emerald2')), 'C:\\code');
  assert.equal(focusedProject(groups, focused('D:\\nowhere')), null);
});

test('restoreOpenedFolds takes the stored opened groups back out of the collapse when for matches the focused session (M9 fix 439)', () => {
  const collapsed = new Set(['other', 'gone']);
  // for matching: the stored opens come back out.
  assert.deepEqual([...restoreOpenedFolds(collapsed, 'sess-1', { for: 'sess-1', opened: ['other'] })], ['gone']);
  // for not matching (a focus change since, or a save under no focus): the fresh fold stands.
  assert.deepEqual([...restoreOpenedFolds(collapsed, 'sess-1', { for: 'sess-2', opened: ['other'] })], ['other', 'gone']);
  assert.deepEqual([...restoreOpenedFolds(collapsed, null, { for: 'sess-1', opened: ['other'] })], ['other', 'gone']);
  // No stored record at all: the fresh fold stands.
  assert.deepEqual([...restoreOpenedFolds(collapsed, 'sess-1', null)], ['other', 'gone']);
  // An opened group the fresh fold does not hold collapsed (gone from the
  // scan, or already open) is simply not there to remove.
  assert.deepEqual([...restoreOpenedFolds(collapsed, 'sess-1', { for: 'sess-1', opened: ['long-gone'] })], ['other', 'gone']);
});

test('promptsText: one per turn, singular for one (M9 fix 97)', () => {
  const turn = { prompt: 'x', at: null, endAt: null, reply: null, toolCalls: 0, filesEdited: [], filesRead: [], commits: 0, bash: false };
  assert.equal(promptsText([]), '0 prompts');
  assert.equal(promptsText([turn]), '1 prompt');
  assert.equal(promptsText([turn, turn, turn]), '3 prompts');
  // M9 fix 955: a bash run is a turn but not a prompt.
  assert.equal(promptsText([turn, { ...turn, bash: true }]), '1 prompt');
});

// M9 fix 354: the cost store publishes nothing for a re-ask answered
// from the main process's cache, read field by field.
test('sameTranscriptCost: equal prices, a changed part, and the first answer', () => {
  const cost = { usd: 1.5, tokens: { up: 100, down: 20, cached: 80 }, agents: { count: 2, usd: 0.4, skipped: 0 } };
  assert.equal(sameTranscriptCost(undefined, cost), false);
  assert.equal(sameTranscriptCost(null, null), true);
  assert.equal(sameTranscriptCost(cost, null), false);
  assert.equal(sameTranscriptCost(cost, { ...cost, tokens: { ...cost.tokens }, agents: { ...cost.agents } }), true);
  assert.equal(sameTranscriptCost(cost, { ...cost, usd: 1.6 }), false);
  assert.equal(sameTranscriptCost(cost, { ...cost, agents: { ...cost.agents, skipped: 1 } }), false);
});

// M9 fix 954.
test('isBareCommand: a slash command with nothing after it, or a setting command with its argument, is not an ask', () => {
  for (const t of ['/model', '/model opus[1m]', ' /effort medium ', '/rename Install the routine from ATK', '/clear', '/compact']) assert.equal(isBareCommand(t), true, t);
  for (const t of ['/backlog file this', '/c/Users/x/notes.md read this', 'fix the tabs']) assert.equal(isBareCommand(t), false, t);
});

test('parseTranscriptTail and parseTranscriptHead read the last /rename, skipping an empty one (M9 fix 954)', () => {
  const titles = line({ type: 'custom-title', customTitle: 'First name', sessionId: 'abc' }) + line({ type: 'custom-title', customTitle: ' Second name ', sessionId: 'abc' }) + line({ type: 'custom-title', customTitle: '  ', sessionId: 'abc' });
  assert.equal(parseTranscriptTail(titles, true).name, 'Second name');
  assert.equal(parseTranscriptHead(titles, true).name, 'Second name');
});

test('parseTranscriptHead: a /model opening is the first prompt, the real ask after it is the first ask (M9 fix 954)', () => {
  const text =
    user('<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus[1m]</command-args>', T0) +
    user('<local-command-stdout>Set model to Opus</local-command-stdout>', T0 + 100) +
    user('<local-command-caveat>Caveat: the messages below</local-command-caveat>', T0 + 100, { isMeta: true }) +
    user('let us plan a batch', T0 + 200);
  const head = parseTranscriptHead(text, true);
  assert.equal(head.firstPrompt, '/model opus[1m]');
  assert.equal(head.firstAsk, 'let us plan a batch');
});

test('indexHistory: a session opening on /model has the next display as its first ask (M9 fix 954)', () => {
  const text = [
    { display: '/model opus', timestamp: T0, project: 'C:\\a', sessionId: 's1' },
    { display: 'fix it', timestamp: T0 + 10, project: 'C:\\a', sessionId: 's1' },
  ]
    .map(line)
    .join('');
  const have = indexHistory(text).get('s1')!;
  assert.equal(have.firstPrompt, '/model opus');
  assert.equal(have.firstAsk, 'fix it');
  assert.equal(have.firstAskAt, T0 + 10);
});

test('buildSession titles a row by the /rename, then the ai-title, then the first ask, then the first prompt (M9 fix 954)', () => {
  const head = { title: 'Claude title', name: null as string | null, firstAsk: null as string | null, cwd: 'C:\\code', branch: null, firstPrompt: '/model opus', startedAt: T0, remoteIds: [] };
  const tail = { name: null as string | null, model: null, lastAt: T0, preview: null, remoteIds: [] };
  const idx = (firstAsk: string | null) => ({ prompts: 2, firstPrompt: '/model opus', firstAt: T0, lastAt: T0, project: 'C:\\code', firstAsk, firstAskAt: firstAsk === null ? null : T0 });
  assert.equal(nameOf(head, { ...tail, name: 'Tail name' }), 'Tail name');
  assert.equal(buildSession('a', 'p', undefined, { ...head, name: 'Head name' }, { ...tail, name: 'Tail name' }, 1)!.title, 'Tail name');
  assert.equal(buildSession('a', 'p', undefined, { ...head, name: 'Head name' }, tail, 1)!.title, 'Head name');
  assert.equal(buildSession('a', 'p', idx('fix it'), head, tail, 1)!.title, 'Claude title');
  assert.equal(buildSession('a', 'p', idx('fix it'), { ...head, title: null }, tail, 1)!.title, 'fix it');
  assert.equal(buildSession('a', 'p', undefined, { ...head, title: null }, tail, 1)!.title, '/model opus');
  assert.equal(buildSession('a', 'p', undefined, { ...head, title: null, firstPrompt: null }, tail, 1)!.title, '(no prompt yet)');
});
