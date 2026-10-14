// M1 acceptance test without Electron. Talks to a real emmerd over the real
// pipe: spawns a shell, runs `dir`, checks the bytes come back, kills it.
// Starts a daemon if none is listening and stops that daemon at the end.
// Run with: npm run smoke (from the repo root, builds first).
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSION } from '@emerald/shared';
import { emeraldHomeOf, pipePathOf, readPipeToken } from '@emerald/shared/pipe-name';
import type { ServerMessage } from '@emerald/shared';
import { PipeClient } from '@emerald/shared/pipe-client';

const pipePath = pipePathOf();
const daemonMain = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.js');
const t0 = Date.now();

function step(msg: string): void {
  console.log(`[smoke +${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectOrStart(): Promise<{ client: PipeClient; daemon: ChildProcess | null }> {
  try {
    const client = await PipeClient.connect(pipePath);
    step(`connected to an already running daemon at ${pipePath}`);
    return { client, daemon: null };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  step(`no daemon on ${pipePath}; starting ${daemonMain}`);
  const daemon = spawn(process.execPath, [daemonMain], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const client = await PipeClient.connect(pipePath);
      step(`daemon up, pid ${daemon.pid}`);
      return { client, daemon };
    } catch {
      await sleep(100);
    }
  }
  daemon.kill();
  return fail('daemon did not start within 5 s');
}

function waitFor(client: PipeClient, pred: (m: ServerMessage) => boolean, what: string, timeoutMs = 15_000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
    const onMsg = (m: ServerMessage) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      client.off('message', onMsg);
      resolve(m);
    };
    client.on('message', onMsg);
  });
}

// The pipe token (M9 fix 612) off daemon.json. A daemon this script started
// claims the pipe before it writes the file, so the token is waited for.
async function pipeToken(started: boolean): Promise<string | undefined> {
  const home = emeraldHomeOf(process.env);
  const deadline = Date.now() + (started ? 5000 : 0);
  for (;;) {
    const token = readPipeToken(home);
    if (token !== undefined || Date.now() >= deadline) return token;
    await sleep(100);
  }
}

async function run(): Promise<void> {
  const { client, daemon } = await connectOrStart();
  let ok = false;
  try {
    const token = await pipeToken(daemon !== null);
    const hello = await client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION, ...(token !== undefined ? { token } : {}) });
    step(`hello ok: emmerd ${hello.daemonVersion} pid ${hello.daemonPid}`);

    const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const { session } = await client.request('session.spawn', { kind: 'shell', cwd, cols: 120, rows: 30 });
    step(`spawned shell session ${session.id} pid ${session.pid} in ${cwd}`);

    let liveBytes = 0;
    let replayBytes = 0;
    client.on('message', (m: ServerMessage) => {
      if (m.type !== 'pty.output') return;
      const n = Buffer.from(m.data, 'base64').length;
      if (m.replay) replayBytes += n;
      else liveBytes += n;
    });

    // Give the shell a moment to print its banner so the replay is non-trivial.
    await sleep(1000);
    await client.request('pty.attach', { sessionId: session.id });
    step(`attached; replay carried ${replayBytes} bytes`);

    // `dir` in packages/daemon must list package.json. That string appearing in
    // live output proves input reached the shell and output came back.
    const listing = waitFor(
      client,
      (m) => m.type === 'pty.output' && m.replay !== true && Buffer.from(m.data, 'base64').toString().includes('package.json'),
      'dir output containing package.json',
    );
    client.send({ type: 'pty.input', sessionId: session.id, data: 'dir\r' });
    await listing;
    step(`dir output received; ${liveBytes} live bytes so far`);

    const exited = waitFor(client, (m) => m.type === 'pty.exit' && m.sessionId === session.id, 'pty.exit');
    await client.request('session.kill', { sessionId: session.id });
    const exitMsg = await exited;
    step(`session killed, exit code ${exitMsg.type === 'pty.exit' ? exitMsg.exitCode : '?'}`);

    const { sessions } = await client.request('session.list', {});
    const mine = sessions.find((s) => s.id === session.id);
    if (mine?.state !== 'exited') fail(`expected session state exited, got ${mine?.state}`);
    step('session.list reports exited');
    ok = true;
  } finally {
    client.close();
    if (daemon !== null) {
      daemon.kill();
      step('stopped the daemon this script started');
    }
  }
  if (!ok) fail('smoke did not complete');
  step('PASS');
  process.exit(0);
}

run().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
