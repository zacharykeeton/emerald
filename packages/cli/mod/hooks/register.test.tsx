// The mod's own tests (M9 fix 725), run by `claude plugin test` against the
// engine. A .tsx on purpose: node's bare `node --test` in packages/cli (as
// tests.ps1 runs it) loads every *.test.ts under the package, where
// `claude-code/testing` does not resolve, and it does not match .tsx; the
// engine refuses a dynamic import of the kit, so no guard can live inside.
// stage.mjs copies the mod by name, so this never ships.
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

const VARS = { EMERALD_SESSION_ID: 'sess-725', EMERALD_HOOK_PORT: '7419', EMERALD_HOOK_TOKEN: 'tok' };

const ENGINE_SPINNER = 'the engine spinner';

type Posted ={ url: string; headers: Record<string, string>; body: string };

// M9 fix 1125: a poll of the mod's channel (a URL ending /channel) is
// answered with the next of polls, a batch of JSON lines, a status, or
// 'throw'; past the last it is answered 404, so every test's loop ends
// before the test does (channelOpen is the module's own state).
type PollAnswer = string[] | number | 'throw';

function recordFetches(on: On, fail = false, polls: PollAnswer[] = []): Posted[] {
  const posted: Posted[] = [];
  const left = [...polls];
  on('http.fetch', ($, e) => {
    posted.push({ url: e.url, headers: e.init?.headers ?? {}, body: e.init?.body ?? '' });
    if (e.url.endsWith('/channel')) {
      const next = left.shift();
      if (next === 'throw') throw new Error('connection refused');
      if (typeof next === 'number') return { value: { status: next, ok: false, headers: {}, text: '' } };
      if (next === undefined) return { value: { status: 404, ok: false, headers: {}, text: '' } };
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ lines: next.map((l) => JSON.parse(l)) }) } };
    }
    if (fail) throw new Error('connection refused');
    return { value: { status: 204, ok: true, headers: {}, text: '' } };
  });
  // The engine's own Stop, beneath the plugin: an empty result; and its
  // spinner drawing and turn end (M9 fix 738), so those hooks have a next.
  on('classic.Stop', () => ({}));
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{ENGINE_SPINNER}</Text>;
  });
  on('turn.complete', () => ({ text: '' }));
  on('session.id', () => ({ value: 'conv-738' }));
  on('session.model', () => ({ value: 'claude-opus-5-5' }));
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  return posted;
}

test('a Stop with the three variables set is posted once with the three headers', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  await $.classic.Stop({ stop_hook_active: false });
  expect(posted.length).toBe(1);
  expect(posted[0]!.url).toBe('http://127.0.0.1:7419/hook');
  expect(posted[0]!.headers['X-Emerald-Hook']).toBe('emerald-mod');
  expect(posted[0]!.headers['X-Emerald-Token']).toBe('tok');
  expect(posted[0]!.headers['X-Emerald-Session']).toBe('sess-725');
  expect(JSON.parse(posted[0]!.body).hook_event_name).toBe('Stop');
});

test('with EMERALD_SESSION_ID unset nothing is posted', async ($, on) => {
  mock.env(on, { EMERALD_HOOK_PORT: '7419', EMERALD_HOOK_TOKEN: 'tok' });
  const posted = recordFetches(on);
  await $.classic.Stop({ stop_hook_active: false });
  expect(posted.length).toBe(0);
});

test('a Bash call, which raises PreToolUse, posts nothing', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }));
  await $.tool.call({ tool: 'Bash', command: 'echo hi' });
  expect(posted.length).toBe(0);
});

// M9 fix 741: the prompt channel, a long poll on the hook sink since M9
// fix 1125. The test's http.fetch hook answers the first poll with one
// prompt line and the next 404, which ends the loop.
const polled = (posted: Posted[]) => posted.filter((p) => p.url.endsWith('/channel'));

function channel(on: On): { posted: Posted[]; submitted: { text: string; origin: unknown }[] } {
  const submitted: { text: string; origin: unknown }[] = [];
  const posted = recordFetches(on, false, [['{"text":"hi"}']]);
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('prompt.submit', ($, e) => {
    submitted.push({ text: e.text, origin: e.origin });
    return { text: e.text };
  });
  return { posted, submitted };
}

test('an interactive session.start polls the channel and a line it answers is submitted as the person (M9 fixes 741 and 1125)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const seen = channel(on);
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  const polls = polled(seen.posted);
  expect(polls.length).toBe(2);
  expect(polls[0]!.url).toBe('http://127.0.0.1:7419/channel');
  expect(polls[0]!.headers).toEqual({ 'Content-Type': 'application/json', 'X-Emerald-Token': 'tok', 'X-Emerald-Session': 'sess-725', 'X-Emerald-Hook': 'emerald-mod' });
  expect(polls[0]!.body).toBe('{}');
  expect(seen.submitted.length).toBe(1);
  expect(seen.submitted[0]!.text).toBe('hi');
  expect(seen.submitted[0]!.origin).toEqual(expect.objectContaining({ kind: 'plugin', asUser: true }));
});

test('a -p session.start polls no channel (M9 fix 741)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const seen = channel(on);
  await $.session.start({ cwd: 'C:\\w', surface: null, isInteractive: false });
  await clock.settle();
  expect(polled(seen.posted)).toEqual([]);
  expect(seen.submitted).toEqual([]);
});

test('a poll answered 409 asks no more (M9 fix 1125)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on, false, [409]);
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  expect(polled(posted).length).toBe(1);
});

// A hook that throws is skipped by the kit, which sends the call on past
// it to the network the test refuses, which throws to the mod. The kit's
// own clock sleeps the whole 2 s, so the test's clock.sleep hook answers
// each at once: five polls in a row that throw, four sleeps between them,
// and the sixth answer, a line, never asked for.
test('a poll that throws is asked again, five times in a row and then no more (M9 fix 1125)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on, false, ['throw', 'throw', 'throw', 'throw', 'throw', ['{"text":"never"}']]);
  const sleeps: number[] = [];
  on('clock.sleep', (_$, e) => {
    sleeps.push(e.ms);
    return { value: undefined };
  });
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  const submitted: string[] = [];
  on('prompt.submit', ($, e) => {
    submitted.push(e.text);
    return { text: e.text };
  });
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  for (let i = 0; i < 10; i++) await settle();
  expect(polled(posted).length).toBe(5);
  expect(sleeps).toEqual([2000, 2000, 2000, 2000]);
  expect(submitted).toEqual([]);
});

// M9 fix 781: the mod's word on each submit. The engine refuses a plugin's
// prompt while a person's Stop stands, answering a drop; the mod posts
// ModSubmit with the push's submitId so the daemon has the sender type it.
const STOP_STANDS = 'the session was stopped and nobody has sent input since';

// The lines are the first poll's batch, passed to the caller's own
// recordFetches (the kit refuses a second http.fetch hook).
function answeringChannel(on: On, answer: (text: string) => { text: string } | { drop: string }): string[] {
  const submitted: string[] = [];
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('prompt.submit', ($, e) => {
    submitted.push(e.text);
    return answer(e.text);
  });
  return submitted;
}

const words = (posted: Posted[]) => posted.map((p) => JSON.parse(p.body)).filter((b) => b.hook_event_name === 'ModSubmit');

test('a dropped submit posts ModSubmit not entered with the engine\'s reason, and the next submit still goes in (M9 fix 781)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on, false, [['{"text":"after the stop","submitId":"s1-1"}', '{"text":"and again","submitId":"s1-2"}']]);
  const submitted = answeringChannel(on, (text) => (text === 'after the stop' ? { drop: STOP_STANDS } : { text }));
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  expect(submitted).toEqual(['after the stop', 'and again']);
  // M9 fix 1125: both lines come in one poll, so the second meets the
  // first still out and says queued at once (fix 995); the final words are
  // what this test reads.
  expect(words(posted).filter((w) => w.queued !== true)).toEqual([
    expect.objectContaining({ submit_id: 's1-1', entered: false, drop: STOP_STANDS }),
    expect.objectContaining({ submit_id: 's1-2', entered: true }),
  ]);
});

// M9 fix 995: a line streamed while a main turn runs says at once that it
// waits for the turn's end; with no turn and nothing chained only the
// final word goes; a subagent's turn is not the row's.
test('a line streamed during a main turn posts queued before its final word (M9 fix 995)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on, false, [['{"text":"mid-turn","submitId":"s9-1"}']]);
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  answeringChannel(on, (text) => ({ text }));
  await $.turn.start({ text: 'a long turn', turnId: 't-995' });
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't-995', reason: 'answer' });
  await clock.settle();
  const said = words(posted);
  expect(said[0]).toEqual(expect.objectContaining({ submit_id: 's9-1', entered: true, queued: true }));
  expect(said[said.length - 1]).toEqual(expect.objectContaining({ submit_id: 's9-1', entered: true }));
  expect(said[said.length - 1].queued).toBe(undefined);
  expect(said.length).toBe(2);
});

test('a line streamed with no turn running, or during a subagent turn, posts only its final word (M9 fix 995)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on, false, [['{"text":"at rest","submitId":"s9-2"}']]);
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  answeringChannel(on, (text) => ({ text }));
  await $.turn.start({ text: 'a subagent', turnId: 't-agent', agentId: 'agent-1' });
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  expect(words(posted)).toEqual([expect.objectContaining({ submit_id: 's9-2', entered: true })]);
  expect(words(posted)[0].queued).toBe(undefined);
});

test('a submit with no submitId (an older daemon) posts no word (M9 fix 781)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on, false, [['{"text":"hi"}']]);
  const submitted = answeringChannel(on, () => ({ drop: STOP_STANDS }));
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  expect(submitted).toEqual(['hi']);
  expect(words(posted)).toEqual([]);
});

// M9 fix 742: the ask, posted at the decision. The test's tool.check hook
// beneath is core's decision. The kit's $.tool.call raises no tool.check,
// so a real call's check is raised as the engine raises it, with the
// call's tool_use_id.
function decide(on: On, decision: 'ask' | 'allow'): void {
  // session.id is answered by recordFetches, which every caller runs first;
  // the kit refuses a second hook on it.
  on('tool.check', () => ({ decision, ...(decision === 'ask' ? { rule: 'Bash(npm publish:*)' } : {}) }));
}

function realCheck($: Parameters<Parameters<typeof test>[1]>[0], command: string) {
  return $.tool.check({ tool: 'Bash', input: { command }, tool_use_id: 'toolu_742' } as never);
}

function asks(posted: Posted[]): Record<string, unknown>[] {
  return posted.map((p) => JSON.parse(p.body) as Record<string, unknown>).filter((b) => b.hook_event_name === 'ToolAsk');
}

test("a real call's ask is posted once as a ToolAsk with the tool and its input, and the decision stands (M9 fix 742)", async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on);
  decide(on, 'ask');
  const verdict = await realCheck($, 'npm publish');
  await clock.settle();
  const sent = asks(posted);
  expect(verdict.decision).toBe('ask');
  expect(sent.length).toBe(1);
  expect(sent[0]!.tool_name).toBe('Bash');
  expect((sent[0]!.tool_input as { command?: string }).command).toBe('npm publish');
  expect(sent[0]!.rule).toBe('Bash(npm publish:*)');
  expect(sent[0]!.tool_use_id).toBe('toolu_742');
  expect(posted[0]!.headers['X-Emerald-Hook']).toBe('emerald-mod');
});

test('an allow posts nothing (M9 fix 742)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on);
  decide(on, 'allow');
  await realCheck($, 'npm publish');
  await clock.settle();
  expect(asks(posted).length).toBe(0);
});

test("an input's long string arrives cut to 200 characters (M9 fix 742)", async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on);
  decide(on, 'ask');
  await realCheck($, 'x'.repeat(5000));
  await clock.settle();
  expect(((asks(posted)[0]!.tool_input as { command: string }).command).length).toBe(200);
});

test('a $.tool.check query, which carries no tool_use_id, posts nothing (M9 fix 742)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on);
  decide(on, 'ask');
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'ls' } });
  await clock.settle();
  expect(verdict.decision).toBe('ask');
  expect(asks(posted).length).toBe(0);
});

test('a fetch that rejects still lets the event through', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on, true);
  await $.classic.Stop({ stop_hook_active: false });
  expect(posted.length).toBe(1);
});

// M9 fix 738: the spinner word and a turn's end, as emerald's own events.
const SPINNER = { word: 'Perusing', message: null, suffix: '…', mode: 'responding' };

// The posts are started and not awaited, so a test lets them land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

function bodiesOf(posted: Posted[], name: string): Array<Record<string, unknown>> {
  return posted.map((p) => JSON.parse(p.body) as Record<string, unknown>).filter((b) => b.hook_event_name === name);
}

test('a Spinner drawn as Perusing twice then Grinding posts Perusing then Grinding (M9 fix 738)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  for (const word of ['Perusing', 'Perusing', 'Grinding']) {
    await $.ui.render({ surface: 'terminal', component: 'Spinner', props: { ...SPINNER, word } });
  }
  await settle();
  expect(bodiesOf(posted, 'Spinner').map((b) => b.word)).toEqual(['Perusing', 'Grinding']);
});

test('a ToolProgress drawn twice for u1 then once for u2 posts ToolRunning for u1 then u2 (M9 fix 775)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  for (const id of ['u1', 'u1', 'u2']) {
    await $.ui.render({ surface: 'terminal', component: 'ToolProgress', props: { tool_use_id: id, kind: 'background_hint', hint: '(ctrl+b to run in background)' } });
  }
  await settle();
  expect(bodiesOf(posted, 'ToolRunning').map((b) => b.tool_use_id)).toEqual(['u1', 'u2']);
  expect(bodiesOf(posted, 'Spinner').length).toBe(0);
});

test('an aborted main turn posts one TurnComplete with is_aborted (M9 fix 738)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  await $.turn.complete({ answer: '', durationMs: 900, isAborted: true, turnId: 't-1', reason: 'aborted' });
  await settle();
  const done = bodiesOf(posted, 'TurnComplete');
  expect(done.length).toBe(1);
  expect(done[0]!.is_aborted).toBe(true);
  expect(done[0]!.turn_id).toBe('t-1');
  expect(done[0]!.turn_agent_id).toBe(undefined);
});

test('with EMERALD_SESSION_ID unset a Spinner and a TurnComplete post nothing (M9 fix 738)', async ($, on) => {
  mock.env(on, { EMERALD_HOOK_PORT: '7419', EMERALD_HOOK_TOKEN: 'tok' });
  const posted = recordFetches(on);
  await $.ui.render({ surface: 'terminal', component: 'Spinner', props: { ...SPINNER, word: 'Unset' } });
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 't-2', reason: 'answer' });
  await settle();
  expect(posted.length).toBe(0);
});

test('a Spinner whose post rejects is still drawn (M9 fix 738)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on, true);
  const drawn = await $.ui.render({ surface: 'terminal', component: 'Spinner', props: { ...SPINNER, word: 'Rejected' } });
  await settle();
  expect(bodiesOf(posted, 'Spinner').length).toBe(1);
  expect(JSON.stringify(drawn)).toContain(ENGINE_SPINNER);
});

test('a measure posts one Measure with the context, the limits and the cost under one key (M9 fix 739)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  const rateLimits = [{ kind: 'five_hour' as const, percentUsed: 25, resetsAt: '2026-10-15T23:20:00.000Z' }];
  await $.session.measure({ context: { tokens: 64601, window: 1000000, percent: 6 }, rateLimits, cost: { usd: 0.25 }, changed: ['context', 'rateLimits', 'cost'] });
  await settle();
  const measured = bodiesOf(posted, 'Measure');
  expect(measured.length).toBe(1);
  expect(measured[0]!.measure).toEqual({ context: { tokens: 64601, window: 1000000, percent: 6 }, rateLimits, cost: { usd: 0.25 }, changed: ['context', 'rateLimits', 'cost'], model: 'claude-opus-5-5' });
  expect(measured[0]!.model).toBe(undefined);
});

// M9 fix 1036: the context breakdown, asked on a measure whose context
// moved and on a channel line, and posted as Context less its grid.
const BREAKDOWN = {
  categories: [{ name: 'System prompt', tokens: 3100, color: 'promptBorder', isDeferred: false, kind: 'used' }],
  totalTokens: 86400,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'default',
  percentage: 43,
  model: 'claude-opus-5-5',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
};

function answerUsage(on: On): string[] {
  const asked: string[] = [];
  on('session.usage', (_$, e) => {
    asked.push(String((e as { breakdown?: unknown }).breakdown));
    return { value: { startedAt: 0, context: { window: 200000, breakdown: { ...BREAKDOWN, gridRows: [[{ color: 'promptBorder', isFilled: true, categoryName: 'System prompt', tokens: 3100, percentage: 1.55 }]] } }, rateLimits: [] } } as never;
  });
  return asked;
}

test('a measure whose context moved posts one Measure and one summary Context with no grid (M9 fix 1036)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  const asked = answerUsage(on);
  await $.session.measure({ context: { tokens: 86400, window: 200000, percent: 43 }, rateLimits: [], cost: { usd: 0.5 }, changed: ['context', 'cost'] });
  await settle();
  expect(bodiesOf(posted, 'Measure').length).toBe(1);
  const context = bodiesOf(posted, 'Context');
  expect(context.length).toBe(1);
  expect(asked).toEqual(['summary']);
  expect(context[0]!.detail).toBe('summary');
  expect(context[0]!.session_id).toBe('conv-738');
  expect(context[0]!.breakdown).toEqual(BREAKDOWN);
});

test('a limits-only measure posts no Context (M9 fix 1036)', async ($, on) => {
  mock.env(on, VARS);
  const posted = recordFetches(on);
  const asked = answerUsage(on);
  await $.session.measure({ context: { tokens: 86400, window: 200000, percent: 43 }, rateLimits: [], changed: ['rateLimits'] });
  await settle();
  expect(bodiesOf(posted, 'Measure').length).toBe(1);
  expect(bodiesOf(posted, 'Context').length).toBe(0);
  expect(asked).toEqual([]);
});

test('a channel line asking a full count posts one full Context and submits nothing (M9 fix 1036)', async ($, on) => {
  mock.env(on, VARS);
  const clock = mock.clock(on);
  const posted = recordFetches(on, false, [['{"context":"full"}']]);
  const asked = answerUsage(on);
  const submitted = answeringChannel(on, (text) => ({ text }));
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  await settle();
  expect(submitted).toEqual([]);
  expect(asked).toEqual(['full']);
  const context = bodiesOf(posted, 'Context');
  expect(context.length).toBe(1);
  expect(context[0]!.detail).toBe('full');
  expect(context[0]!.breakdown).toEqual(BREAKDOWN);
});

// M9 fix 769: each kept row of the conversation, posted as an Append.
const MODEL_ORIGIN = { kind: 'model' as const, model: 'claude-opus-5-5' };

test('a kept response row posts one Append with its uuid, its door and the row (M9 fix 769)', async ($, on) => {
  mock.env(on, VARS);
  mock.session(on);
  const posted = recordFetches(on);
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'From the mod.' }] }, door: 'response', origin: MODEL_ORIGIN, uuid: 'u-769' });
  await settle();
  const rows = bodiesOf(posted, 'Append');
  expect(rows.length).toBe(1);
  expect(rows[0]!.uuid).toBe('u-769');
  expect(rows[0]!.door).toBe('response');
  expect(rows[0]!.session_id).toBe('conv-738');
  expect(rows[0]!.cut).toBe(undefined);
  expect(rows[0]!.row).toEqual({ type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'From the mod.' }] });
});

test("a subagent's row posts nothing (M9 fix 769)", async ($, on) => {
  mock.env(on, VARS);
  mock.session(on);
  const posted = recordFetches(on);
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'side chain' }] }, door: 'response', origin: MODEL_ORIGIN, uuid: 'u-agent', agentId: 'agent-1' });
  await settle();
  expect(bodiesOf(posted, 'Append').length).toBe(0);
});

test('a reply of 40000 characters posts cut with no blocks (M9 fix 769)', async ($, on) => {
  mock.env(on, VARS);
  mock.session(on);
  const posted = recordFetches(on);
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(40000) }] }, door: 'response', origin: MODEL_ORIGIN, uuid: 'u-long' });
  await settle();
  const rows = bodiesOf(posted, 'Append');
  expect(rows.length).toBe(1);
  expect(rows[0]!.cut).toBe(true);
  expect((rows[0]!.row as { content: unknown[] }).content).toEqual([]);
});

test('a tool result holding an image posts its text and an empty image (M9 fix 769)', async ($, on) => {
  mock.env(on, VARS);
  mock.session(on);
  const posted = recordFetches(on);
  const content = [{ type: 'text', text: 'shot taken' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }];
  await $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content }] }, door: 'tool-result', origin: { kind: 'tool', tool: 'Screenshot' }, uuid: 'u-shot' });
  await settle();
  const rows = bodiesOf(posted, 'Append');
  expect(rows.length).toBe(1);
  expect(rows[0]!.cut).toBe(undefined);
  expect((rows[0]!.row as { content: unknown[] }).content).toEqual([
    { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'shot taken' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }] },
  ]);
});

// M9 fix 773: the mod asks the daemon before a compaction. The kit raises
// session.compact only through $.session.compact(), and hands the hook the
// call's args as its input as they are: the trigger the engine would pin
// (the idle compactor's `auto` here) and the transcript go in the call, and
// the engine's own answer beneath must leave at least one message. These
// pin the mod's half (the ask, the skip handed back, the engine's result
// otherwise); the daemon's tests pin the rule.
const SKIP = 'kept whole while idle by emerald';
const BEFORE = { trigger: 'auto', messages: [{ role: 'user', text: 'the conversation', toolUses: [] }] } as never;
const AFTER = { messages: [{ role: 'assistant', text: 'the summary', toolUses: [] }] };

function answerCompact(on: On, reply: string | 'throw'): Posted[] {
  const asked: Posted[] = [];
  // A clock that holds the ask's 1.5 s bound, so the answer always wins
  // the race; the kit's own clock answers a sleep at once.
  mock.clock(on);
  on('http.fetch', ($, e) => {
    if (!e.url.endsWith('/compact')) return { value: { status: 204, ok: true, headers: {}, text: '' } };
    asked.push({ url: e.url, headers: e.init?.headers ?? {}, body: e.init?.body ?? '' });
    if (reply === 'throw') throw new Error('connection refused');
    return { value: { status: 200, ok: true, headers: {}, text: reply } };
  });
  return asked;
}

test('a compaction the daemon says to skip resolves the skip, and the engine beneath never compacts (M9 fix 773)', async ($, on) => {
  mock.env(on, VARS);
  const asked = answerCompact(on, JSON.stringify({ skip: SKIP }));
  let compacted = 0;
  on('session.compact', () => {
    compacted++;
    return AFTER;
  });
  const result = await $.session.compact(BEFORE);
  expect({ asked: asked.length, compacted, result }).toEqual({ asked: 1, compacted: 0, result: { skip: SKIP } });
  expect(asked[0]!.url).toBe('http://127.0.0.1:7419/compact');
  expect(asked[0]!.headers['X-Emerald-Token']).toBe('tok');
  expect(asked[0]!.headers['X-Emerald-Session']).toBe('sess-725');
  expect(asked[0]!.headers['X-Emerald-Hook']).toBe('emerald-mod');
  expect(asked[0]!.headers['Content-Type']).toBe('application/json');
  expect(asked[0]!.body).toBe('{"trigger":"auto"}');
});

test('a compaction the daemon lets through is the engine\'s (M9 fix 773)', async ($, on) => {
  mock.env(on, VARS);
  answerCompact(on, JSON.stringify({ skip: null }));
  on('session.compact', () => AFTER);
  expect((await $.session.compact(BEFORE)).messages).toEqual(AFTER.messages);
});

test('a compaction whose ask throws is the engine\'s (M9 fix 773)', async ($, on) => {
  mock.env(on, VARS);
  answerCompact(on, 'throw');
  on('session.compact', () => AFTER);
  expect((await $.session.compact(BEFORE)).messages).toEqual(AFTER.messages);
});

test('with EMERALD_SESSION_ID unset a compaction asks nothing and is the engine\'s (M9 fix 773)', async ($, on) => {
  mock.env(on, { EMERALD_HOOK_PORT: '7419', EMERALD_HOOK_TOKEN: 'tok' });
  const asked = answerCompact(on, JSON.stringify({ skip: SKIP }));
  on('session.compact', () => AFTER);
  expect((await $.session.compact(BEFORE)).messages).toEqual(AFTER.messages);
  expect(asked.length).toBe(0);
});
