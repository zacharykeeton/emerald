import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, SessionKind, SessionState } from './session.ts';
import { COMPACT_BUFFER_TOKENS, IDLE_COMPACT_AFTER_MS, IDLE_COMPACT_MIN_TOKENS, NEEDS_INPUT_WORD, activityText, idleClock, idleClockTitle, commandText, compactPercent, contextPercentText, contextText, contextTitle, contextWords, describeState, elapsedText, formatTokens, hasState, modelEffortWords, shellCommand, needsInputWords, quietText, resumeTitle, shortModel, stateMarker, titleGlyph, titleText, costText, tokensDetail, tokensFigures, tokensLines, tokensParts, tokensRowText, tokensText, waitingDetail, waitingOnText, workingMotion } from './session-label.ts';

const ALL_STATES: SessionState[] = ['starting', 'idle', 'working', 'needs-input', 'done', 'errored', 'exited'];

function session(kind: SessionKind, state: SessionState, claudeSessionId: string | null = null): SessionInfo {
  return {
    id: 'a1',
    kind,
    name: 'a1',
    spawnCwd: 'C:\\work',
    args: [],
    autoName: true,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    cwd: 'C:\\work',
    groupCwd: 'C:\\work',
    state,
    stateSince: 1000,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    conversation: null,
    shellCwd: null,
    commits: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    title: null,
    claudeSessionId,
    pid: 1,
    exitCode: null,
    createdAt: 1000,
  };
}

test('hasState: a Claude session always has one, whatever the state', () => {
  for (const state of ALL_STATES) assert.equal(hasState(session('claude', state)), true, state);
});

test('hasState: a shell that has heard no hook shows none until it exits', () => {
  for (const state of ALL_STATES) {
    assert.equal(hasState(session('shell', state)), state === 'exited', state);
  }
});

test('hasState: a shell running Claude (a bound session id) shows its state', () => {
  for (const state of ALL_STATES) assert.equal(hasState(session('shell', state, 'sim-1')), true, state);
});

test('hasState: a hook event with no SessionStart still counts as having heard one', () => {
  assert.equal(hasState({ ...session('shell', 'working'), lastEventAt: 5000 }), true);
});

test('titleGlyph and titleText split the Claude title at its glyph and take a shell title whole', () => {
  assert.equal(titleGlyph('◐ Git log hash'), '◐');
  assert.equal(titleText('◐ Git log hash'), 'Git log hash');
  assert.equal(titleGlyph('✳ Claude Code'), '✳');
  assert.equal(titleText('✳   Claude Code '), 'Claude Code');
  assert.equal(titleGlyph('Administrator: Windows PowerShell'), null);
  assert.equal(titleText('Administrator: Windows PowerShell'), 'Administrator: Windows PowerShell');
  assert.equal(titleGlyph('C:\\Users\\me'), null, 'a path has no glyph');
  assert.equal(titleGlyph('~ - bash'), null, 'an ASCII sign is not a glyph');
  assert.equal(titleText('◑ '), null, 'a glyph alone leaves nothing');
  assert.equal(titleGlyph(null), null);
  assert.equal(titleText(null), null);
});

test('activityText is the stripped title while working and nothing otherwise', () => {
  assert.equal(activityText({ state: 'working', title: '◐ Git log hash', name: 'repo' }), 'Git log hash');
  assert.equal(activityText({ state: 'working', title: null, name: 'repo' }), null, 'no title keeps the last turn');
  assert.equal(activityText({ state: 'done', title: '✳ Git log hash', name: 'repo' }), null, 'the last turn is back once the turn ends');
  // An automatic name follows the title (M9 fix 34), so the line would
  // repeat the name; the last turn is the better use of it.
  assert.equal(activityText({ state: 'working', title: '◐ Git log hash', name: 'Git log hash' }), null, 'the title is the name already');
});

test('a stale working session reads as quiet with its silence, the detail naming the threshold it tripped (M9 fix 232)', () => {
  const now = 1_000_000_000;
  const quiet = { ...session('claude', 'working', 'bound'), stale: true, stateSince: now - 900_000, lastEventAt: now - 720_000 };
  const onFloor = describeState({ ...quiet, staleThresholdMs: 600_000 }, now);
  assert.equal(onFloor.text, 'quiet 12m', 'the word and the silence since the last hook, not since the state');
  assert.equal(onFloor.tone, 'stale');
  assert.match(onFloor.detail ?? '', /^No hook event for 12m, past the 10m floor\./);
  assert.match(onFloor.detail ?? '', /read its screen, then nudge it or kill it/);
  const relative = describeState({ ...quiet, staleThresholdMs: 660_000 }, now);
  assert.match(relative.detail ?? '', /past this turn's threshold of 11m, three times its median tool gap/);
  // An older daemon sends no threshold: the floor is named.
  const older = describeState({ ...quiet, staleThresholdMs: undefined } as SessionInfo, now);
  assert.equal(older.text, 'quiet 12m');
  assert.match(older.detail ?? '', /past the 10m floor/);
  // No hook at all yet: measured from when work started, as the flag is.
  assert.equal(describeState({ ...quiet, lastEventAt: null, staleThresholdMs: 600_000 }, now).text, 'quiet 15m');
  assert.equal(quietText(quiet, now), 'quiet 12m');
  // A member's later hook is the clock the flag read (M9 fix 507).
  assert.equal(quietText({ ...quiet, teamEventAt: now - 11 * 60_000 }, now), 'quiet 11m');
  assert.equal(quietText({ ...quiet, teamEventAt: now - 20 * 60_000 }, now), 'quiet 12m');
});

test('workingMotion is a pulse while working whatever the title says (fix 59), and nothing when stale or not working', () => {
  assert.equal(workingMotion({ state: 'working', stale: false, title: '◐ Git log hash' }), 'pulse', 'the title glyph no longer takes the place of the meter');
  assert.equal(workingMotion({ state: 'working', stale: false, title: null }), 'pulse');
  assert.equal(workingMotion({ state: 'working', stale: false, title: 'Windows PowerShell' }), 'pulse');
  assert.equal(workingMotion({ state: 'working', stale: true, title: '◐ Git log hash' }), null, 'stale stops it');
  assert.equal(workingMotion({ state: 'idle', stale: false, title: '✳ Claude Code' }), null);
});

test('stateMarker gives one glyph per state in its tone, and the dot while working', () => {
  assert.deepEqual(stateMarker({ state: 'working', stale: false, title: '◐ Git log hash' }), { glyph: null, tone: 'working' }, 'the dot even when the title has a glyph (fix 59)');
  assert.deepEqual(stateMarker({ state: 'working', stale: false, title: null }), { glyph: null, tone: 'working' }, 'the dot without');
  assert.deepEqual(stateMarker({ state: 'working', stale: true, title: '◐ Git log hash' }), { glyph: null, tone: 'stale' }, 'stale is the dot in the stale tone, and no glyph to move');
  assert.deepEqual(stateMarker({ state: 'needs-input', stale: false, title: null }), { glyph: '?', tone: 'needs-input' });
  assert.deepEqual(stateMarker({ state: 'done', stale: false, title: null }), { glyph: '✓', tone: 'done' });
  assert.deepEqual(stateMarker({ state: 'idle', stale: false, title: null }), { glyph: '·', tone: 'idle' });
  assert.deepEqual(stateMarker({ state: 'waiting', stale: false, title: null }), { glyph: '⋯', tone: 'waiting' });
  assert.deepEqual(stateMarker({ state: 'starting', stale: false, title: null }), { glyph: '◦', tone: 'starting' });
  assert.deepEqual(stateMarker({ state: 'errored', stale: false, title: null }), { glyph: '!', tone: 'errored' });
  assert.deepEqual(stateMarker({ state: 'exited', stale: false, title: null }), { glyph: '×', tone: 'exited' });
});

test('shortModel drops a trailing parenthetical and contextText shows the short form', () => {
  assert.equal(shortModel('Opus 5 (1M context)'), 'Opus 5');
  assert.equal(shortModel('Fable'), 'Fable');
  assert.equal(shortModel('Sonnet 5 (fast) '), 'Sonnet 5');
  assert.equal(shortModel('(unnamed)'), '(unnamed)', 'a name that is only a parenthetical stays whole');
  assert.equal(shortModel('Opus (1M) preview'), 'Opus (1M) preview', 'only a trailing parenthetical goes');
  const s = { ...session('claude', 'idle', 'bound'), model: 'Opus 5 (1M context)', contextPercent: 5 };
  assert.equal(contextText(s), 'Opus 5 · 5%');
  assert.equal(contextTitle(s), 'Model: Opus 5 (1M context)\nContext window 5% full', 'the tooltip keeps the full name');
});

test('M9 fix 66: contextWords and contextPercentText are the two halves the dial sits between', () => {
  const s = { ...session('claude', 'idle', 'bound'), model: 'Opus 5 (1M context)', contextPercent: 19 };
  assert.equal(contextWords(s), 'Opus 5');
  assert.equal(contextPercentText(s), '19%');
  assert.equal(contextText(s), 'Opus 5 · 19%', 'contextText is the join');
  assert.equal(contextWords({ ...s, model: null }), null);
  assert.equal(contextPercentText({ ...s, model: null }), '19%');
  assert.equal(contextText({ ...s, model: null }), '19%', 'the percent alone without a model');
  assert.equal(contextPercentText({ ...s, contextPercent: null }), null);
  assert.equal(contextText({ ...s, contextPercent: null }), 'Opus 5', 'the words alone without a percent');
  assert.equal(contextText({ ...s, model: null, contextPercent: null }), null);
});

test('modelEffortWords puts the effort after the model and contextText joins it (M9 fix 800)', () => {
  const s = { ...session('claude', 'idle', 'bound'), model: 'Opus 5.5 (1M context)', effort: 'high', contextPercent: 19 };
  assert.equal(modelEffortWords(s), 'Opus 5.5 · high');
  assert.equal(contextText(s), 'Opus 5.5 · high · 19%');
  assert.equal(contextWords(s), 'Opus 5.5', 'the chat chip and the card keep the model alone');
  assert.equal(modelEffortWords({ ...s, effort: null }), 'Opus 5.5');
  const { effort: _gone, ...older } = s;
  assert.equal(modelEffortWords(older), 'Opus 5.5', 'a record with no effort field');
  assert.equal(contextText({ ...s, effort: null }), 'Opus 5.5 · 19%');
  assert.equal(modelEffortWords({ ...s, model: null }), null, 'no model, no words');
  assert.equal(contextText({ ...s, model: null }), '19%');
  assert.equal(contextText({ ...s, contextPercent: null }), 'Opus 5.5 · high');
});

test('M9 fix 143: the tokens reading, short on the row, whole in the detail and the tooltip, nothing without a sum', () => {
  const t = { fresh: 4, cacheWrite: 18518, cacheRead: 1194849, output: 2640 };
  assert.equal(tokensText({ tokens: t }), '↑1.2M ↓2.6k');
  assert.equal(tokensText({ tokens: null }), null);
  assert.equal(tokensDetail(t), '1.2M sent (4 fresh, 18.5k written to the cache, 1.2M read from it), 2.6k received');
  const s = { ...session('claude', 'idle', 'bound'), model: 'Opus 5', contextPercent: 5, tokens: t };
  assert.ok(contextTitle(s).endsWith('\nSince the start: 1.2M sent (4 fresh, 18.5k written to the cache, 1.2M read from it), 2.6k received'));
  assert.ok(!contextTitle({ ...s, tokens: null }).includes('Since the start'));
});

test('M9 fix 154: the cached share on the row, the bare text on the title, the cost lines and the stack on the shade', () => {
  const t = { fresh: 4, cacheWrite: 18518, cacheRead: 1194849, output: 2640 };
  assert.deepEqual(tokensParts({ tokens: t }), { up: '1.2M', cached: '1.2M', down: '2.6k' });
  assert.equal(tokensRowText({ tokens: t }), '↑1.2M (1.2M cached) ↓2.6k');
  assert.equal(tokensText({ tokens: t }), '↑1.2M ↓2.6k', 'the title keeps the bare reading');
  assert.equal(tokensDetail(t), '1.2M sent (4 fresh, 18.5k written to the cache, 1.2M read from it), 2.6k received', 'unchanged');
  const none = { fresh: 900, cacheWrite: 0, cacheRead: 0, output: 50 };
  assert.equal(tokensParts({ tokens: none })?.cached, null);
  assert.equal(tokensRowText({ tokens: none }), '↑900 ↓50', 'no parenthetical when nothing was cached');
  assert.equal(tokensRowText({ tokens: null }), null);
  // Fix 209: the cost is Claude Code's own figure, the forked agents' requests in it, and says so; the uncached estimate no longer sits beside it.
  assert.equal(costText({ costUsd: 1.4029585 }), '$1.40 at API rates, subagents included');
  assert.equal(costText({ costUsd: 47.2 }), '$47.20 at API rates, subagents included', 'cents at every figure since M9 fix 395');
  assert.equal(costText({ costUsd: null }), null);
  assert.equal(costText({}), null, 'a record from before the field');
  // The shade's stack: the three counts with their words (fix 205), then the cost line once the record has a cost, four lines at most (fix 209).
  assert.deepEqual(tokensLines({ tokens: t, costUsd: null }), ['↑1.2M sent', '1.2M cached', '↓2.6k received']);
  assert.deepEqual(tokensLines({ tokens: t, costUsd: 1.4 }), ['↑1.2M sent', '1.2M cached', '↓2.6k received', '$1.40 at API rates, subagents included']);
  assert.deepEqual(tokensLines({ tokens: none, costUsd: 0.02 }), ['↑900 sent', '↓50 received', '$0.02 at API rates, subagents included'], 'no cached line');
  assert.deepEqual(tokensLines({ tokens: null, costUsd: 1 }), []);
  // The figures behind the lines: the cell kinds and parts the face sizes and colours by.
  assert.deepEqual(
    tokensFigures({ tokens: t, costUsd: 1.4 }).map((f) => [f.kind, f.part, f.figure, f.word]),
    [['sent', 'tokens', '↑1.2M', 'sent'], ['cached', 'tokens', '1.2M', 'cached'], ['received', 'tokens', '↓2.6k', 'received'], ['cost', 'cost', '$1.40', 'at API rates, subagents included']],
  );
});

test('M42: the compaction point, the token format and the tooltip lines', () => {
  assert.equal(COMPACT_BUFFER_TOKENS, 33000);
  assert.equal(compactPercent({ size: 1000000 }).toFixed(1), '96.7');
  assert.equal(compactPercent({ size: 200000 }).toFixed(1), '83.5');
  assert.equal(compactPercent({ size: 20000 }), 0, 'a window no bigger than the buffer compacts from the start');
  assert.equal(formatTokens(33000), '33k');
  assert.equal(formatTokens(31600), '31.6k');
  assert.equal(formatTokens(116045), '116k');
  assert.equal(formatTokens(844700), '844.7k');
  assert.equal(formatTokens(1000000), '1M');
  assert.equal(formatTokens(212), '212');
  const cw = { size: 1000000, used: 116045, cacheRead: 115744, cacheWrite: 299, fresh: 2, output: 212 };
  const s = { ...session('claude', 'idle', 'bound'), model: 'Opus 5 (1M context)', contextPercent: 12, contextWindow: cw };
  assert.equal(
    contextTitle(s),
    'Model: Opus 5 (1M context)\nContext window 12% full\n116k of 1M tokens; auto-compact at 96.7% (33k buffer)\nLast request: 115.7k read from the cache, 299 written to it, 2 fresh, 212 out',
  );
});

test('describeState says a needs-input reason in words, not its key (M9 fix 123)', () => {
  const asking = (reason: SessionInfo['needsInputReason']) => describeState({ ...session('claude', 'needs-input', 'bound'), needsInputReason: reason });
  assert.equal(asking('permission').text, 'needs input: permission');
  assert.equal(asking('agent-permission').text, "needs input: an agent's permission");
  assert.equal(asking('elicitation').text, 'needs input: a form');
  assert.equal(asking('question').text, 'needs input: a question');
  assert.equal(asking(null).text, 'needs input: unknown');
  assert.equal(needsInputWords('agent-permission'), "an agent's permission");
  assert.equal(NEEDS_INPUT_WORD, 'needs input', 'the badge alone at the squeeze is the text before the colon');
  assert.equal(asking('agent-permission').detail, 'A subagent is asking permission to use a tool; answer it in the pane and the agent carries on.');
  // M9 fix 808: a starting Claude at its folder's trust dialog.
  assert.equal(asking('trust').text, 'needs input: folder trust');
  assert.equal(asking('trust').detail, 'Claude Code asks whether to trust this folder before it starts.');
});

test('describeState says how many tasks a waiting session waits on, and which', () => {
  const bare = describeState(session('claude', 'waiting', 'bound'));
  assert.equal(bare.text, 'waiting', 'an older daemon sends no list');
  assert.ok(bare.detail!.startsWith('Claude ended its turn'));
  const one = describeState({ ...session('claude', 'waiting', 'bound'), waitingOn: [{ type: 'subagent', description: 'Verify the history panel', command: null }] });
  assert.equal(one.text, 'waiting (1)');
  assert.equal(one.detail, '1 subagent still running. Claude carries on when one finishes.\nVerify the history panel');
  assert.equal(one.tone, 'waiting');
  const several = waitingDetail([
    { type: 'shell', description: null, command: 'until grep -q EXIT log; do sleep 5; done' },
    { type: 'shell', description: 'Build the installer', command: 'npm run dist' },
    { type: 'subagent', description: null, command: null },
  ]);
  assert.equal(several, '2 shells and 1 subagent still running. Claude carries on when one finishes.\nuntil grep -q EXIT log; do sleep 5; done\nBuild the installer\nsubagent');
});

test('resumeTitle says where Resume goes and what it types (M48)', () => {
  assert.equal(resumeTitle({ name: 'repo', kind: 'claude', spawnCwd: 'C:\\repo', conversation: null }), 'Start repo again in C:\\repo');
  assert.equal(resumeTitle({ name: 'repo', kind: 'shell', spawnCwd: 'C:\\repo', conversation: null }), 'Start repo again in C:\\repo');
  assert.equal(resumeTitle({ name: 'repo', kind: 'claude', spawnCwd: 'C:\\repo', conversation: { id: 'abc', cwd: 'C:\\repo\\sub', args: [] } }), 'Pick repo up again in C:\\repo\\sub with claude --resume');
  assert.equal(resumeTitle({ name: 'repo', kind: 'shell', spawnCwd: 'C:\\repo', conversation: { id: 'abc', cwd: 'C:\\repo\\sub', args: [] } }), 'Start repo again in C:\\repo\\sub and type claude --resume there');
});

test('waitingOnText names what a needs-input session waits on, and nothing in any other state (M55)', () => {
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'permission', liveTool: 'Editing session.ts' }), 'Allow? Editing session.ts');
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'permission', liveTool: 'git commit -F msg.txt' }), 'Allow? git commit -F msg.txt');
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'permission', liveTool: null }), 'Allow? a tool call', 'a permission with no tool call seen');
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'question', liveTool: 'Editing session.ts' }), 'Question for you', 'a question is not about the tool');
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'elicitation', liveTool: null }), 'Waiting for your answer');
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: null, liveTool: null }), 'Waiting on you');
  assert.equal(waitingOnText({ state: 'working', needsInputReason: 'permission', liveTool: 'Editing session.ts' }), null, 'a stale reason outside needs-input says nothing');
  assert.equal(waitingOnText({ state: 'idle', needsInputReason: null, liveTool: null }), null);
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'trust', liveTool: null }), 'Trust this folder?', 'M9 fix 808');
});

test('a plain shell\'s command words (M9 fix 196): the badge at done and errored, the tooltip text at idle, and nothing on a bound shell', () => {
  const now = 10_000_000;
  const shell = (state: SessionState, command: SessionInfo['command']): SessionInfo => ({ ...session('shell', state), command });
  assert.equal(shellCommand(shell('idle', null)), null);
  assert.equal(shellCommand({ ...session('shell', 'idle', 'bound'), command: { state: 'running', exitCode: null, startedAt: now, endedAt: null } }), null, 'a bound shell has no command of its own');
  const done = shell('done', { state: 'ok', exitCode: 0, startedAt: now - 72_000 - 60_000, endedAt: now - 60_000 });
  assert.equal(hasState(done), true, 'a long command\'s end gives the shell a badge');
  assert.deepEqual(describeState(done, now), { text: 'done 1m 12s', detail: 'The command finished after 1m 12s and nobody has looked yet.', tone: 'done' });
  const failed = shell('errored', { state: 'failed', exitCode: 1, startedAt: now - 72_000, endedAt: now });
  assert.equal(describeState(failed, now).text, 'failed (1) after 1m 12s');
  assert.equal(describeState(failed, now).tone, 'errored');
  const idle = shell('idle', { state: 'failed', exitCode: 3, startedAt: now - 130_000, endedAt: now - 120_000 });
  assert.equal(hasState(idle), false, 'a short failure gives no badge');
  assert.equal(describeState(idle, now).text, 'failed (3) 2m ago');
  assert.equal(describeState(shell('idle', { state: 'running', exitCode: null, startedAt: now - 40_000, endedAt: null }), now).text, 'running 40s');
  assert.equal(describeState(shell('idle', { state: 'ok', exitCode: 0, startedAt: now - 5000, endedAt: now - 3000 }), now).text, 'idle', 'a passed command reads as idle');
  assert.equal(commandText({ state: 'ok', exitCode: 0, startedAt: now - 5000, endedAt: now - 3000 }, now), 'done 3s ago');
  assert.equal(elapsedText(12_000), '12s');
  assert.equal(elapsedText(72_000), '1m 12s');
  assert.equal(elapsedText(120_000), '2m');
  assert.equal(elapsedText(3_720_000), '1h 2m');
});

test("waitingOnText names the mod's ask ahead of the call's phrase, and an agent's ask when no member is found (M9 fix 742)", () => {
  const askedFor = { words: 'Bash: npm publish', toolUseId: 'u1', agentId: null, at: 0 };
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'permission', liveTool: 'Running npm', askedFor }), 'Allow? Bash: npm publish');
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'agent-permission', liveTool: null, team: [], askedFor }), "Allow? an agent's Bash: npm publish");
  assert.equal(waitingOnText({ state: 'needs-input', needsInputReason: 'permission', liveTool: 'Running npm', askedFor: null }), 'Allow? Running npm');
});

test('idleClock: compacts in, cache cold in and kept whole, by the TTL and the context\'s tokens, at idle, waiting and done only (M9 fix 772)', () => {
  assert.equal(IDLE_COMPACT_AFTER_MS, 54 * 60 * 1000);
  assert.equal(IDLE_COMPACT_MIN_TOKENS, 200000);
  const now = 1_792_000_000_000;
  const cw = (used: number) => ({ size: 1_000_000, used, cacheRead: 0, cacheWrite: 0, fresh: 0, output: 0 });
  const at = (overrides: Partial<SessionInfo> = {}, ttl: '5m' | '1h' = '1h', expiresAt = now + 3000_000, used = 250_000) => ({ ...session('claude', 'idle', 'c1'), contextWindow: cw(used), cache: { ttl, expiresAt, warm: true }, ...overrides });
  const compact = idleClock(at(), now);
  assert.deepEqual(compact, { kind: 'compact', at: now + 3000_000 - 360_000, words: 'compacts in 44m', rowWords: 'compacts in 44m' });
  assert.deepEqual(idleClock(at({}, '1h', now + 3000_000, 199_999), now), { kind: 'cold', at: now + 3000_000, words: 'cache cold in 50m', rowWords: 'cache cold in 50m' });
  assert.equal(idleClock(at({}, '1h', now + 3000_000, 200_000), now)?.kind, 'compact', 'the floor itself compacts');
  assert.deepEqual(idleClock(at({}, '5m', now + 240_000, 300_000), now), { kind: 'cold', at: now + 240_000, words: 'cache cold in 4m', rowWords: 'cache cold in 4m' });
  const late = now + 3000_000 - 120_000;
  assert.equal(idleClock(at(), late)?.words, 'cache cold in 2m', 'past the compaction time, before the expiry');
  assert.deepEqual(idleClock({ ...at(), keepWhole: true }, now), { kind: 'kept', at: now + 3000_000, words: 'kept whole · cache cold in 50m', rowWords: 'kept whole · 50m' });
  for (const state of ['waiting', 'done'] as const) assert.deepEqual(idleClock(at({ state }), now), compact, state);
  for (const state of ['working', 'needs-input', 'exited', 'starting'] as const) assert.equal(idleClock(at({ state }), now), null, state);
  assert.equal(idleClock(at({ claudeSessionId: null }), now), null, 'a shell whose Claude left');
  assert.equal(idleClock(at({ cache: { ttl: '1h', expiresAt: now + 3000_000, warm: false } }), now), null, 'a cold cache');
  assert.equal(idleClock(at({ cache: null }), now), null);
  assert.equal(idleClock({ ...at(), cache: undefined }, now), null, 'an older daemon');
  assert.equal(idleClock(at({}, '1h', now), now), null, 'expiresAt is now');
  assert.equal(idleClock(at({}, '1h', now + 30_000, 1000), now)?.words, 'cache cold in 1m');
  assert.ok(idleClockTitle(compact!, '9:41 PM').includes('"idleCompaction": false'));
  assert.ok(idleClockTitle(compact!, '9:41 PM').includes('9:41 PM'));
});
