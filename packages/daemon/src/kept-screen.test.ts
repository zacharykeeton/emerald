import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { ServerMessage, SessionInfo } from '@emerald/shared';
import { PipeClient } from '@emerald/shared/pipe-client';
import { LayoutStore } from './layout-store.ts';
import { silentLogger } from './log.ts';
import { PipeServer } from './pipe-server.ts';
import { SessionManager } from './session-manager.ts';
import { SessionStore } from './session-store.ts';

// The frame kept at a session's exit and at the daemon's stop (M9 fix
// 159): on the record, in sessions.json, answered by pty.screen and
// replayed at attach once the PTY is gone.

function tempDir(): string {
  return mkTemp('emerald-kept-');
}

test.after(removeTemps);

// A shell that prints a marker and exits, so the frame has something in it.
const markerArgs = (marker: string) => ['-NoProfile', '-Command', `Write-Host ${marker}; exit 0`];

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('the frame at a PTY exit lands on the record and in sessions.json, restores, answers pty.screen as kept, replays at attach, and a resume clears it', async () => {
  const dir = tempDir();
  const store = new SessionStore(path.join(dir, 'sessions.json'), silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  let id: string;
  try {
    const exit = once(manager, 'exit');
    id = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: markerArgs('kept-marker-one'), cols: 80, rows: 24 }).id;
    const [exited] = (await exit) as [SessionInfo];
    assert.equal(exited.exitCode, 0);
    // The frame is read once the emulator has applied the last bytes, a
    // moment after the exit itself.
    await until(() => store.load()[0]?.lastScreen !== null, 5000, 'the kept frame in the file');
    const kept = store.load()[0]!.lastScreen!;
    assert.ok(kept.rows.some((r) => r.includes('kept-marker-one')), `the frame holds the marker, got ${JSON.stringify(kept.rows)}`);
    assert.ok(kept.rows.length <= 24 && kept.cursor.y < 24, 'one screen of rows and a cursor inside it');
    // M9 fix 502: the headless terminal went at the exit, and the frame
    // taken then still answers.
    const pty = manager.get(id)!.pty!;
    assert.equal(pty.screenDisposed, true);
    assert.ok((await pty.screen()).rows.some((r) => r.includes('kept-marker-one')), 'the exit frame still answers');
  } finally {
    manager.killAll();
    manager.close();
  }

  // The daemon restarts: the frame comes back with the record.
  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  restarted.restore();
  const layouts = new LayoutStore(path.join(dir, 'state.json'), silentLogger);
  const pipe = `\\\\.\\pipe\\emmerd-test-kept-${process.pid}`;
  const server = new PipeServer(restarted, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await server.listen();
  const client = await PipeClient.connect(pipe);
  try {
    const screen = await client.request('pty.screen', { sessionId: id });
    assert.equal(screen.kept, true, 'the frame is marked kept');
    assert.ok(screen.rows.some((r) => r.includes('kept-marker-one')), 'the kept rows are the frame');
    const got: ServerMessage[] = [];
    client.on('message', (m: ServerMessage) => got.push(m));
    await client.request('pty.attach', { sessionId: id });
    assert.deepEqual(got.map((m) => m.type), ['pty.output', 'pty.exit'], 'the frame in the replay slot, then the recorded exit');
    const replay = got[0];
    assert.ok(replay !== undefined && replay.type === 'pty.output' && replay.replay === true);
    const text = Buffer.from(replay.data, 'base64').toString();
    assert.match(text, /kept-marker-one/, 'the replay is the frame');
    assert.doesNotMatch(text, /scrollback lost/, 'no lost note when a frame was kept');
    await client.request('pty.detach', { sessionId: id });

    // A resume starts over: the new PTY's screen is live, not kept.
    const exitAgain = once(restarted, 'exit');
    await client.request('session.resume', { sessionId: id, cols: 80, rows: 24 });
    assert.equal(restarted.get(id).kept, null, 'the resume drops the kept frame');
    await exitAgain;
    const live = await client.request('pty.screen', { sessionId: id });
    assert.equal(live.kept, undefined, 'a PTY the daemon saw end answers its own frame');
  } finally {
    client.close();
    await server.close();
    restarted.killAll();
    restarted.close();
  }
});

test('keepScreens reads every live frame under the timeout, saves once, and daemon.stop over the pipe answers the count', async () => {
  const dir = tempDir();
  const store = new SessionStore(path.join(dir, 'sessions.json'), silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  const layouts = new LayoutStore(path.join(dir, 'state.json'), silentLogger);
  const pipe = `\\\\.\\pipe\\emmerd-test-keep-${process.pid}`;
  let stops = 0;
  const server = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, onStop: () => stops++ });
  await server.listen();
  const client = await PipeClient.connect(pipe);
  try {
    // Two shells that stay up on their prompts, and one that has exited.
    const a = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Write-Host keep-a; Start-Sleep 30'], cols: 80, rows: 24 }).id;
    const b = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Write-Host keep-b; Start-Sleep 30'], cols: 80, rows: 24 }).id;
    const exit = once(manager, 'exit');
    const c = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: markerArgs('keep-c'), cols: 80, rows: 24 }).id;
    await exit;
    await until(() => (manager.get(a).pty?.lastOutputAt ?? null) !== null && (manager.get(b).pty?.lastOutputAt ?? null) !== null, 5000, 'both shells to write');
    const kept = await manager.keepScreens();
    // The exited shell's PTY object is still on its record, so its frame
    // is read again with the live ones.
    assert.equal(kept, 3, 'every record with a PTY');
    const byId = new Map(store.load().map((s) => [s.id, s.lastScreen]));
    assert.ok(byId.get(a)?.rows.some((r) => r.includes('keep-a')), `a's frame, got ${JSON.stringify(byId.get(a))}`);
    assert.ok(byId.get(b)?.rows.some((r) => r.includes('keep-b')), `b's frame`);
    assert.ok(byId.get(c)?.rows.some((r) => r.includes('keep-c')), `c's frame`);
    // A frame that never comes is given up, not waited on.
    const slow = manager.get(a);
    const realScreen = slow.pty!.screen.bind(slow.pty);
    slow.pty!.screen = () => new Promise(() => {});
    const t0 = Date.now();
    assert.equal(await manager.keepScreens(200), 2, 'the stuck frame is skipped');
    assert.ok(Date.now() - t0 < 2000, 'and the stop does not hang on it');
    slow.pty!.screen = realScreen;

    const reply = await client.request('daemon.stop', {});
    assert.equal(reply.kept, 3, 'the request keeps the frames and says how many');
    await until(() => stops === 1, 2000, 'the stop handler after the reply');
  } finally {
    client.close();
    await server.close();
    manager.killAll();
    manager.close();
  }
});
