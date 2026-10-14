import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { HistoryWatcher, readAgentsRunning, readTranscriptCost, readUsage, scanBytesRead, scanHistory } from './history.ts';
import { CHUNK_BYTES, COUNT_CAP_BYTES } from '../renderer/src/history-model.ts';
import { appendedBytesRead } from './appended-read.ts';
import { fetchUsage } from './usage.ts';

// M9 fixes 252 and 256: the transcript readers behind the commit card
// and the Sessions rows, over a Claude home of the test's own.
const home = mkTemp('emerald-history-test-');
process.env['EMERALD_CLAUDE_HOME'] = home;
const projects = path.join(home, 'projects', 'C--x-repo');
fs.mkdirSync(projects, { recursive: true });
const log = () => {};

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const usage = (id: string, at: string, output: number, extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', isSidechain: false, timestamp: at, message: { id, role: 'assistant', model: 'claude-opus-5', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: output }, content: [] }, ...extra });

test("readUsage: the conversation's requests off its transcript and its agents' files, a streaming update once, a stamp that says same", async () => {
  const id = 'conv-1';
  const file = path.join(projects, `${id}.jsonl`);
  // The second line of msg_1 is the streamed update; its figures win.
  fs.writeFileSync(file, usage('msg_1', '2026-09-16T10:00:00.000Z', 10) + usage('msg_1', '2026-09-16T10:00:02.000Z', 120) + usage('msg_2', '2026-09-16T10:05:00.000Z', 30));
  fs.mkdirSync(path.join(projects, id, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(projects, id, 'subagents', 'agent-a1.jsonl'), usage('msg_9', '2026-09-16T10:03:00.000Z', 50, { isSidechain: true, agentId: 'a1' }));
  const first = await readUsage(id, null, log);
  assert.ok(first !== null && first.messages !== null);
  assert.deepEqual(first.messages.map((m) => [m.output, m.agentId]), [[120, null], [50, 'a1'], [30, null]]);
  const again = await readUsage(id, first.stamp, log);
  assert.ok(again !== null);
  assert.equal(again.stamp, first.stamp);
  assert.equal(again.messages, null, 'an unchanged set of files answers same');
  // The transcript grows: a new stamp and the list again.
  fs.appendFileSync(file, usage('msg_3', '2026-09-16T10:09:00.000Z', 7));
  const grown = await readUsage(id, first.stamp, log);
  assert.ok(grown !== null && grown.messages !== null);
  assert.notEqual(grown.stamp, first.stamp);
  assert.equal(grown.messages.length, 4);
  assert.equal(await readUsage('conv-nobody', null, log), null, 'a conversation no transcript names');
  fs.rmSync(file);
  assert.equal(await readUsage(id, grown.stamp, log), null, 'a transcript that went');
});

// M9 fix 633: an NTFS file id past 2^53 rounds to a double that its
// neighbour shares, so a rewrite onto the next id read as an append. The
// stat is wrapped to hand this transcript those two ids, as a bigint to a
// { bigint: true } stat and as the rounded number to a plain one.
test('readUsage: a transcript rewritten onto a file id equal to the old one as a double reads fresh', async (t) => {
  const file = path.join(projects, 'conv-ino.jsonl');
  let rewritten = false;
  const real = fs.promises.stat;
  t.mock.method(fs.promises, 'stat', async (p: fs.PathLike, opts?: fs.StatOptions) => {
    const s = await real.call(fs.promises, p, opts);
    if (path.resolve(String(p)) === path.resolve(file)) {
      const id = rewritten ? 9851624187919029n : 9851624187919028n;
      (s as { ino: number | bigint }).ino = typeof s.ino === 'bigint' ? id : Number(id);
    }
    return s;
  });
  fs.writeFileSync(file, usage('msg_1', '2026-09-16T10:00:00.000Z', 1));
  const first = await readUsage('conv-ino', null, log);
  assert.deepEqual(first?.messages?.map((m) => m.output), [1]);
  rewritten = true;
  fs.writeFileSync(file, usage('msg_2', '2026-09-16T10:01:00.000Z', 2) + usage('msg_3', '2026-09-16T10:02:00.000Z', 3));
  const second = await readUsage('conv-ino', null, log);
  assert.deepEqual(second?.messages?.map((m) => m.output), [2, 3], 'the rewrite is read from the start, msg_1 gone');
  fs.rmSync(file);
});

test('readTranscriptCost: the whole transcript and its agents priced, cached by the set, null over the cap and on no requests', async () => {
  const file = path.join(projects, 'conv-2.jsonl');
  fs.writeFileSync(file, usage('msg_1', '2026-09-16T10:00:00.000Z', 100) + usage('msg_1', '2026-09-16T10:00:02.000Z', 200));
  // A whole-second mtime, so the rewrite below can put it back exactly.
  const at = 1_700_000_000;
  fs.utimesSync(file, at, at);
  const cost = await readTranscriptCost(file, log);
  assert.ok(cost !== null && cost.usd !== null);
  // Opus 5: 10 fresh at $5/M, 1000 reads at $0.5/M, 200 out at $25/M.
  const own = (10 / 1e6) * 5 + (1000 / 1e6) * 0.5 + (200 / 1e6) * 25;
  assert.ok(Math.abs(cost.usd - own) < 1e-12);
  assert.deepEqual(cost.tokens, { up: 1010, down: 200, cached: 1000 });
  assert.deepEqual(cost.agents, { count: 0, usd: null, skipped: 0 }, 'no agent files yet');
  // A rewrite that leaves the size and mtime as they were is answered
  // from the cache, and a longer file adds its appended lines to what
  // was held (M9 fix 528).
  fs.writeFileSync(file, usage('msg_1', '2026-09-16T10:00:00.000Z', 100) + usage('msg_1', '2026-09-16T10:00:02.000Z', 900));
  fs.utimesSync(file, at, at);
  assert.deepEqual((await readTranscriptCost(file, log))?.tokens, { up: 1010, down: 200, cached: 1000 });
  fs.appendFileSync(file, usage('msg_2', '2026-09-16T10:01:00.000Z', 1));
  assert.deepEqual((await readTranscriptCost(file, log))?.tokens, { up: 2020, down: 201, cached: 2000 });
  // M9 fix 273: an agent file beside the transcript joins the sum, and
  // one that grows while the transcript stands still re-prices the row.
  const agents = path.join(projects, 'conv-2', 'subagents');
  fs.mkdirSync(agents, { recursive: true });
  const agentFile = path.join(agents, 'agent-a1.jsonl');
  fs.writeFileSync(agentFile, usage('msg_9', '2026-09-16T10:03:00.000Z', 50, { isSidechain: true, agentId: 'a1' }));
  const withAgent = await readTranscriptCost(file, log);
  assert.ok(withAgent !== null && withAgent.usd !== null && withAgent.agents.usd !== null);
  const agentUsd = (10 / 1e6) * 5 + (1000 / 1e6) * 0.5 + (50 / 1e6) * 25;
  // The transcript as read: two requests, 201 out between them.
  const ownUsd = 2 * ((10 / 1e6) * 5 + (1000 / 1e6) * 0.5) + (201 / 1e6) * 25;
  assert.ok(Math.abs(withAgent.usd - (ownUsd + agentUsd)) < 1e-12, 'the transcript and the agent summed');
  assert.deepEqual(withAgent.tokens, { up: 3030, down: 251, cached: 3000 });
  assert.equal(withAgent.agents.count, 1);
  assert.ok(Math.abs(withAgent.agents.usd - agentUsd) < 1e-12, "the agents' share apart");
  fs.appendFileSync(agentFile, usage('msg_10', '2026-09-16T10:04:00.000Z', 25, { isSidechain: true, agentId: 'a1' }));
  const grown = await readTranscriptCost(file, log);
  assert.ok(grown !== null && grown.agents.usd !== null);
  assert.deepEqual(grown.tokens, { up: 4040, down: 276, cached: 4000 }, 'the agent file grew, the transcript did not');
  assert.ok(Math.abs(grown.agents.usd - (agentUsd + (10 / 1e6) * 5 + (1000 / 1e6) * 0.5 + (25 / 1e6) * 25)) < 1e-12);
  // An agent file over the cap is left out and counted; the row keeps
  // its price.
  fs.writeFileSync(path.join(agents, 'agent-a2.jsonl'), usage('msg_11', '2026-09-16T10:05:00.000Z', 5, { isSidechain: true, agentId: 'a2' }) + line({ type: 'progress', pad: 'x'.repeat(8 * 1024 * 1024) }));
  const capped = await readTranscriptCost(file, log);
  assert.ok(capped !== null);
  assert.deepEqual(capped.tokens, grown.tokens);
  assert.deepEqual([capped.agents.count, capped.agents.skipped], [1, 1]);
  const empty = path.join(projects, 'conv-3.jsonl');
  fs.writeFileSync(empty, line({ type: 'user', timestamp: '2026-09-16T10:00:00.000Z', message: { role: 'user', content: 'hi' } }));
  assert.equal(await readTranscriptCost(empty, log), null);
  const big = path.join(projects, 'conv-4.jsonl');
  fs.writeFileSync(big, usage('msg_1', '2026-09-16T10:00:00.000Z', 100) + line({ type: 'progress', pad: 'x'.repeat(8 * 1024 * 1024) }));
  assert.equal(await readTranscriptCost(big, log), null, 'over READ_CAP');
  assert.equal(await readTranscriptCost(path.join(projects, 'conv-gone.jsonl'), log), null);
});

// M9 fix 277: the agents' requests after the transcript's last own
// message are the running spend; an own message after them drops them.
test("readAgentsRunning: the agents' requests after the transcript's last own message, priced and counted, back to none once the main thread moves", async () => {
  const id = 'conv-5';
  const file = path.join(projects, `${id}.jsonl`);
  fs.writeFileSync(file, usage('msg_1', '2026-09-16T10:00:00.000Z', 100) + usage('msg_2', '2026-09-16T10:05:00.000Z', 30));
  const agents = path.join(projects, id, 'subagents');
  fs.mkdirSync(agents, { recursive: true });
  // a1 made one request before the main thread's last and one after; a2 one after.
  fs.writeFileSync(path.join(agents, 'agent-a1.jsonl'), usage('msg_9', '2026-09-16T10:03:00.000Z', 50, { isSidechain: true, agentId: 'a1' }) + usage('msg_10', '2026-09-16T10:06:00.000Z', 40, { isSidechain: true, agentId: 'a1' }));
  fs.writeFileSync(path.join(agents, 'agent-a2.jsonl'), usage('msg_11', '2026-09-16T10:07:00.000Z', 60, { isSidechain: true, agentId: 'a2' }));
  // a3 has started but made no request yet (M9 fix 288): no model entry.
  fs.writeFileSync(path.join(agents, 'agent-a3.jsonl'), line({ type: 'user', isSidechain: true, agentId: 'a3', timestamp: '2026-09-16T10:07:30.000Z', message: { role: 'user', content: 'go' } }));
  const running = await readAgentsRunning(id, log);
  assert.ok(running !== null && running.usd !== null);
  assert.deepEqual(running.models, { a1: 'claude-opus-5', a2: 'claude-opus-5' }, 'the model per agent, over the whole file; none for a3');
  assert.equal(running.since, Date.parse('2026-09-16T10:05:00.000Z'));
  assert.equal(running.requests, 2, 'the two after the last own message');
  assert.equal(running.agents, 2);
  assert.deepEqual(running.tokens, { up: 2020, down: 100, cached: 2000 });
  const one = (out: number) => (10 / 1e6) * 5 + (1000 / 1e6) * 0.5 + (out / 1e6) * 25;
  assert.ok(Math.abs(running.usd - (one(40) + one(60))) < 1e-12, 'priced from the table');
  // M9 fix 372: the price per agent over its whole file, the request before the cut included; none for a3.
  assert.deepEqual(Object.keys(running.spend).sort(), ['a1', 'a2']);
  assert.ok(Math.abs(running.spend['a1']! - (one(50) + one(40))) < 1e-12 && Math.abs(running.spend['a2']! - one(60)) < 1e-12, `the spend per agent, got ${JSON.stringify(running.spend)}`);
  assert.equal(await readAgentsRunning(id, log), running, 'an unchanged set answers from the cache');
  // The main thread moves: its own message after the agents' takes them out of the answer.
  fs.appendFileSync(file, usage('msg_3', '2026-09-16T10:08:00.000Z', 5));
  const moved = await readAgentsRunning(id, log);
  assert.ok(moved !== null);
  assert.equal(moved.since, Date.parse('2026-09-16T10:08:00.000Z'));
  assert.deepEqual([moved.requests, moved.agents, moved.usd], [0, 0, null], 'nothing running, and not null');
  assert.deepEqual(moved.models, { a1: 'claude-opus-5', a2: 'claude-opus-5' }, 'the models hold once the main thread moves, since the agent files are unchanged');
  assert.deepEqual(moved.spend, running.spend, 'and so does the spend per agent');
  assert.equal(await readAgentsRunning('conv-nobody', log), null, 'a conversation no transcript names');
  fs.rmSync(file);
  assert.equal(await readAgentsRunning(id, log), null, 'a transcript that went');
});

// M9 fix 528: a transcript that has only grown is read on from where
// the last read stopped, and the answer is the one a fresh read of the
// same bytes gives; anything that is not an append is read again whole.
test('readUsage: an appended transcript parses only its new lines and answers as a fresh read', async () => {
  const id = 'conv-528';
  const file = path.join(projects, `${id}.jsonl`);
  let copies = 0;
  const fresh = async () => {
    copies += 1;
    const copy = `conv-528-copy-${copies}`;
    fs.copyFileSync(file, path.join(projects, `${copy}.jsonl`));
    return (await readUsage(copy, null, log))?.messages;
  };
  const read = async () => (await readUsage(id, null, log))?.messages;
  fs.writeFileSync(file, usage('msg_1', '2026-09-16T10:00:00.000Z', 10) + usage('msg_2', '2026-09-16T10:01:00.000Z', 20));
  assert.deepEqual((await read())?.map((m) => m.output), [10, 20]);
  // A streamed update of msg_1, already read, and a new msg_3.
  const appended = usage('msg_1', '2026-09-16T10:00:03.000Z', 150) + usage('msg_3', '2026-09-16T10:02:00.000Z', 30);
  fs.appendFileSync(file, appended);
  const before = appendedBytesRead();
  const grown = await read();
  assert.equal(appendedBytesRead() - before, Buffer.byteLength(appended), 'only the appended bytes are read');
  assert.deepEqual(grown, await fresh());
  assert.deepEqual(grown?.map((m) => m.output), [150, 20, 30]);
  // Half a line with no newline yet: not parsed, the answer unchanged.
  const next = usage('msg_4', '2026-09-16T10:03:00.000Z', 40);
  fs.appendFileSync(file, next.slice(0, 40));
  assert.deepEqual(await read(), grown);
  // The rest of it lands.
  fs.appendFileSync(file, next.slice(40));
  const whole = await read();
  assert.deepEqual(whole?.map((m) => m.output), [150, 20, 30, 40]);
  assert.deepEqual(whole, await fresh());
  // Truncated in place to its first line: read again from the start.
  fs.truncateSync(file, Buffer.byteLength(usage('msg_1', '2026-09-16T10:00:00.000Z', 10)));
  const cut = await read();
  assert.deepEqual(cut?.map((m) => m.output), [10]);
  assert.deepEqual(cut, await fresh());
  // A longer rewrite renamed over the name: a new inode, read again.
  const other = path.join(projects, 'conv-528.rewrite');
  fs.writeFileSync(other, usage('msg_7', '2026-09-16T11:00:00.000Z', 70) + usage('msg_8', '2026-09-16T11:01:00.000Z', 80) + usage('msg_9', '2026-09-16T11:02:00.000Z', 90));
  fs.renameSync(other, file);
  const renamed = await read();
  assert.deepEqual(renamed?.map((m) => m.output), [70, 80, 90]);
  assert.deepEqual(renamed, await fresh());
});

function tempDir(): string {
  return fs.realpathSync.native(mkTemp('emerald-history-'));
}

// M9 fix 243: a Claude home that is not there is an empty scan with no
// watcher and one log line, for the history scan and the usage reader
// alike, not an error per ask.
test('a missing Claude home scans empty, starts no watcher and is said once', async () => {
  const gone = path.join(tempDir(), 'not-here');
  const was = process.env['EMERALD_CLAUDE_HOME'];
  process.env['EMERALD_CLAUDE_HOME'] = gone;
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);
  try {
    const scan = await scanHistory(log);
    assert.deepEqual(scan, { sessions: [], total: 0, transcripts: [] });
    const watcher = new HistoryWatcher(() => {}, log);
    watcher.set(true);
    assert.equal(watcher.watching, false, 'no watcher on a folder that is not there');
    watcher.close();
    const usage = await fetchUsage(log);
    assert.deepEqual(usage, { error: 'signed-out' });
    assert.deepEqual(lines, [`claude home ${gone} is not there; nothing to scan`], 'one line for the three asks');
    // Once the folder is there the scan is the folder's, still empty here,
    // and the watcher starts.
    fs.mkdirSync(gone);
    assert.deepEqual(await scanHistory(log), { sessions: [], total: 0, transcripts: [] });
    watcher.set(true);
    assert.equal(watcher.watching, true, 'the watcher starts once the folder exists');
    watcher.close();
    assert.equal(lines.length, 1, 'nothing more said once the folder is there');
  } finally {
    if (was === undefined) delete process.env['EMERALD_CLAUDE_HOME'];
    else process.env['EMERALD_CLAUDE_HOME'] = was;
  }
});

// M9 fix 481: a home deleted under the watcher ends the watch rather
// than spinning, and the scans after it start the watch again once the
// home is back, where it used to stay off until the panel was reopened.
test('a Claude home deleted and made again is watched again from the next scan', async () => {
  const again = path.join(tempDir(), 'home');
  fs.mkdirSync(again);
  const was = process.env['EMERALD_CLAUDE_HOME'];
  process.env['EMERALD_CLAUDE_HOME'] = again;
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);
  const watcher = new HistoryWatcher(() => {}, log);
  try {
    watcher.set(true);
    assert.equal(watcher.watching, true);
    fs.rmSync(again, { recursive: true, force: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(watcher.watching, false, 'the watch ends with the folder');
    assert.ok(lines.some((l) => l.startsWith('history watch ended')), lines.join('\n'));
    await scanHistory(log);
    assert.equal(watcher.watching, false, 'still nothing to watch while the home is gone');
    fs.mkdirSync(again);
    await scanHistory(log);
    assert.equal(watcher.watching, true, 'the scan after the home is back starts the watch');
  } finally {
    watcher.close();
    if (was === undefined) delete process.env['EMERALD_CLAUDE_HOME'];
    else process.env['EMERALD_CLAUDE_HOME'] = was;
  }
});

// M9 fix 529: the scan's remote id sweep reads a grown transcript on from
// where it stopped, the new id after the held one as a fresh read gives
// them, and a rewrite that is not an append is swept again from 0.
test('scanHistory: a grown transcript is swept only past where the last sweep stopped', async () => {
  const own = path.join(tempDir(), 'home');
  const folder = path.join(own, 'projects', 'C--x-sweep');
  fs.mkdirSync(folder, { recursive: true });
  const was = process.env['EMERALD_CLAUDE_HOME'];
  process.env['EMERALD_CLAUDE_HOME'] = own;
  try {
    const id = 'conv-529';
    const copy = 'conv-529-copy';
    const file = path.join(folder, `${id}.jsonl`);
    const at = '2026-09-16T10:00:00.000Z';
    // 70 KB of padding on each side keeps an attachment out of the 64 KB
    // head and tail chunks, so only the sweep can find it.
    const pad = (tag: string) => Array.from({ length: 70 }, (_, i) => line({ type: 'progress', tag, i, pad: 'x'.repeat(1000) })).join('');
    const change = (session: string) => line({ type: 'attachment', attachment: { type: 'remote_session_change', url: `https://claude.ai/code/${session}` }, timestamp: at });
    const start = line({ type: 'ai-title', aiTitle: 'The sweep', sessionId: id }) + line({ type: 'user', message: { role: 'user', content: 'hello' }, cwd: own, sessionId: id, timestamp: at }) + pad('a0') + change('session_a') + pad('a1');
    fs.writeFileSync(file, start);
    fs.writeFileSync(path.join(own, 'history.jsonl'), [id, copy].map((s) => line({ display: 'hello', timestamp: Date.parse(at), project: own, sessionId: s })).join(''));
    const idsOf = (scan: Awaited<ReturnType<typeof scanHistory>>, which: string) => scan.sessions.find((s) => s.id === which)?.remoteIds;
    assert.deepEqual(idsOf(await scanHistory(log), id), ['session_a']);
    const grownBy = change('session_b') + pad('b1');
    fs.appendFileSync(file, grownBy);
    const before = appendedBytesRead();
    assert.deepEqual(idsOf(await scanHistory(log), id), ['session_a', 'session_b']);
    assert.equal(appendedBytesRead() - before, Buffer.byteLength(grownBy), 'the sweep read the appended bytes alone');
    // A byte copy under a second id is a fresh read, and agrees.
    fs.copyFileSync(file, path.join(folder, `${copy}.jsonl`));
    const both = await scanHistory(log);
    assert.deepEqual(idsOf(both, copy), idsOf(both, id));
    // Rewritten in place without the session_b part: swept again from 0.
    fs.writeFileSync(file, start);
    assert.deepEqual(idsOf(await scanHistory(log), id), ['session_a']);
  } finally {
    if (was === undefined) delete process.env['EMERALD_CLAUDE_HOME'];
    else process.env['EMERALD_CLAUDE_HOME'] = was;
  }
});

// M9 fix 552: a session with no history line counts its prompts off the
// id sweep, carried on from the held count, rather than a fresh read of
// the transcript's first 4 MB on every rescan of a grown file.
test('scanHistory: a session with no history line counts its prompts off the sweep, reading only what was appended', async () => {
  const own = path.join(tempDir(), 'home');
  const folder = path.join(own, 'projects', 'C--x-count');
  fs.mkdirSync(folder, { recursive: true });
  const was = process.env['EMERALD_CLAUDE_HOME'];
  process.env['EMERALD_CLAUDE_HOME'] = own;
  try {
    const at = '2026-09-16T10:00:00.000Z';
    const pad = (tag: string) => Array.from({ length: 70 }, (_, i) => line({ type: 'progress', tag, i, pad: 'x'.repeat(1000) })).join('');
    const user = (id: string, text: string) => line({ type: 'user', message: { role: 'user', content: text }, cwd: own, sessionId: id, timestamp: at });
    const promptsOf = (scan: Awaited<ReturnType<typeof scanHistory>>, which: string) => scan.sessions.find((s) => s.id === which)?.prompts;
    const writeIndex = (ids: string[]) => fs.writeFileSync(path.join(own, 'history.jsonl'), ['unrelated-552', ...ids].map((s) => line({ display: 'hello', timestamp: Date.parse(at), project: own, sessionId: s })).join(''));
    writeIndex([]);
    const id = 'conv-552';
    const file = path.join(folder, `${id}.jsonl`);
    fs.writeFileSync(file, line({ type: 'ai-title', aiTitle: 'The count', sessionId: id }) + user(id, 'one') + pad('a0') + user(id, 'two') + pad('a1'));
    assert.equal(promptsOf(await scanHistory(log), id), 2);
    const appended = user(id, 'three') + pad('b1');
    fs.appendFileSync(file, appended);
    const before = scanBytesRead() + appendedBytesRead();
    assert.equal(promptsOf(await scanHistory(log), id), 3);
    assert.equal(scanBytesRead() + appendedBytesRead() - before, 2 * CHUNK_BYTES + Buffer.byteLength(appended), 'the head, the tail and the appended bytes alone');
    const copy = 'conv-552-copy';
    fs.copyFileSync(file, path.join(folder, `${copy}.jsonl`));
    const both = await scanHistory(log);
    assert.equal(promptsOf(both, copy), promptsOf(both, id));
    // Within the head chunk it is counted off the head; grown past it, the
    // sweep from 0 counts from 0 rather than on from the head's count.
    const small = 'conv-552-small';
    const smallFile = path.join(folder, `${small}.jsonl`);
    fs.writeFileSync(smallFile, user(small, 'uno'));
    assert.equal(promptsOf(await scanHistory(log), small), 1);
    fs.appendFileSync(smallFile, pad('c') + user(small, 'duo'));
    assert.equal(promptsOf(await scanHistory(log), small), 2);
    // A session read off its history line, then with the line gone and
    // the transcript untouched, is read afresh for its count.
    const indexed = 'conv-552-indexed';
    const indexedFile = path.join(folder, `${indexed}.jsonl`);
    fs.writeFileSync(indexedFile, user(indexed, 'first') + pad('d0') + user(indexed, 'second') + pad('d1'));
    writeIndex([indexed]);
    assert.equal(promptsOf(await scanHistory(log), indexed), 1, 'the history line counts');
    writeIndex([]);
    assert.equal(promptsOf(await scanHistory(log), indexed), 2, "the transcript's own count once the line is gone");
  } finally {
    if (was === undefined) delete process.env['EMERALD_CLAUDE_HOME'];
    else process.env['EMERALD_CLAUDE_HOME'] = was;
  }
});

test('scanHistory: the prompt count stops at 4 MB on the sweep as on the head read', async () => {
  const own = path.join(tempDir(), 'home');
  const folder = path.join(own, 'projects', 'C--x-cap');
  fs.mkdirSync(folder, { recursive: true });
  const was = process.env['EMERALD_CLAUDE_HOME'];
  process.env['EMERALD_CLAUDE_HOME'] = own;
  try {
    const at = '2026-09-16T10:00:00.000Z';
    const user = (id: string, text: string) => line({ type: 'user', message: { role: 'user', content: text }, cwd: own, sessionId: id, timestamp: at });
    const filler = (tag: string, bytes: number) => {
      const out: string[] = [];
      let n = 0;
      for (let i = 0; n < bytes; i++) {
        const l = line({ type: 'progress', tag, i, pad: 'x'.repeat(2000) });
        out.push(l);
        n += Buffer.byteLength(l);
      }
      return out.join('');
    };
    const promptsOf = (scan: Awaited<ReturnType<typeof scanHistory>>, which: string) => scan.sessions.find((s) => s.id === which)?.prompts;
    fs.writeFileSync(path.join(own, 'history.jsonl'), line({ display: 'hello', timestamp: Date.parse(at), project: own, sessionId: 'unrelated-552' }));
    const id = 'conv-552-cap';
    const file = path.join(folder, `${id}.jsonl`);
    const first = user(id, 'one');
    fs.writeFileSync(file, first + filler('a', COUNT_CAP_BYTES - 16 * 1024 - Buffer.byteLength(first)));
    assert.equal(promptsOf(await scanHistory(log), id), 1);
    fs.appendFileSync(file, user(id, 'two') + filler('b', 32 * 1024) + user(id, 'three'));
    assert.equal(promptsOf(await scanHistory(log), id), 2, 'three lies past the cap');
    const copy = 'conv-552-cap-copy';
    fs.copyFileSync(file, path.join(folder, `${copy}.jsonl`));
    assert.equal(promptsOf(await scanHistory(log), copy), 2, 'a fresh read agrees');
  } finally {
    if (was === undefined) delete process.env['EMERALD_CLAUDE_HOME'];
    else process.env['EMERALD_CLAUDE_HOME'] = was;
  }
});

test.after(removeTemps);
