import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RendererPush } from '../../preload/api.ts';
import { TerminalFeed } from './terminal-feed.ts';
import type { FeedDeps, FeedTerminal } from './terminal-feed.ts';

// A terminal that records what the feed does to it.
class FakeTerm implements FeedTerminal {
  cols = 80;
  rows = 24;
  writes: string[] = [];
  resets = 0;
  write(data: string | Uint8Array): void {
    this.writes.push(typeof data === 'string' ? data : new TextDecoder().decode(data));
  }
  reset(): void {
    this.resets += 1;
    this.writes = [];
  }
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }
}

// A pipe that records requests and fire-and-forget sends, answers every
// request at once, and lets a test push messages in.
function fakePipe() {
  const handlers = new Set<(msg: RendererPush) => void>();
  const requests: Array<{ type: string; body: unknown }> = [];
  const sends: Array<{ type: string; sessionId: string; cols?: number; rows?: number }> = [];
  let fail = false;
  const emerald: FeedDeps['emerald'] = {
    on: (fn) => {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
    request: ((type: string, body: unknown) => {
      requests.push({ type, body });
      return fail ? Promise.reject(new Error('pipe down')) : Promise.resolve({});
    }) as FeedDeps['emerald']['request'],
    send: (msg) => {
      sends.push(msg as { type: string; sessionId: string; cols?: number; rows?: number });
    },
  };
  const push = (msg: RendererPush) => {
    for (const h of handlers) h(msg);
  };
  return { emerald, requests, sends, push, setFail: (v: boolean) => (fail = v), attaches: () => requests.filter((r) => r.type === 'pty.attach').length, detaches: () => requests.filter((r) => r.type === 'pty.detach').length };
}

function setup(detachMs = 5, pidOf?: (sessionId: string) => number | null) {
  const pipe = fakePipe();
  let focused: string | null = 'p1';
  const listeners = new Set<() => void>();
  const feed = new TerminalFeed({ emerald: pipe.emerald, focusedPaneId: () => focused, onLayout: (fn) => (listeners.add(fn), () => listeners.delete(fn)), ringBytes: 64, detachMs, ...(pidOf === undefined ? {} : { pidOf }) });
  const focus = (paneId: string | null) => {
    focused = paneId;
    for (const l of listeners) l();
  };
  return { pipe, feed, focus };
}

const bytes = (s: string) => new TextEncoder().encode(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const output = (sessionId: string, text: string, replay = false): RendererPush => (replay ? { type: 'pty.output', sessionId, data: bytes(text), replay: true } : { type: 'pty.output', sessionId, data: bytes(text) });

test('two handles on one session: one attach, the ring replayed to the second at the chosen size, every chunk to both', async () => {
  const { pipe, feed } = setup();
  const t1 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  assert.equal(pipe.attaches(), 1, 'the first handle attaches');
  assert.deepEqual(pipe.sends[0], { type: 'pty.resize', sessionId: 's1', cols: 100, rows: 30 }, 'the size goes first');
  assert.equal(t1.cols, 100);
  pipe.push(output('s1', 'replayed ', true));
  pipe.push(output('s1', 'live1 '));
  assert.deepEqual(t1.writes, ['replayed ', 'live1 ']);

  const t2 = new FakeTerm();
  const h2 = feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 60, rows: 20 } });
  assert.equal(pipe.attaches(), 1, 'the second handle does not attach');
  assert.deepEqual([t2.cols, t2.rows], [100, 30], 'resized to the chosen size before the ring is written');
  assert.deepEqual(t2.writes, ['replayed live1 '], 'the ring, in one write');
  pipe.push(output('s1', 'live2'));
  assert.deepEqual(t1.writes.at(-1), 'live2');
  assert.deepEqual(t2.writes.at(-1), 'live2');
  assert.equal(pipe.sends.length, 1, 'the focused pane p1 keeps the size; p2 changed nothing');

  h1.close();
  await sleep(20);
  assert.equal(pipe.detaches(), 0, 'one handle left: no detach');
  h2.close();
  await sleep(20);
  assert.equal(pipe.detaches(), 1, 'the last close detaches');
});

test('a handle opened while the first attach is in flight is written the ring and does not attach again', () => {
  const { pipe, feed } = setup();
  const t1 = new FakeTerm();
  feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  const t2 = new FakeTerm();
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  assert.equal(pipe.attaches(), 1);
  pipe.push(output('s1', 'replay', true));
  assert.deepEqual(t1.writes, ['replay']);
  assert.deepEqual(t2.writes, ['replay'], 'the replay reaches both, once each');
});

test('the focused pane sizes the PTY; focus elsewhere keeps the last choice; a closed choice falls back', () => {
  const { pipe, feed, focus } = setup();
  const t1 = new FakeTerm();
  const t2 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 60, rows: 20 } });
  focus('p2');
  assert.deepEqual(pipe.sends.at(-1), { type: 'pty.resize', sessionId: 's1', cols: 60, rows: 20 }, 'p2 focused: its size');
  assert.deepEqual([t1.cols, t1.rows], [60, 20], 'every terminal follows');
  const count = pipe.sends.length;
  focus('p9');
  assert.equal(pipe.sends.length, count, 'a third pane focused: nothing sent');
  h1.report({ cols: 120, rows: 40 });
  assert.equal(pipe.sends.length, count, 'the unchosen pane growing changes nothing');
  focus('p1');
  assert.deepEqual(pipe.sends.at(-1), { type: 'pty.resize', sessionId: 's1', cols: 120, rows: 40 }, 'p1 focused: its new size');
  focus('p9');
  h1.close();
  assert.deepEqual(pipe.sends.at(-1), { type: 'pty.resize', sessionId: 's1', cols: 60, rows: 20 }, 'the chosen pane gone: the first with a size');
});

test('a lone pane that reports a size later attaches then, and a resize under no focus still lands', () => {
  const { pipe, feed, focus } = setup();
  focus(null);
  const t1 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: null });
  assert.equal(pipe.attaches(), 0, 'no size yet: no attach');
  h1.report({ cols: 90, rows: 25 });
  assert.equal(pipe.attaches(), 1);
  assert.deepEqual(pipe.sends.at(-1), { type: 'pty.resize', sessionId: 's1', cols: 90, rows: 25 });
  h1.report({ cols: 91, rows: 25 });
  assert.deepEqual(pipe.sends.at(-1), { type: 'pty.resize', sessionId: 's1', cols: 91, rows: 25 }, 'a window resize under an unfocused pane');
  h1.report(null);
  assert.deepEqual(pipe.sends.at(-1), { type: 'pty.resize', sessionId: 's1', cols: 91, rows: 25 }, 'hidden by zoom: the size stays');
});

test('reattach clears the ring, resets every terminal and attaches once; reconnect goes through it', async () => {
  const { pipe, feed } = setup();
  const t1 = new FakeTerm();
  const t2 = new FakeTerm();
  feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  pipe.push(output('s1', 'old', true));
  feed.reattach('s1');
  feed.reattach('s1');
  assert.equal(pipe.attaches(), 2, 'one attach for the two calls');
  assert.equal(t1.resets, 1);
  assert.equal(t2.resets, 1);
  pipe.push(output('s1', 'new', true));
  const t3 = new FakeTerm();
  feed.open('s1', t3, { paneId: () => 'p3', fit: { cols: 100, rows: 30 } });
  assert.deepEqual(t3.writes, ['new'], 'the ring holds only what came after the reattach');
  await sleep(1);
  pipe.push({ type: 'daemon.connected', daemon: { pid: 1, version: 'x', featureLevel: 1, otherHome: null } });
  assert.equal(pipe.attaches(), 3, 'a reconnect attaches again');
  assert.equal(t3.resets, 1);
});

test('the exit note goes into the ring, and a failed attach is written to every handle', async () => {
  const { pipe, feed } = setup();
  const t1 = new FakeTerm();
  feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  pipe.push({ type: 'pty.exit', sessionId: 's1', exitCode: 3 });
  assert.match(t1.writes.at(-1) ?? '', /process exited with code 3/);
  const t2 = new FakeTerm();
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  assert.match(t2.writes.at(-1) ?? '', /process exited with code 3/, 'a mirror opened on an exited session shows the note');
  pipe.setFail(true);
  feed.reattach('s1');
  await sleep(1);
  assert.match(t1.writes.at(-1) ?? '', /cannot attach: pipe down/);
  assert.match(t2.writes.at(-1) ?? '', /cannot attach: pipe down/);
});

test('a handle opened within the detach delay keeps the attachment and its ring', async () => {
  const { pipe, feed } = setup(30);
  const t1 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  pipe.push(output('s1', 'kept', true));
  h1.close();
  const t2 = new FakeTerm();
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  await sleep(50);
  assert.equal(pipe.detaches(), 0);
  assert.equal(pipe.attaches(), 1);
  assert.deepEqual(t2.writes, ['kept']);
});

test('a handle opened within the detach delay on a session whose process changed starts over (M9 fix 842)', async () => {
  let pid: number | null = 100;
  const { pipe, feed } = setup(30, () => pid);
  const t1 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  pipe.push(output('s1', 'old screen', true));
  h1.close();
  pid = 200;
  const t2 = new FakeTerm();
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  assert.ok(!t2.writes.some((w) => w.includes('old screen')), `the new pane holds none of the old process's screen, got ${JSON.stringify(t2.writes)}`);
  assert.equal(t2.resets, 1, 'the new terminal is reset once');
  assert.equal(pipe.attaches(), 2, 'one attach for the new process');
  pipe.push(output('s1', 'new', true));
  assert.deepEqual(t2.writes, ['new']);
  await sleep(50);
  assert.equal(pipe.detaches(), 0);
});

test('a handle opened within the detach delay on the same process keeps the ring (M9 fix 842)', async () => {
  const { pipe, feed } = setup(30, () => 100);
  const t1 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  pipe.push(output('s1', 'kept', true));
  h1.close();
  const t2 = new FakeTerm();
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  await sleep(50);
  assert.deepEqual(t2.writes, ['kept']);
  assert.equal(pipe.attaches(), 1);
});

test('an exited session moved inside the detach delay keeps its ring (M9 fix 842)', async () => {
  let pid: number | null = 100;
  const { pipe, feed } = setup(30, () => pid);
  const t1 = new FakeTerm();
  const h1 = feed.open('s1', t1, { paneId: () => 'p1', fit: { cols: 100, rows: 30 } });
  pipe.push(output('s1', 'kept', true));
  pid = null;
  h1.close();
  const t2 = new FakeTerm();
  feed.open('s1', t2, { paneId: () => 'p2', fit: { cols: 100, rows: 30 } });
  await sleep(50);
  assert.deepEqual(t2.writes, ['kept']);
  assert.equal(pipe.attaches(), 1);
});
