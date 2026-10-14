import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { PROMPT_WRAPPER } from './launchers/shell.ts';
import { PtySession, clampPtySize, stampEnv, type PtyHandle } from './pty-session.ts';

// A scriptable stand-in for node-pty so the batching rules can be tested
// without a real process.
class FakePty implements PtyHandle {
  readonly pid = 4242;
  writes: string[] = [];
  resizes: Array<[number, number]> = [];
  killed = 0;
  paused = 0;
  resumed = 0;
  private dataListeners: Array<(d: string) => void> = [];
  private exitListeners: Array<(ev: { exitCode: number }) => void> = [];

  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
    return { dispose: () => {} };
  }
  onExit(listener: (ev: { exitCode: number }) => void) {
    this.exitListeners.push(listener);
    return { dispose: () => {} };
  }
  write(data: string) { this.writes.push(data); }
  resize(cols: number, rows: number) { this.resizes.push([cols, rows]); }
  kill() {
    this.killed++;
    if (this.exitListeners.length === 0) return;
    // Real node-pty reports exit asynchronously.
    setImmediate(() => this.emitExit(0));
  }
  pause() { this.paused++; }
  resume() { this.resumed++; }

  emitData(s: string) { for (const l of this.dataListeners) l(s); }
  emitExit(code: number) { for (const l of this.exitListeners) l({ exitCode: code }); }
}

function collector() {
  const chunks: Array<{ text: string; replay: boolean }> = [];
  const sink = (chunk: Buffer, replay: boolean) => chunks.push({ text: chunk.toString(), replay });
  return { chunks, sink };
}

test('stampEnv adds identity and strips inherited supervisor markers', () => {
  const env = stampEnv(
    { PATH: 'x', EMERALD_SESSION_ID: 'old', EMERALD_HOOK_PORT: '1', ELECTRON_RUN_AS_NODE: '1', UNDEF: undefined },
    { sessionId: 'new' },
  );
  assert.deepEqual(env, { PATH: 'x', TERM: 'xterm-256color', COLORTERM: 'truecolor', EMERALD_SESSION_ID: 'new' });
  const nested = stampEnv(
    {
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_CODE_SESSION_ID: 'parent',
      CLAUDE_JOB_DIR: 'C:/jobs/x',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
      ORCA_AGENT_HOOK_PORT: '5555',
      ORCA_PANE_KEY: 'p',
    },
    { sessionId: 's' },
  );
  assert.deepEqual(nested, {
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    EMERALD_SESSION_ID: 's',
  });
  const withHook = stampEnv({}, { sessionId: 's', hookPort: 47123, hookToken: 't' });
  assert.deepEqual(withHook, {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    EMERALD_SESSION_ID: 's',
    EMERALD_HOOK_PORT: '47123',
    EMERALD_HOOK_TOKEN: 't',
  });
  // M9 fix 351: the daemon's own home and pipe pass through, so an emerald
  // command typed into a pane reaches this daemon; every other EMERALD_* is
  // still stripped, and an empty one is not passed.
  const privatePair = stampEnv(
    { EMERALD_HOME: 'C:/tmp/home', EMERALD_PIPE: '\\\\.\\pipe\\emmerd-private', EMERALD_WINDOW: 'background', EMERALD_CLAUDE_HOME: 'x', EMERALD_SESSION_ID: 'old' },
    { sessionId: 's' },
  );
  assert.deepEqual(privatePair, {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    EMERALD_HOME: 'C:/tmp/home',
    EMERALD_PIPE: '\\\\.\\pipe\\emmerd-private',
    EMERALD_SESSION_ID: 's',
  });
  assert.equal('EMERALD_PIPE' in stampEnv({ EMERALD_PIPE: '' }, { sessionId: 's' }), false);
});

test('stampEnv strips the terminal the daemon was born in and says what the pane is', () => {
  const env = stampEnv(
    {
      PATH: 'x',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      TERM_PROGRAM: 'WindowsTerminal',
      TERM_PROGRAM_VERSION: '1.22',
      WT_SESSION: 'abc',
      WT_PROFILE_ID: 'def',
      CLAUDE_CODE_SESSION_ATTENDED: '1',
      TERM: 'dumb',
      COLORTERM: 'no',
    },
    { sessionId: 's' },
  );
  assert.deepEqual(env, { PATH: 'x', TERM: 'xterm-256color', COLORTERM: 'truecolor', EMERALD_SESSION_ID: 's' });
});

test('output is batched until the flush tick', async () => {
  const fake = new FakePty();
  const s = new PtySession(fake, { flushIntervalMs: 20, earlyFlushBytes: 1000 });
  const { chunks, sink } = collector();
  s.attach(sink);
  assert.deepEqual(chunks, [{ text: '', replay: true }]);

  fake.emitData('a');
  fake.emitData('b');
  fake.emitData('c');
  assert.equal(chunks.length, 1, 'nothing delivered before the tick');
  await sleep(40);
  assert.deepEqual(chunks[1], { text: 'abc', replay: false });
  assert.equal(s.ring.readAll().toString(), 'abc');
});

test('reaching the early flush threshold delivers immediately', () => {
  const fake = new FakePty();
  const s = new PtySession(fake, { flushIntervalMs: 10_000, earlyFlushBytes: 8 });
  const { chunks, sink } = collector();
  s.attach(sink);
  fake.emitData('1234');
  assert.equal(chunks.length, 1);
  fake.emitData('5678');
  assert.deepEqual(chunks[1], { text: '12345678', replay: false });
});

test('attach replays scrollback including bytes still pending in the batch', () => {
  const fake = new FakePty();
  const s = new PtySession(fake, { flushIntervalMs: 10_000, earlyFlushBytes: 1000 });
  fake.emitData('early ');
  fake.emitData('output');
  const { chunks, sink } = collector();
  s.attach(sink);
  assert.deepEqual(chunks, [{ text: 'early output', replay: true }]);
  fake.emitData('more');
  s.detach(sink);
  fake.emitData('!');
  const second = collector();
  s.attach(second.sink);
  assert.deepEqual(second.chunks, [{ text: 'early outputmore!', replay: true }]);
  assert.equal(chunks.length, 1, 'detached sink saw nothing further');
});

test('replay is capped at the ring buffer size', () => {
  const fake = new FakePty();
  const s = new PtySession(fake, { flushIntervalMs: 10_000, earlyFlushBytes: 1000, ringBufferBytes: 5 });
  fake.emitData('abcdefgh');
  const { chunks, sink } = collector();
  s.attach(sink);
  assert.deepEqual(chunks, [{ text: 'defgh', replay: true }]);
});

test('exit flushes pending output first, then emits exit once, and later calls are no-ops', async () => {
  const fake = new FakePty();
  const s = new PtySession(fake, { flushIntervalMs: 10_000, earlyFlushBytes: 1000 });
  const { chunks, sink } = collector();
  s.attach(sink);
  const order: string[] = [];
  s.on('exit', (code) => order.push(`exit:${code}`));
  fake.emitData('bye');
  fake.emitExit(3);
  fake.emitExit(3);
  assert.deepEqual(chunks[1], { text: 'bye', replay: false });
  assert.deepEqual(order, ['exit:3']);
  assert.equal(s.exited, true);
  assert.equal(s.exitCode, 3);

  s.write('ignored');
  s.resize(10, 10);
  s.kill();
  s.pause();
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(fake.resizes, []);
  assert.equal(fake.killed, 0);
  assert.equal(fake.paused, 0);
});

test('write, resize, pause and resume pass through while alive', () => {
  const fake = new FakePty();
  const s = new PtySession(fake);
  s.write('dir\r');
  s.resize(120, 40);
  s.resize(0, -5);
  s.pause();
  s.pause();
  s.resume();
  s.resume();
  assert.deepEqual(fake.writes, ['dir\r']);
  assert.deepEqual(fake.resizes, [[120, 40], [1, 1]]);
  assert.equal(fake.paused, 1);
  assert.equal(fake.resumed, 1);
});

test('a resize past 1000 by 1000 is clamped and said once (fix 504)', () => {
  const fake = new FakePty();
  const told: string[] = [];
  const s = new PtySession(fake, { onClamp: (t) => told.push(t) });
  s.resize(40000, 20000);
  assert.deepEqual(fake.resizes, [[1000, 1000]]);
  assert.deepEqual(told, ['resize clamped to 1000x1000 from 40000x20000']);
  s.resize(5000, 10);
  assert.deepEqual(fake.resizes, [[1000, 1000], [1000, 10]]);
  assert.equal(told.length, 1, 'told once for the session');
});

test('a spawn size past the ceiling is clamped by the constructor, and the floor is 1 (fix 504)', () => {
  const told: string[] = [];
  new PtySession(new FakePty(), { cols: 5000, rows: 24, onClamp: (t) => told.push(t) });
  assert.deepEqual(told, ['resize clamped to 1000x24 from 5000x24']);
  assert.deepEqual(clampPtySize(0, 0), { cols: 1, rows: 1 });
  assert.deepEqual(clampPtySize(80.7, 24.2), { cols: 80, rows: 24 });
});

test('spawns powershell, captures its output and exit code', async () => {
  const s = PtySession.spawn({
    file: 'powershell.exe',
    args: ['-NoProfile', '-NoLogo', '-Command', 'echo hi'],
    cwd: process.cwd(),
    env: stampEnv(process.env, { sessionId: 'test-session' }),
    cols: 80,
    rows: 24,
  });
  assert.ok(s.pid > 0);
  const { chunks, sink } = collector();
  s.attach(sink);
  const [code] = await once(s, 'exit');
  assert.equal(code, 0);
  const text = chunks.map((c) => c.text).join('');
  assert.match(text, /hi/);
  assert.match(s.ring.readAll().toString(), /hi/);
  // Attaching after exit still replays the full scrollback.
  const late = collector();
  s.attach(late.sink);
  assert.equal(late.chunks.length, 1);
  assert.equal(late.chunks[0]!.replay, true);
  assert.match(late.chunks[0]!.text, /hi/);
  // The M0 gotcha: kill after exit must not throw.
  assert.doesNotThrow(() => s.kill());
});

test('a stamped env var is visible inside the spawned shell', async () => {
  const s = PtySession.spawn({
    file: 'powershell.exe',
    args: ['-NoProfile', '-NoLogo', '-Command', 'echo ("ID=" + $env:EMERALD_SESSION_ID)'],
    cwd: process.cwd(),
    env: stampEnv(process.env, { sessionId: 'abc-123' }),
    cols: 80,
    rows: 24,
  });
  await once(s, 'exit');
  assert.match(s.ring.readAll().toString(), /ID=abc-123/);
});

// M9 fix 505: the wrapper's Enter writes the C mark and then calls the
// profile's own Enter handler. $PROFILE cannot be moved on 5.1, so the
// profile is dot-sourced ahead of the wrapper, the order a real launch has.
async function shellWithProfile(profile: string): Promise<{ s: PtySession; out: () => string; waitFor: (re: RegExp, from: number, ms: number) => Promise<number> }> {
  const dir = fs.realpathSync.native(mkTemp('emerald-505-'));
  const file = path.join(dir, 'profile.ps1');
  fs.writeFileSync(file, profile);
  const s = PtySession.spawn({
    file: 'powershell.exe',
    args: ['-NoProfile', '-NoLogo', '-NoExit', '-Command', `. '${file}'; ` + PROMPT_WRAPPER],
    cwd: process.cwd(),
    env: stampEnv(process.env, { sessionId: 'test-505' }),
    cols: 120,
    rows: 30,
  });
  let text = '';
  s.on('data', (chunk: Buffer) => { text += chunk.toString('utf8'); });
  const waitFor = async (re: RegExp, from: number, ms: number): Promise<number> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const at = text.slice(from).search(re);
      if (at !== -1) return from + at;
      if (Date.now() > deadline) throw new Error(`no ${re} after ${from} in ${ms} ms; got ${JSON.stringify(text.slice(from))}`);
      await sleep(25);
    }
  };
  return { s, out: () => text, waitFor };
}

test.after(removeTemps);

const MARK_A = /\x1b\]133;A\x07/;
const MARK_C = /\x1b\]133;C\x07/;

test("a profile's script-block Enter runs after the wrapper's C mark (fix 505)", async () => {
  const { s, out, waitFor } = await shellWithProfile(
    "Set-PSReadLineKeyHandler -Key Enter -ScriptBlock { [Console]::Write('[profile-enter]'); [Microsoft.PowerShell.PSConsoleReadLine]::ValidateAndAcceptLine() }\r\n",
  );
  try {
    await waitFor(MARK_A, 0, 20_000);
    const from = out().length;
    s.write("Write-Host ('hi' + '-505')\r");
    const c = await waitFor(MARK_C, from, 10_000);
    const p = await waitFor(/\[profile-enter\]/, c, 10_000);
    await waitFor(/hi-505/, p, 10_000);
  } finally {
    s.kill();
  }
});

test("a profile's named Enter function is called after the C mark (fix 505)", async () => {
  const { s, out, waitFor } = await shellWithProfile('Set-PSReadLineKeyHandler -Key Enter -Function ValidateAndAcceptLine\r\n');
  try {
    await waitFor(MARK_A, 0, 20_000);
    const from = out().length;
    s.write('Get-Nothing505\r');
    const c = await waitFor(MARK_C, from, 10_000);
    // ValidateAndAcceptLine refuses an unknown command: no prompt follows.
    await sleep(3000);
    assert.equal(out().slice(c).search(MARK_A), -1, 'the refused line did not run');
    const again = out().length;
    s.write('\x1b');
    await sleep(300);
    s.write("Write-Host ('ok' + '-505')\r");
    const ok = await waitFor(/ok-505/, again, 10_000);
    await waitFor(MARK_A, ok, 10_000);
  } finally {
    s.kill();
  }
});

test('screen renders what a terminal would show, not the bytes as they came', async () => {
  const pty = new FakePty();
  const session = new PtySession(pty, { cols: 20, rows: 4, flushIntervalMs: 5 });
  // A prompt redrawn PSReadLine style: the first letter, a backspace, the
  // whole word, then the cursor moved back and the rest of the line erased.
  pty.emitData('PS> c\bclear\x1b[5D\x1b[K');
  pty.emitData('dir\r\nfile.txt\r\n');
  const screen = await session.screen();
  assert.deepEqual(screen.rows, ['PS> dir', 'file.txt']);
  assert.deepEqual(screen.cursor, { x: 0, y: 2 });
  // The frame flushed the ring, so the cursor it hands out is current.
  assert.equal(screen.seq, session.ring.seq);
  assert.equal(session.readSince(screen.seq).data.length, 0);
});

test('screen follows a resize', async () => {
  const pty = new FakePty();
  const session = new PtySession(pty, { cols: 20, rows: 4 });
  session.resize(5, 2);
  pty.emitData('abcdefgh');
  const screen = await session.screen();
  assert.deepEqual(screen.rows, ['abcde', 'fgh']);
});

test('the exit disposes the screen terminal and later reads answer the frame taken then (fix 502)', async () => {
  const pty = new FakePty();
  const session = new PtySession(pty, { cols: 20, rows: 4 });
  pty.emitData('PS> dir\r\n');
  pty.emitExit(0);
  const first = await session.screen();
  assert.deepEqual(first.rows, ['PS> dir']);
  assert.equal(session.screenDisposed, true);
  // Output that lands after the exit touches no disposed terminal.
  assert.doesNotThrow(() => pty.emitData('late\r\n'));
  const second = await session.screen();
  assert.deepEqual(second.rows, first.rows);
  // Each read gets copies, so one reader cannot change another's frame.
  second.rows.push('mutated');
  assert.deepEqual((await session.screen()).rows, ['PS> dir']);
});

test('readSince hands back only the new output and the next cursor', async () => {
  const pty = new FakePty();
  const session = new PtySession(pty, { flushIntervalMs: 5 });
  pty.emitData('one');
  const first = session.readSince(0);
  assert.equal(first.data.toString(), 'one');
  pty.emitData('two');
  const second = session.readSince(first.next);
  assert.equal(second.data.toString(), 'two');
  assert.equal(session.readSince(second.next).data.length, 0);
});

test('activity fires on the first byte, then at most once per interval with a trailing one', async () => {
  const pty = new FakePty();
  const session = new PtySession(pty, { activityIntervalMs: 60 });
  const seen: number[] = [];
  session.on('activity', (at: number) => seen.push(at));
  assert.equal(session.lastOutputAt, null);
  pty.emitData('a');
  assert.equal(seen.length, 1);
  pty.emitData('b');
  pty.emitData('c');
  assert.equal(seen.length, 1);
  await sleep(90);
  // The trailing one carries when the last byte came.
  assert.equal(seen.length, 2);
  assert.equal(seen[1], session.lastOutputAt);
  await sleep(90);
  assert.equal(seen.length, 2);
  pty.emitData('d');
  assert.equal(seen.length, 3);
});

test('rate reports the bytes of each window, oldest first, and stops after a set of empty ones', async () => {
  const pty = new FakePty();
  const session = new PtySession(pty, { rateWindowMs: 40, rateSamples: 4 });
  const seen: number[][] = [];
  session.on('rate', (samples: number[]) => seen.push(samples));
  // Nothing ticks while the PTY is quiet.
  await sleep(100);
  assert.equal(seen.length, 0);
  pty.emitData('abc');
  pty.emitData('de');
  await sleep(60);
  // The first window closed with the burst's bytes in it.
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], [0, 0, 0, 5]);
  pty.emitData('x');
  await sleep(40);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], [0, 0, 5, 1]);
  // Four empty windows shift the burst out, the last report is all zeros,
  // and then the timer stops: no more reports however long we wait.
  // Windows timers drift, so the wait is for the zeros, not a count.
  for (let i = 0; i < 20 && !(seen[seen.length - 1] ?? [1]).every((n) => n === 0); i++) await sleep(20);
  const count = seen.length;
  assert.deepEqual(seen[count - 1], [0, 0, 0, 0]);
  assert.equal(count, 6, `reports: ${JSON.stringify(seen)}`);
  await sleep(120);
  assert.equal(seen.length, count);
  // A new burst starts the timer again from the zeros.
  pty.emitData('yz');
  await sleep(60);
  assert.equal(seen.length, count + 1);
  assert.deepEqual(seen[count], [0, 0, 0, 2]);
  pty.emitExit(0);
  await sleep(100);
  assert.equal(seen.length, count + 1);
});
