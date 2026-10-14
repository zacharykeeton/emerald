import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROTATE_AT_BYTES } from './activity.ts';

// M9 fix 454 (M75's M1): a daemon that loses the pipe race used to run its
// whole start first, the hook log's rotation among it, so the loser shifted
// the live daemon's generations under it before `listen` told it it had
// lost. It claims the pipe first now and exits 2 before it touches a file.
// The winner here is a bare server on the pipe, which is all the loser can
// see of a live daemon; the loser is this build's own main.

const here = fileURLToPath(import.meta.url);
const mainFile = path.join(path.dirname(here), here.endsWith('.ts') ? 'main.ts' : 'main.js');

test('a daemon that finds the pipe taken exits 2 before it rotates the hook log', async () => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-main-claim-'));
  const pipe = `\\\\.\\pipe\\emerald-main-claim-${process.pid}`;
  const logs = path.join(home, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const hookLog = path.join(logs, 'hooks.jsonl');
  // Past the start's threshold, so a loser that loaded it would rotate it.
  fs.writeFileSync(hookLog, '');
  fs.truncateSync(hookLog, ROTATE_AT_BYTES + 1);
  const winner = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    winner.once('error', reject);
    winner.listen(pipe, () => resolve());
  });
  try {
    const child = spawn(process.execPath, [mainFile], {
      env: { ...process.env, EMERALD_HOME: home, EMERALD_PIPE: pipe, EMERALD_LOAD_TICK_MS: '0', EMERALD_FEED_DIR: 'off' },
      stdio: 'ignore',
      windowsHide: true,
    });
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 30_000);
      child.once('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    assert.equal(code, 2, 'the loser exits 2');
    assert.equal(fs.statSync(hookLog).size, ROTATE_AT_BYTES + 1, 'hooks.jsonl is where it was, at its size');
    assert.equal(fs.existsSync(path.join(logs, 'hooks.1.jsonl')), false, 'no generation was shifted');
    assert.equal(fs.existsSync(path.join(home, 'daemon.json')), false, 'no daemon.json');
    assert.equal(fs.existsSync(path.join(home, 'load-sweep.ps1')), false, 'no sweep script written');
    const text = fs.readFileSync(path.join(logs, 'emmerd.log'), 'utf8');
    assert.match(text, /another emmerd already owns/);
    assert.doesNotMatch(text, /activity log loaded/);
  } finally {
    await new Promise<void>((resolve) => winner.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// M9 fix 517 (M75's M28): the pipe listened only after the whole activity
// log had streamed, 2.2 to 3.0 s of every installed start. It listens first
// now and the log loads behind it; a hook posted during the load moves its
// session and is held for the log, and activity.spans waits for the load.
test('the pipe listens before the activity log loads, and a hook posted during the load is spanned once', async () => {
  const home = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-main-listen-'));
  const pipe = `\\\\.\\pipe\\emerald-main-listen-${process.pid}`;
  const logs = path.join(home, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const hookLog = path.join(logs, 'hooks.jsonl');
  // Two files of 200,000 lines each, about 55 MB apiece (under the 64 MB
  // rotation) and about 0.9 s of load each on this box when quiet, three
  // days old so nothing lands in the hour the test asks for.
  const seed = (file: string, from: number) => {
    const out = fs.openSync(file, 'w');
    const pad = 'x'.repeat(100);
    let chunk: string[] = [];
    for (let i = 0; i < 200_000; i++) {
      const sid = `s${i % 400}`;
      const ev = i % 2 === 0 ? 'UserPromptSubmit' : 'Stop';
      chunk.push(JSON.stringify({ at: from + i * 1000, sessionId: sid, event: ev, outcome: 'applied', from: i % 2 ? 'working' : 'idle', to: i % 2 ? 'done' : 'working', payload: { hook_event_name: ev, session_id: `c-${sid}`, prompt: pad } }));
      if (chunk.length === 10_000) {
        fs.writeSync(out, chunk.join('\n') + '\n');
        chunk = [];
      }
    }
    fs.closeSync(out);
  };
  const threeDaysAgo = Date.now() - 3 * 86_400_000;
  seed(path.join(logs, 'hooks.1.jsonl'), threeDaysAgo - 250_000_000);
  seed(hookLog, threeDaysAgo);
  const emmerdLog = path.join(logs, 'emmerd.log');
  const child = spawn(process.execPath, [mainFile], {
    env: { ...process.env, EMERALD_HOME: home, EMERALD_PIPE: pipe, EMERALD_LOAD_TICK_MS: '0', EMERALD_FEED_DIR: 'off' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const readLog = () => {
    try {
      return fs.readFileSync(emmerdLog, 'utf8');
    } catch {
      return '';
    }
  };
  let socket: net.Socket | null = null;
  try {
    const deadline = Date.now() + 30_000;
    while (!/ listening/.test(readLog())) {
      assert.ok(Date.now() < deadline, 'listening within 30 s');
      await new Promise((r) => setTimeout(r, 20));
    }
    const infoText = fs.readFileSync(path.join(home, 'daemon.json'), 'utf8');
    const info = JSON.parse(infoText) as { hookPort: number; hookToken: string; pipeToken: string };
    // claude-hook.cmd's unhosted branch reads these two lines with a for /f
    // split on colon, comma and space (M9 fix 580); a change to the file's
    // shape breaks every unhosted hook post.
    assert.match(infoText, /^  "hookPort": \d+,$/m, 'daemon.json keeps hookPort on a line of its own, which claude-hook.cmd reads');
    assert.match(infoText, /^  "hookToken": "[0-9a-f]{48}"$/m, 'daemon.json keeps hookToken on a line of its own, which claude-hook.cmd reads');
    // M9 fix 612: the pipe token every hello must carry.
    assert.match(infoText, /^  "pipeToken": "[0-9a-f]{64}",$/m, 'daemon.json carries the pipe token');
    const conv = randomUUID();
    // withoutSession posts as claude-hook.cmd does since fix 580: the id in
    // the body alone.
    const post = async (event: string, withoutSession = false) => {
      const res = await fetch(`http://127.0.0.1:${info.hookPort}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': info.hookToken, ...(withoutSession ? {} : { 'X-Emerald-Session': conv }), 'X-Emerald-Unhosted': '1' },
        body: JSON.stringify({ hook_event_name: event, session_id: conv, cwd: home, ...(event === 'UserPromptSubmit' ? { prompt: 'during the load' } : {}) }),
      });
      assert.equal(res.status, 204);
    };
    await post('UserPromptSubmit');
    await new Promise((r) => setTimeout(r, 50));
    await post('Stop', true);
    // A bare client in the CLI's shape: JSON lines, a hello, then the ask.
    socket = net.connect(pipe);
    const replies = new Map<number, (msg: { ok: boolean; result?: unknown; error?: unknown }) => void>();
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (text: string) => {
      buffer += text;
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const msg = JSON.parse(buffer.slice(0, nl)) as { type: string; id?: number; ok: boolean; result?: unknown; error?: unknown };
        buffer = buffer.slice(nl + 1);
        if (msg.type === 'reply' && msg.id !== undefined) replies.get(msg.id)?.(msg);
      }
    });
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('error', reject);
    });
    let nextId = 1;
    const ask = (type: string, body: Record<string, unknown>) =>
      new Promise<{ ok: boolean; result?: unknown; error?: unknown }>((resolve) => {
        const id = nextId++;
        replies.set(id, resolve);
        socket!.write(JSON.stringify({ id, type, ...body }) + '\n');
      });
    const hello = await ask('hello', { client: 'cli', protocolVersion: 1, token: info.pipeToken });
    assert.ok(hello.ok, JSON.stringify(hello));
    const now = Date.now();
    const spans = await ask('activity.spans', { from: now - 3_600_000, to: now + 60_000 });
    assert.ok(spans.ok, JSON.stringify(spans));
    const rows = (spans.result as { sessions: Array<{ sessionId: string; spans: unknown[] }> }).sessions.filter((s) => s.sessionId === conv);
    assert.equal(rows.length, 1, `the conversation's row: ${JSON.stringify((spans.result as { sessions: unknown[] }).sessions)}`);
    assert.equal(rows[0]!.spans.length, 1, 'its one span');
    // M9 fix 607: how far back the history goes, over a real pipe.
    assert.equal((spans.result as { historyFrom: number | null }).historyFrom, threeDaysAgo - 250_000_000, 'historyFrom is the oldest seeded line');
    const written = fs.readFileSync(hookLog, 'utf8').split('\n').filter((l) => l.includes(conv));
    assert.equal(written.length, 2, 'hooks.jsonl holds the two lines once each');
    const text = readLog();
    const listenAt = text.search(/ listening/);
    const loadedAt = text.indexOf('activity log loaded');
    assert.ok(listenAt >= 0 && loadedAt > listenAt, 'listening comes before activity log loaded');
    const loadedLine = text.slice(loadedAt).split('\n', 1)[0]!;
    const held = Number(/"held":(\d+)/.exec(loadedLine)?.[1] ?? -1);
    assert.ok(held >= 1, `held ${held}: ${loadedLine}`);
    await ask('daemon.stop', {});
    await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
  } finally {
    socket?.destroy();
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
