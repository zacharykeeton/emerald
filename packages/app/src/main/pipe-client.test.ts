import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { JsonLinesDecoder, encodeJsonLine } from '@emerald/shared/jsonlines';
import { PipeClient, crashCode } from './pipe-client.ts';

// M9 fix 380: a daemon that takes the connection and then drops it on the
// hello, or never answers it, used to park the connect loop for good; the
// socket is destroyed on its error and the hello has a deadline, so the
// loop reaches its reconnect. Imports no electron (read-cap.ts's shape).

// A private pipe name so the test never collides with a running emmerd.
const PIPE = `\\\\.\\pipe\\emerald-app-client-test-${process.pid}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function serve(onConnection: (socket: net.Socket) => void): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(onConnection);
    server.once('error', reject);
    server.listen(PIPE, () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function until(what: string, pred: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(25);
  }
  assert.fail(`${what} within ${timeoutMs} ms`);
}

function client(log: string[], helloTimeoutMs?: number): PipeClient {
  return new PipeClient({ pipePath: PIPE, daemonMain: 'nowhere/main.js', log: (m) => log.push(m), ...(helloTimeoutMs === undefined ? {} : { helloTimeoutMs }) });
}

test('a connection dropped on the hello is given up and the loop reconnects within a second or so', async () => {
  let connections = 0;
  const sockets: net.Socket[] = [];
  const server = await serve((socket) => {
    connections += 1;
    sockets.push(socket);
    // The hello arrives, and the daemon dies under it.
    socket.once('data', () => socket.destroy());
  });
  const log: string[] = [];
  const c = client(log);
  try {
    c.start();
    await until('hello failed logged', () => log.some((l) => l.startsWith('hello failed')), 3000);
    await until('disconnected logged', () => log.includes('disconnected from emmerd'), 3000);
    const failedAt = log.findIndex((l) => l.startsWith('hello failed'));
    const disconnectedAt = log.indexOf('disconnected from emmerd');
    assert.ok(failedAt < disconnectedAt, `hello failed before disconnected: ${JSON.stringify(log)}`);
    await until('a second connection', () => connections >= 2, 3000);
  } finally {
    c.stop();
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});

test('a daemon that never answers the hello is given up at the deadline', async () => {
  const sockets: net.Socket[] = [];
  const server = await serve((socket) => {
    sockets.push(socket);
    socket.on('data', () => {
      // Read and say nothing.
    });
  });
  const log: string[] = [];
  const c = client(log, 200);
  try {
    c.start();
    await until('the deadline logged', () => log.some((l) => l === 'hello failed: Error: hello timed out after 200 ms'), 3000);
    await until('disconnected logged', () => log.includes('disconnected from emmerd'), 3000);
    assert.equal(c.connected, false);
  } finally {
    c.stop();
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});

// M9 fix 453: a daemon that dies at start was spawned once and never
// again, the window left on "reconnecting" for good (M75's H1, whose probe
// counted one spawn in 15 s). The autostart is retried on a backoff of 3 s,
// 5 s and then every 30 s (M9 fix 496; 1 s, 2 s, 5 s before), so a daemon
// that exits at once is spawned three times inside eight seconds, each
// attempt logged.
test('a daemon that dies at start is started again on a backoff, each try logged', async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-autostart-'));
  const count = path.join(dir, 'starts.txt');
  const fake = path.join(dir, 'fake-daemon.mjs');
  fs.writeFileSync(count, '');
  fs.writeFileSync(fake, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(count)}, 'start\\n'); process.exit(1);\n`);
  const log: string[] = [];
  const at = new Map<number, number>();
  const c = new PipeClient({
    pipePath: `${PIPE}-autostart`,
    daemonMain: fake,
    runner: 'node',
    log: (m) => {
      log.push(m);
      const n = /^starting emmerd: .* \(try (\d+)\)$/.exec(m)?.[1];
      if (n !== undefined) at.set(Number(n), Date.now());
    },
  });
  const starts = () => fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length;
  try {
    c.start();
    // Read off the log's own times rather than a fixed sleep, since a
    // spawned node takes its time to append on a loaded box.
    await until('the third try', () => at.has(3), 15_000);
    c.stop();
    const t1 = at.get(1) ?? 0;
    const t3 = at.get(3) ?? 0;
    // The floor is the fix (4 s under the old backoff); the ceiling is
    // loose, since the loop notices the wait is over on its next 250 ms
    // poll and a loaded box read 10.2 s once. The 30 s step is the next
    // assertion's.
    assert.ok(t3 - t1 >= 7800 && t3 - t1 < 13_000, `the third try 8 s after the first, got ${t3 - t1} ms: ${JSON.stringify(log)}`);
    assert.equal(at.has(4), false, `no fourth try before 38 s: ${JSON.stringify(log)}`);
    await until('three fake daemons ran', () => starts() >= 3, 10_000);
    // M9 fix 762: each child's end is logged with its exit code.
    const exits = () => log.filter((m) => /^emmerd pid \d+ exited: code 1 \(0x00000001\), signal null$/.test(m)).length;
    await until('three exit lines', () => exits() >= 3, 10_000);
  } finally {
    c.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M9 fix 815: only an NTSTATUS is a crash; a kill, a JS crash and a failed
// start all exit 1, a stop 0, a lost start race 2, and Stop-Process's
// TerminateProcess(h, -1) reads 0xFFFFFFFF.
test('crashCode reads an NTSTATUS as eight hex digits and every other code as null', () => {
  assert.equal(crashCode(-1073740940), 'C0000374');
  assert.equal(crashCode(3221226356), 'C0000374');
  assert.equal(crashCode(3221225477), 'C0000005');
  for (const code of [0, 1, 2, -1, 4294967295, null]) assert.equal(crashCode(code), null, `code ${code}`);
});

// M9 fix 815: a child daemon that ends on a crash code is said as an event,
// one that exits 1 (a kill) is not. Each client stops at its child's first
// exit, so the backoff's next try never runs.
test('a child daemon that ends on a crash code emits daemon-crashed with its pid, and one that exits 1 emits nothing', async () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'emerald-crash-'));
  const crashing = path.join(dir, 'crash-daemon.mjs');
  const killed = path.join(dir, 'nocrash-daemon.mjs');
  fs.writeFileSync(crashing, 'process.exit(-1073740940);\n');
  fs.writeFileSync(killed, 'process.exit(1);\n');
  const crashLog: string[] = [];
  const crashes: { pid: number; code: string }[] = [];
  const c = new PipeClient({ pipePath: `${PIPE}-crash`, daemonMain: crashing, runner: 'node', log: (m) => crashLog.push(m) });
  c.on('daemon-crashed', (crash: { pid: number; code: string }) => crashes.push(crash));
  const quietLog: string[] = [];
  const quiet: unknown[] = [];
  const q = new PipeClient({ pipePath: `${PIPE}-nocrash`, daemonMain: killed, runner: 'node', log: (m) => quietLog.push(m) });
  q.on('daemon-crashed', (crash: unknown) => quiet.push(crash));
  try {
    c.start();
    await until('one daemon-crashed event', () => crashes.length >= 1, 10_000);
    c.stop();
    const crash = crashes[0];
    assert.equal(crash?.code, 'C0000374', `the code: ${JSON.stringify(crashes)}`);
    assert.equal(typeof crash?.pid, 'number');
    const exited = crashLog.map((m) => /^emmerd pid (\d+) exited: /.exec(m)?.[1]).find((p) => p !== undefined);
    assert.equal(crash?.pid, Number(exited), `the pid matches the exit line: ${JSON.stringify(crashLog)}`);

    q.start();
    await until('the exit line', () => quietLog.some((m) => /^emmerd pid \d+ exited: code 1 /.test(m)), 10_000);
    q.stop();
    assert.deepEqual(quiet, [], `no event for code 1: ${JSON.stringify(quietLog)}`);
  } finally {
    c.stop();
    q.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A fake emmerd for the tests below: answers hello with the fields given
// and every other request through `answer`, one JSON line each.
function stubDaemon(pipe: string, hello: Record<string, unknown>, answer: (type: string) => unknown, sockets: net.Socket[]): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      sockets.push(socket);
      const decoder = new JsonLinesDecoder();
      socket.on('data', (chunk: Buffer) => {
        for (const raw of decoder.push(chunk)) {
          const msg = raw as { id?: number; type: string };
          if (msg.id === undefined) continue;
          const result = msg.type === 'hello' ? hello : answer(msg.type);
          socket.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result }));
        }
      });
      socket.on('error', () => {});
    });
    server.once('error', reject);
    server.listen(pipe, () => resolve(server));
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// M9 fix 494: the restart killed the hello's pid by its number alone three
// seconds on, whatever held the number by then. A hello naming a live
// process that did not start when the hello says it did is left alone.
test('a restart does not kill a pid that is not the daemon the hello named', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
  const pid = child.pid ?? 0;
  const sockets: net.Socket[] = [];
  const pipe = `${PIPE}-identity`;
  const server = await stubDaemon(pipe, { daemonPid: pid, daemonStartedAt: 1, daemonVersion: 'fake', featureLevel: 57 }, () => ({ kept: 0 }), sockets);
  const log: string[] = [];
  const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: (m) => log.push(m), stopGraceMs: 300 });
  try {
    c.start();
    await until('connected', () => c.daemonInfo !== null, 3000);
    assert.equal(c.daemonInfo?.startedAt, 1);
    c.restartDaemon();
    const line = `not killing pid ${pid}: it is not the daemon that was started at 1970-01-01T00:00:00.001Z`;
    await until('the refusal logged', () => log.includes(line), 15_000);
    await sleep(1000);
    assert.equal(alive(pid), true, `the unrelated process is still alive: ${JSON.stringify(log)}`);
    assert.equal(log.some((l) => l.startsWith('restarting emmerd: killing')), false, JSON.stringify(log));
  } finally {
    c.stop();
    child.kill();
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});

// M9 fix 495: a daemon serving another home than the window's is named in
// the log after the connected line, and on the daemon info for the banner.
test('a daemon on another home is logged and set on the daemon info', async () => {
  const sockets: net.Socket[] = [];
  const pipe = `${PIPE}-home`;
  const server = await stubDaemon(pipe, { daemonPid: 1, daemonStartedAt: 1, home: 'C:\\elsewhere', daemonVersion: 'fake', featureLevel: 57 }, () => ({}), sockets);
  const log: string[] = [];
  // The home names no folder on disk, so no daemon.json will come; the wait
  // for one (M9 fix 632) is cut to nothing.
  const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: (m) => log.push(m), home: 'C:\\mine', daemonJsonWaitMs: 0 });
  try {
    c.start();
    await until('connected', () => c.daemonInfo !== null, 3000);
    assert.deepEqual(c.daemonInfo?.otherHome, { theirs: 'C:\\elsewhere', mine: 'C:\\mine' });
    const connectedAt = log.findIndex((l) => l.startsWith('connected to emmerd fake pid 1'));
    assert.ok(connectedAt >= 0, JSON.stringify(log));
    assert.equal(log[connectedAt + 1], 'connected to a daemon on another home: C:\\elsewhere (mine C:\\mine)');
  } finally {
    c.stop();
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});

// M9 fix 612: the window's hello carries daemon.json's pipeToken off its
// home, and leaves the field out when the file holds none. A home with no
// file at all waits for one since fix 632, so the second home holds a
// daemon.json without a token.
test('the hello carries the pipe token from the home, and none from a daemon.json without one', async () => {
  const pipe = `${PIPE}-token`;
  const hellos: Array<Record<string, unknown>> = [];
  const sockets: net.Socket[] = [];
  const server = await new Promise<net.Server>((resolve, reject) => {
    const srv = net.createServer((socket) => {
      sockets.push(socket);
      const decoder = new JsonLinesDecoder();
      socket.on('data', (chunk: Buffer) => {
        for (const raw of decoder.push(chunk)) {
          const msg = raw as { id?: number; type: string } & Record<string, unknown>;
          if (msg.id === undefined) continue;
          if (msg.type === 'hello') hellos.push(msg);
          socket.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result: msg.type === 'hello' ? { daemonPid: 1, daemonVersion: 'fake', featureLevel: 60 } : {} }));
        }
      });
      socket.on('error', () => {});
    });
    srv.once('error', reject);
    srv.listen(pipe, () => resolve(srv));
  });
  const withToken = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-app-token-'));
  const without = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-app-token-'));
  fs.writeFileSync(path.join(withToken, 'daemon.json'), JSON.stringify({ pid: 1, pipeToken: '9'.repeat(64) }));
  fs.writeFileSync(path.join(without, 'daemon.json'), JSON.stringify({ pid: 1 }));
  try {
    for (const [home, expected] of [[withToken, '9'.repeat(64)], [without, undefined]] as const) {
      hellos.length = 0;
      const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: () => {}, home });
      try {
        c.start();
        await until('connected', () => c.daemonInfo !== null, 3000);
        assert.equal(hellos.length, 1);
        if (expected === undefined) assert.equal('token' in hellos[0]!, false, 'no token key');
        else assert.equal(hellos[0]!['token'], expected);
      } finally {
        c.stop();
      }
    }
  } finally {
    for (const s of sockets) s.destroy();
    await closeServer(server);
    fs.rmSync(withToken, { recursive: true, force: true });
    fs.rmSync(without, { recursive: true, force: true });
  }
});

// M9 fix 632: a stub daemon for the start race. `hold` pauses every socket
// as claimPipe does until `release` is called; each hello is recorded and
// answered by `answer`, which returns the reply's ok result or a refusal.
function raceStub(pipe: string, answer: (hello: Record<string, unknown>, n: number) => { ok: true } | { ok: false; code: string }, hold = false) {
  const hellos: Array<Record<string, unknown>> = [];
  const sockets: net.Socket[] = [];
  let held = hold;
  const listen = (socket: net.Socket) => {
    const decoder = new JsonLinesDecoder();
    socket.on('data', (chunk: Buffer) => {
      for (const raw of decoder.push(chunk)) {
        const msg = raw as { id?: number; type: string } & Record<string, unknown>;
        if (msg.id === undefined) continue;
        if (msg.type !== 'hello') {
          socket.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result: {} }));
          continue;
        }
        hellos.push(msg);
        const a = answer(msg, hellos.length);
        if (a.ok) socket.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result: { daemonPid: 1, daemonVersion: 'fake', featureLevel: 60 } }));
        else socket.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: false, error: { code: a.code, message: `refused: ${a.code}` } }));
      }
    });
  };
  const server = new Promise<net.Server>((resolve, reject) => {
    const srv = net.createServer((socket) => {
      sockets.push(socket);
      socket.on('error', () => {});
      if (held) socket.pause();
      listen(socket);
    });
    srv.once('error', reject);
    srv.listen(pipe, () => resolve(srv));
  });
  return {
    hellos,
    sockets,
    server,
    release: () => {
      held = false;
      for (const s of sockets) s.resume();
    },
  };
}

test('a window that connects before daemon.json is written waits for it and says hello with the token', async () => {
  const pipe = `${PIPE}-race-wait`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-app-race-'));
  const token = '7'.repeat(64);
  const stub = raceStub(pipe, () => ({ ok: true }), true);
  const server = await stub.server;
  const log: string[] = [];
  const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: (m) => log.push(m), home, helloTimeoutMs: 200 });
  try {
    c.start();
    await until('the first connection', () => stub.sockets.length >= 1, 3000);
    await sleep(600);
    fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({ pid: 1, pipeToken: token }));
    stub.release();
    await until('connected', () => c.daemonInfo !== null, 3000);
    assert.equal(stub.hellos[0]!['token'], token, `the first hello carries the token: ${JSON.stringify(log)}`);
    assert.equal(log.some((l) => l.startsWith('hello failed')), false, `no hello failed: ${JSON.stringify(log)}`);
  } finally {
    c.stop();
    for (const s of stub.sockets) s.destroy();
    await closeServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a daemon.json that never comes is waited for to the bound, then the hello goes without a token', async () => {
  const pipe = `${PIPE}-race-bound`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-app-race-'));
  const stub = raceStub(pipe, () => ({ ok: true }));
  const server = await stub.server;
  const log: string[] = [];
  const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: (m) => log.push(m), home, daemonJsonWaitMs: 300 });
  try {
    c.start();
    await until('connected', () => c.daemonInfo !== null, 3000);
    assert.ok(log.includes('daemon.json still missing 0.3 s after connecting; saying hello without a token'), JSON.stringify(log));
    assert.equal('token' in stub.hellos[0]!, false, 'no token key');
  } finally {
    c.stop();
    for (const s of stub.sockets) s.destroy();
    await closeServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('a hello refused for a token the daemon then rewrote retries with the new one and says why', async () => {
  const pipe = `${PIPE}-race-retry`;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-app-race-'));
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({ pid: 1, pipeToken: a }));
  const stub = raceStub(pipe, (_hello, n) => {
    if (n === 1) {
      fs.writeFileSync(path.join(home, 'daemon.json'), JSON.stringify({ pid: 2, pipeToken: b }));
      return { ok: false, code: 'bad-token' };
    }
    return { ok: true };
  });
  const server = await stub.server;
  const log: string[] = [];
  const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: (m) => log.push(m), home });
  try {
    c.start();
    await until('connected', () => c.daemonInfo !== null, 3000);
    assert.ok(log.includes('hello sent before the daemon wrote its token; retrying with it'), JSON.stringify(log));
    assert.equal(log.some((l) => l.startsWith('hello failed')), false, `no hello failed: ${JSON.stringify(log)}`);
    assert.equal(stub.hellos[1]!['token'], b);
  } finally {
    c.stop();
    for (const s of stub.sockets) s.destroy();
    await closeServer(server);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// M9 fix 498: a paste past 16 MB of JSON was one line the daemon's framing
// refused, dropping the connection and every pane with it. A long
// pty.input goes in 1 MB pieces, in order, none cutting a surrogate pair.
test('a long paste goes to the daemon in pieces the framing takes', async () => {
  const pipe = `${PIPE}-paste`;
  const sockets: net.Socket[] = [];
  const inputs: string[] = [];
  const lineLengths: number[] = [];
  const server = await new Promise<net.Server>((resolve, reject) => {
    const s = net.createServer((socket) => {
      sockets.push(socket);
      const decoder = new JsonLinesDecoder();
      let partial = 0;
      socket.on('data', (chunk: Buffer) => {
        // Each line's length in characters, as the daemon's decoder counts.
        const text = chunk.toString('latin1');
        let from = 0;
        for (let nl = text.indexOf('\n'); nl !== -1; nl = text.indexOf('\n', from)) {
          lineLengths.push(partial + nl - from);
          partial = 0;
          from = nl + 1;
        }
        partial += text.length - from;
        for (const raw of decoder.push(chunk)) {
          const msg = raw as { id?: number; type: string; data?: string };
          if (msg.type === 'hello') socket.write(encodeJsonLine({ type: 'reply', id: msg.id, ok: true, result: { daemonPid: 1, daemonVersion: 'fake', featureLevel: 57 } }));
          else if (msg.type === 'pty.input') inputs.push(msg.data ?? '');
        }
      });
      socket.on('error', () => {});
    });
    s.once('error', reject);
    s.listen(pipe, () => resolve(s));
  });
  const c = new PipeClient({ pipePath: pipe, daemonMain: 'nowhere/main.js', log: () => {} });
  try {
    c.start();
    await until('connected', () => c.daemonInfo !== null, 3000);
    const unit = 'C:\\x\\';
    const data = unit.repeat(Math.ceil((20 * 1024 * 1024) / unit.length)).slice(0, 20 * 1024 * 1024);
    c.send({ type: 'pty.input', sessionId: 's', data });
    await until('twenty pieces', () => inputs.length >= 20, 20_000);
    assert.equal(inputs.length, 20);
    assert.ok(inputs.join('') === data, 'the pieces join to the paste');
    assert.ok(lineLengths.every((n) => n < 16 * 1024 * 1024), `every line under 16 MB: ${Math.max(...lineLengths)}`);

    inputs.length = 0;
    // An emoji whose two halves straddle the first piece's end.
    const size = 1024 * 1024;
    const straddle = 'a'.repeat(size - 1) + '\u{1F600}' + 'b'.repeat(10);
    c.send({ type: 'pty.input', sessionId: 's', data: straddle });
    await until('two pieces', () => inputs.length >= 2, 10_000);
    assert.equal(inputs.join(''), straddle);
    for (const piece of inputs) {
      assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(piece), false, 'no lone surrogate in a piece');
    }
  } finally {
    c.stop();
    for (const s of sockets) s.destroy();
    await closeServer(server);
  }
});
