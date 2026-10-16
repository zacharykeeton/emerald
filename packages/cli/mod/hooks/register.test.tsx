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

function recordFetches(on: On, fail = false): Posted[] {
  const posted: Posted[] = [];
  on('http.fetch', ($, e) => {
    posted.push({ url: e.url, headers: e.init?.headers ?? {}, body: e.init?.body ?? '' });
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

// M9 fix 741: the prompt channel. The test's process.spawn hook stands in
// for `emmer mod-channel`, streaming one prompt line.
function channel(on: On): { argvs: string[][]; submitted: { text: string; origin: unknown }[] } {
  const argvs: string[][] = [];
  const submitted: { text: string; origin: unknown }[] = [];
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('process.spawn', async function* ($, e) {
    argvs.push([...e.argv]);
    yield { stream: 'stdout' as const, text: '{"text":"hi"}\n' };
    // A test's process.spawn beneath answers its end in { value }, as
    // env.get and http.fetch do; prompt.submit answers its own shape.
    return { value: { code: 0, signal: null } };
  });
  on('prompt.submit', ($, e) => {
    submitted.push({ text: e.text, origin: e.origin });
    return { text: e.text };
  });
  return { argvs, submitted };
}

const CHANNEL = { ...VARS, EMERALD_MOD_CHANNEL: JSON.stringify(['node', 'main.js', 'mod-channel']) };

test('an interactive session.start opens the channel and a streamed line is submitted as the person (M9 fix 741)', async ($, on) => {
  mock.env(on, CHANNEL);
  const clock = mock.clock(on);
  const seen = channel(on);
  await $.session.start({ cwd: 'C:\\w', surface: 'terminal', isInteractive: true });
  await clock.settle();
  expect(seen.argvs).toEqual([['node', 'main.js', 'mod-channel', 'sess-725']]);
  expect(seen.submitted.length).toBe(1);
  expect(seen.submitted[0]!.text).toBe('hi');
  expect(seen.submitted[0]!.origin).toEqual(expect.objectContaining({ kind: 'plugin', asUser: true }));
});

test('a -p session.start opens no channel (M9 fix 741)', async ($, on) => {
  mock.env(on, CHANNEL);
  const clock = mock.clock(on);
  const seen = channel(on);
  await $.session.start({ cwd: 'C:\\w', surface: null, isInteractive: false });
  await clock.settle();
  expect(seen.argvs).toEqual([]);
  expect(seen.submitted).toEqual([]);
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
