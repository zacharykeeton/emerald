import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp } from '@emerald/shared/test-temp';
import { appendedBytesRead } from './appended-read.ts';
import { CONTEXT_HISTORY_FOLD_VERSION, forgetContextHistory, readContextHistory, useFold, useFoldState } from './context-history.ts';

// M9 fix 1039: the Context tab's skill and MCP history, over a Claude home
// of the test's own (claudeHome() is read at each ask, so setting it after
// the import holds, as history.test.ts does).
const home = mkTemp('emerald-context-history-test-');
process.env['EMERALD_CLAUDE_HOME'] = home;
// The folds' file (fix 1054) lands in a home of the test's own, never the
// person's ~/.emerald.
process.env['EMERALD_HOME'] = mkTemp('emerald-context-history-home-');
const projects = path.join(home, 'projects', 'C--x-repo');
fs.mkdirSync(projects, { recursive: true });
const log = () => {};

const DAY = 24 * 60 * 60 * 1000;
const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const iso = (at: number) => new Date(at).toISOString();
const prompt = (at: number, text: string) => line({ type: 'user', timestamp: iso(at), message: { role: 'user', content: text } });
const typed = (at: number, name: string) => prompt(at, `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args></command-args>`);
const meta = (at: number, text: string) => line({ type: 'user', isMeta: true, timestamp: iso(at), message: { role: 'user', content: [{ type: 'text', text }] } });
const toolResult = (at: number, id: string, text: string) => line({ type: 'user', timestamp: iso(at), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
const assistant = (at: number, id: string, total: number, tools: Array<{ name: string; input?: Record<string, unknown> }> = [], extra: Record<string, unknown> = {}) =>
  line({
    type: 'assistant',
    timestamp: iso(at),
    message: {
      id,
      role: 'assistant',
      // The four counts that make the request's total.
      usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: total - 2, output_tokens: 1 },
      content: tools.map((t, i) => ({ type: 'tool_use', id: `toolu_${id}_${i}`, name: t.name, input: t.input ?? {} })),
    },
    ...extra,
  });

const t0 = Date.parse('2026-10-20T10:00:00.000Z');
const fixture = (): string[] => [
  prompt(t0, 'start'),
  assistant(t0 + 1000, 'm1', 5, [{ name: 'Skill', input: { skill: 'batch' } }]),
  toolResult(t0 + 2000, 'toolu_m1_0', 'Launching skill: batch'),
  meta(t0 + 2001, 'Base directory for this skill: C:\\x\\batch'),
  assistant(t0 + 3000, 'm2', 100),
  assistant(t0 + 3500, 'm2', 2000),
  prompt(t0 + 4000, 'stop'),
  typed(t0 + 5000, 'backlog-inbox'),
  meta(t0 + 5001, 'Base directory for this skill: C:\\x\\backlog-inbox'),
  assistant(t0 + 6000, 'm3', 300, [{ name: 'mcp__claude-in-chrome__tabs_context_mcp' }]),
  assistant(t0 + 7000, 'm4', 700, [{ name: 'Agent', input: { subagent_type: 'emerald-batch-dev' } }, { name: 'Agent', input: {} }]),
  prompt(t0 + 8000, 'done'),
];

test('useFold: a Skill call, a typed skill and an MCP call, each counted, the turn\'s tokens credited (fix 1039)', () => {
  const s = useFoldState();
  useFold(s, fixture().join(''));
  assert.deepEqual(s.uses, [
    { name: 'batch', at: t0 + 1000, tokens: 2000 },
    { name: 'backlog-inbox', at: t0 + 5000, tokens: 1000 },
  ]);
  assert.deepEqual([...s.mcpTools], [['mcp__claude-in-chrome__tabs_context_mcp', { calls: 1, lastUsedAt: t0 + 6000 }]]);
  assert.deepEqual(Object.fromEntries(s.agents), { 'emerald-batch-dev': 1, 'general-purpose': 1 });
  assert.equal(s.open.length, 0);
  assert.equal(s.pending, null);
});

test('useFold: a typed built-in command is no skill use, and a sidechain line counts for nothing', () => {
  const s = useFoldState();
  useFold(
    s,
    [
      typed(t0, 'clear'),
      line({ type: 'user', timestamp: iso(t0 + 1), message: { role: 'user', content: '<local-command-stdout></local-command-stdout>' } }),
      prompt(t0 + 2, 'hello'),
      assistant(t0 + 3, 'm9', 50, [{ name: 'Skill', input: { skill: 'batch' } }], { isSidechain: true }),
      assistant(t0 + 4, 'm10', 50),
      prompt(t0 + 5, 'bye'),
    ].join(''),
  );
  assert.deepEqual(s.uses, []);
  assert.deepEqual(s.open, []);
});

test('useFold over two halves equals the fold over the whole', () => {
  const lines = fixture();
  // Cut between m2's two streamed lines.
  const cut = lines.findIndex((l) => l.includes('"m2"')) + 1;
  const whole = useFoldState();
  useFold(whole, lines.join(''));
  const halves = useFoldState();
  useFold(halves, lines.slice(0, cut).join(''));
  assert.equal(halves.open.length, 1, 'the batch use is open at the cut');
  useFold(halves, lines.slice(cut).join(''));
  assert.deepEqual(halves.uses, whole.uses);
  assert.deepEqual(halves.open, whole.open);
  assert.deepEqual(halves.mcpTools, whole.mcpTools);
  assert.deepEqual(halves.agents, whole.agents);
});

test('readContextHistory: uses, last used and 7d tokens off two transcripts, an appended read reading only the new lines', async () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  const old = now - 10 * DAY;
  const recent = now - 3 * DAY;
  const a = path.join(projects, 'aaaaaaaa-0000-0000-0000-000000000001.jsonl');
  const b = path.join(projects, 'aaaaaaaa-0000-0000-0000-000000000002.jsonl');
  fs.writeFileSync(a, [prompt(old, 'go'), assistant(old + 1, 'a1', 5, [{ name: 'Skill', input: { skill: 'batch' } }]), assistant(old + 2, 'a2', 900), prompt(old + 3, 'next')].join(''));
  fs.writeFileSync(
    b,
    [
      prompt(recent, 'go'),
      assistant(recent + 1, 'b1', 5, [{ name: 'Skill', input: { skill: 'batch' } }]),
      assistant(recent + 2, 'b2', 400, [{ name: 'mcp__claude-in-chrome__navigate' }]),
      prompt(recent + 3, 'next'),
    ].join(''),
  );
  const first = await readContextHistory(null, log, now);
  assert.deepEqual(first.skills['batch'], { uses: 2, lastUsedAt: recent + 1, tokens7d: 400 });
  assert.deepEqual(first.servers['claude-in-chrome'], { calls: 1, lastUsedAt: recent + 2 });
  assert.equal(first.session, null);
  // An append is read alone.
  const appended = [assistant(recent + 10, 'b3', 50, [{ name: 'mcp__claude-in-chrome__navigate' }])].join('');
  fs.appendFileSync(b, appended);
  const before = appendedBytesRead();
  const second = await readContextHistory(null, log, now);
  assert.equal(appendedBytesRead() - before, Buffer.byteLength(appended), 'only the appended bytes are read');
  assert.equal(second.servers['claude-in-chrome']!.calls, 2);
  const still = appendedBytesRead();
  await readContextHistory(null, log, now);
  assert.equal(appendedBytesRead(), still, 'nothing changed reads no bytes');
});

test('readContextHistory: the session part is the given transcript\'s own calls, and null for no transcript', async () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  // A transcript outside the listing (another config folder): its calls
  // are the session's and never the machine's.
  const elsewhere = mkTemp('emerald-context-history-other-');
  const file = path.join(elsewhere, 'bbbbbbbb-0000-0000-0000-000000000001.jsonl');
  fs.writeFileSync(
    file,
    [
      prompt(now - 1000, 'go'),
      assistant(now - 900, 'c1', 10, [{ name: 'mcp__claude_ai_Wispr_Flow__get_meeting' }, { name: 'mcp__claude_ai_Wispr_Flow__get_meeting' }, { name: 'Task', input: { subagent_type: 'Explore' } }]),
    ].join(''),
  );
  const got = await readContextHistory(file, log, now);
  assert.deepEqual(got.session, { mcpTools: { mcp__claude_ai_Wispr_Flow__get_meeting: 2 }, agents: { Explore: 1 } });
  assert.equal(got.servers['claude_ai_Wispr_Flow'], undefined, 'a file outside the listing adds nothing to the machine');
  assert.equal((await readContextHistory(null, log, now)).session, null);
  assert.equal((await readContextHistory(path.join(elsewhere, 'gone.jsonl'), log, now)).session, null, 'a transcript that cannot be read');
  // Two asks at once share or follow one read and both answer.
  const [x, y] = await Promise.all([readContextHistory(file, log, now), readContextHistory(null, log, now)]);
  assert.ok(x.session !== null);
  assert.equal(y.session, null);
});

const foldsFile = () => path.join(process.env['EMERALD_HOME']!, 'context-history.json');
const listedBytes = () => fs.readdirSync(projects).filter((f) => f.endsWith('.jsonl')).reduce((n, f) => n + fs.statSync(path.join(projects, f)).size, 0);

test('readContextHistory: the folds are saved after a read and a fresh launch loads them, reading no bytes until a file grows (fix 1054)', async () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  const c = path.join(projects, 'aaaaaaaa-0000-0000-0000-000000000003.jsonl');
  const d = path.join(projects, 'aaaaaaaa-0000-0000-0000-000000000004.jsonl');
  fs.writeFileSync(c, [prompt(now - 2 * DAY, 'go'), assistant(now - 2 * DAY + 1, 'c1', 5, [{ name: 'Skill', input: { skill: 'review' } }]), assistant(now - 2 * DAY + 2, 'c2', 300)].join(''));
  fs.writeFileSync(d, [prompt(now - DAY, 'go'), assistant(now - DAY + 1, 'd1', 40, [{ name: 'mcp__github__get_issue' }, { name: 'Agent', input: { subagent_type: 'Explore' } }])].join(''));
  const first = await readContextHistory(null, log, now);
  const saved = JSON.parse(fs.readFileSync(foldsFile(), 'utf8'));
  assert.equal(saved.version, CONTEXT_HISTORY_FOLD_VERSION);
  const entry = saved.files.find((f: { file: string }) => f.file === path.resolve(c));
  assert.ok(entry !== undefined, 'the new transcript is saved');
  assert.match(entry.mark.ino, /^\d+$/);
  assert.equal(entry.state.open.length, 1, "c's review use is still open and saved so");
  forgetContextHistory();
  const before = appendedBytesRead();
  const warm = await readContextHistory(null, log, now);
  assert.equal(appendedBytesRead(), before, 'a launch on saved folds reads no bytes');
  assert.deepEqual(warm, first);
  const appended = [assistant(now - 2 * DAY + 3, 'c3', 700), prompt(now - 2 * DAY + 4, 'next')].join('');
  fs.appendFileSync(c, appended);
  const grown = await readContextHistory(null, log, now);
  assert.equal(appendedBytesRead() - before, Buffer.byteLength(appended), 'only the appended bytes are read');
  assert.deepEqual(grown.skills['review'], { uses: 1, lastUsedAt: now - 2 * DAY + 1, tokens7d: 1000 }, "the open use's saved requests carried on");
});

test('readContextHistory: a saved file of another fold version, or one that is not JSON, is read past: every transcript read again and the file rewritten (fix 1054)', async () => {
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  for (const text of ['{"version":0,"files":[]}', 'not json']) {
    fs.writeFileSync(foldsFile(), text);
    forgetContextHistory();
    const before = appendedBytesRead();
    await readContextHistory(null, log, now);
    assert.equal(appendedBytesRead() - before, listedBytes(), `every listed transcript read again after ${JSON.stringify(text)}`);
    assert.equal(JSON.parse(fs.readFileSync(foldsFile(), 'utf8')).version, CONTEXT_HISTORY_FOLD_VERSION, 'the file is rewritten');
  }
});
