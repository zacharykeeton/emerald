import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { AgentUsageScanner, agentsCountedFrom, markRecountDone, readAgentFile, readAgentsCounted, recountAgents, type AgentRead } from './agent-usage.ts';
import type { AgentUsageLine } from './activity.ts';

const quiet = { info() {}, warn() {}, error() {} };

test.after(removeTemps);

const T = Date.parse('2026-11-20T10:00:00.000Z');

// An agent transcript's assistant line, shaped off the user's own files.
function assistant(id: string, at: number, usage: [number, number, number], output: number, model = 'claude-opus-5-5'): string {
  return JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, model, usage: { input_tokens: usage[0], cache_creation_input_tokens: usage[1], cache_read_input_tokens: usage[2], output_tokens: output } } });
}

const userLine = JSON.stringify({ type: 'user', timestamp: new Date(T).toISOString(), message: { role: 'user', content: 'go' } });

function fixtureA(): string {
  return [userLine, assistant('msg_a', T + 1000, [3, 1000, 2000], 50), assistant('msg_a', T + 1500, [3, 1000, 2000], 60), assistant('msg_b', T + 5000, [2, 0, 3000], 40)].join('\n') + '\n';
}

test('readAgentFile counts one request per response id, the last line of a response winning, and stops at the last newline (M9 fix 1189)', async () => {
  const dir = mkTemp('emerald-agent-usage-');
  const file = path.join(dir, 'agent-x.jsonl');
  fs.writeFileSync(file, fixtureA());
  // (a) the whole file
  const a = await readAgentFile(file, null, 0);
  assert.deepEqual(a, { requests: 2, fresh: 5, cacheWrite: 1000, cacheRead: 5000, output: 100, model: 'claude-opus-5-5', upTo: fs.statSync(file).size, lastId: 'msg_b', lastOutput: 40, firstAt: T + 1000, lastAt: T + 5000 });
  // (b) a partial last line is left for the next read
  const size = fs.statSync(file).size;
  fs.appendFileSync(file, assistant('msg_b', T + 6000, [2, 0, 3000], 55).slice(0, 30));
  const b = await readAgentFile(file, null, 0);
  assert.equal(b?.upTo, size);
  // (c) read on from (a): msg_b grows by 15, msg_c is one more request
  fs.writeFileSync(file, fixtureA() + assistant('msg_b', T + 6000, [2, 0, 3000], 55) + '\n' + assistant('msg_c', T + 7000, [1, 0, 3100], 30) + '\n');
  const from: AgentRead = { upTo: a!.upTo, lastId: a!.lastId, lastOutput: a!.lastOutput, at: T + 5000 };
  const c = await readAgentFile(file, from, 0);
  assert.equal(c?.requests, 1);
  assert.equal(c?.output, 45);
  assert.equal(c?.fresh, 1);
  assert.equal(c?.cacheRead, 3100);
  assert.equal(c?.lastId, 'msg_c');
  // Nothing new: null.
  assert.equal(await readAgentFile(file, { upTo: c!.upTo, lastId: c!.lastId, lastOutput: c!.lastOutput, at: T + 7000 }, 0), null);
  // (d) a first read with since after msg_a's time counts msg_b alone
  fs.writeFileSync(file, fixtureA());
  const d = await readAgentFile(file, null, T + 2000);
  assert.equal(d?.requests, 1);
  assert.equal(d?.output, 40);
  assert.equal(d?.cacheRead, 3000);
  // (e) a synthetic line counts nothing
  fs.writeFileSync(file, assistant('msg_s', T, [5, 5, 5], 5, '<synthetic>') + '\n');
  assert.equal(await readAgentFile(file, null, 0), null);
});

test('agentsCountedFrom writes its start once and answers it at every later start (M9 fix 1189)', () => {
  const dir = mkTemp('emerald-agents-counted-');
  const file = path.join(dir, 'agents-counted.json');
  assert.equal(agentsCountedFrom(file, 1000, quiet), 1000);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { from: 1000 });
  assert.equal(agentsCountedFrom(file, 5000, quiet), 1000);
  fs.writeFileSync(file, '{"from":');
  assert.equal(agentsCountedFrom(file, 7000, quiet), 7000, 'a torn file is written again');
});

test('the scanner writes one line per agent file with a new count, and a second scan with nothing appended writes none (M9 fix 1189)', async () => {
  const dir = mkTemp('emerald-agent-scan-');
  const transcript = path.join(dir, 'conv-1.jsonl');
  fs.writeFileSync(transcript, userLine + '\n');
  const sub = path.join(dir, 'conv-1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), fixtureA());
  fs.writeFileSync(path.join(sub, 'agent-a2.jsonl'), assistant('msg_z', T + 9000, [1, 2, 3], 4) + '\n');
  fs.writeFileSync(path.join(sub, 'agent-a2.meta.json'), '{}');
  const reads = new Map<string, AgentRead>();
  const lines: AgentUsageLine[] = [];
  const scanner = new AgentUsageScanner({
    known: (s, a) => reads.get(`${s}/${a}`) ?? null,
    since: () => 0,
    write: (l) => {
      lines.push(l);
      reads.set(`${l.agentUsage.sessionId}/${l.agentUsage.agentId}`, { upTo: l.agentUsage.upTo, lastId: l.agentUsage.lastId, lastOutput: l.agentUsage.lastOutput, at: l.at });
    },
    log: quiet,
  });
  await scanner.scan('track-1', transcript, T + 10_000);
  assert.deepEqual(lines.map((l) => [l.at, l.agentUsage.sessionId, l.agentUsage.agentId, l.agentUsage.requests]), [
    [T + 10_000, 'track-1', 'a1', 2],
    [T + 10_000, 'track-1', 'a2', 1],
  ]);
  await scanner.scan('track-1', transcript, T + 20_000);
  assert.equal(lines.length, 2, 'nothing appended, nothing written');
  // A transcript with no subagents folder is nothing.
  await scanner.scan('track-2', path.join(dir, 'none.jsonl'), T);
  assert.equal(lines.length, 2);
});

// M9 fix 1201: the one-time recount over two roots, Claude Code's own
// projects folder first and the drop folder second.
test('recountAgents counts each known agent once from the first root that holds it, inside [since, until), and skips the unknown and the covered (M9 fix 1201)', async () => {
  const one = mkTemp('emerald-recount-one-');
  const two = mkTemp('emerald-recount-two-');
  const agentFile = (root: string, session: string, agent: string, lines: string[]) => {
    const dir = path.join(root, 'C--code-proj', session, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `agent-${agent}.jsonl`), lines.join('\n') + '\n');
  };
  const since = T;
  const until = T + 100_000;
  agentFile(one, 'c-known', 'x', [assistant('m1', T + 1000, [1, 2, 3], 4), assistant('m2', T + 2000, [1, 0, 0], 1), assistant('m3', until + 1000, [9, 9, 9], 9)]);
  agentFile(one, 'c-known', 'y', [assistant('m4', T + 3000, [1, 0, 0], 1)]);
  agentFile(one, 'c-unknown', 'u', [assistant('m5', T + 3000, [1, 0, 0], 1)]);
  agentFile(two, 'c-known', 'x', [assistant('m9', T + 1000, [50, 50, 50], 50)]);
  agentFile(two, 'c-known', 'z', [assistant('m6', T - 5000, [7, 7, 7], 7), assistant('m7', T + 4000, [2, 0, 10], 3)]);
  const lines: AgentUsageLine[] = [];
  const warned: string[] = [];
  const infos: string[] = [];
  const summary = await recountAgents([one, two], {
    trackOfClaude: (id) => (id === 'c-known' ? 'a' : null),
    recounted: (_s, agentId) => agentId === 'y',
    since,
    until,
    write: (l) => lines.push(l),
    log: { info: (m: string) => infos.push(m), warn: (m: string) => warned.push(m), error() {} },
  });
  const byAgent = Object.fromEntries(lines.map((l) => [l.agentUsage.agentId, l]));
  assert.deepEqual(Object.keys(byAgent).sort(), ['x', 'z']);
  assert.deepEqual([byAgent['x']!.at, byAgent['x']!.agentUsage.requests, byAgent['x']!.agentUsage.fresh, byAgent['x']!.agentUsage.output, byAgent['x']!.agentUsage.recount, byAgent['x']!.agentUsage.sessionId], [T + 2000, 2, 2, 5, true, 'a']);
  assert.deepEqual([byAgent['z']!.at, byAgent['z']!.agentUsage.requests, byAgent['z']!.agentUsage.cacheRead], [T + 4000, 1, 10]);
  assert.deepEqual([byAgent['z']!.agentUsage.upTo, byAgent['z']!.agentUsage.lastId, byAgent['z']!.agentUsage.lastOutput], [0, null, 0]);
  assert.deepEqual([summary.files, summary.agents, summary.sessions, summary.requests, summary.firstAt, summary.unknownAgents, summary.unknownSessions, summary.covered, summary.empty], [2, 2, 1, 3, T + 1000, 1, 1, 1, 0]);
  assert.deepEqual(summary.roots, [one, two]);
  assert.equal(warned.length, 0);
  assert.equal(infos.length, 1);
  assert.match(infos[0]!, /^agent recount: 2 agent files read \([\d.]+ MB\) in [\d.]+ s from .* and .*; 2 agents counted on 1 sessions, 3 requests from \d{4}-\d\d-\d\d; skipped 1 agents of 1 sessions the log does not know, 1 already counted, 0 with nothing before the count began$/);
});

test('the marker keeps the count\'s start beside the recount\'s end, which a later start reads (M9 fix 1201)', () => {
  const file = path.join(mkTemp('emerald-recount-marker-'), 'agents-counted.json');
  assert.equal(readAgentsCounted(file), null);
  assert.equal(agentsCountedFrom(file, 1000, quiet), 1000);
  assert.deepEqual(readAgentsCounted(file), { from: 1000, recountDone: null });
  markRecountDone(file, 1000, 2000, quiet);
  assert.deepEqual(readAgentsCounted(file), { from: 1000, recountDone: 2000 });
  assert.equal(agentsCountedFrom(file, 9000, quiet), 1000, 'the start is never moved');
});

test('recountAgents with no root on disk reads nothing and warns nothing (M9 fix 1201)', async () => {
  const warned: string[] = [];
  const summary = await recountAgents([path.join(mkTemp('emerald-recount-none-'), 'projects'), path.join(mkTemp('emerald-recount-none-'), 'recount-subagents')], {
    trackOfClaude: () => 'a',
    recounted: () => false,
    since: 0,
    until: T,
    write: () => assert.fail('nothing to write'),
    log: { info() {}, warn: (m: string) => warned.push(m), error() {} },
  });
  assert.equal(summary.files, 0);
  assert.deepEqual(summary.roots, []);
  assert.equal(warned.length, 0);
});
