import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTemp, removeTemps, removeWithPatience } from '@emerald/shared/test-temp';
import type { ServerMessage, SessionInfo, SessionTask } from '@emerald/shared';
import { COLOR_FLOOR, SESSION_COLORS, colorDistance, currentTab, folderName, pickSessionColor, replaceTab, setPaneSession } from '@emerald/shared';
import { PipeClient } from '@emerald/shared/pipe-client';
import { readBranch } from './git-branch.ts';
import { LayoutStore } from './layout-store.ts';
import { silentLogger } from './log.ts';
import type { Logger } from './log.ts';
import { PipeServer } from './pipe-server.ts';
import { SessionManager, resumePlan } from './session-manager.ts';
import type { LoadTick } from './session-manager.ts';
import { SessionStore } from './session-store.ts';
import { findShells } from './shells.ts';

function tempDir(): string {
  return mkTemp('emerald-manager-');
}

test.after(removeTemps);

// A logger that keeps what the store says, error included, for the restart
// tests whose restored list once came back empty with the reason swallowed
// by the silent logger (M9 fix 708).
function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const keep = (level: string) => (msg: string, err?: unknown) => {
    lines.push(`${level} ${msg}${err === undefined ? '' : ` ${(err as NodeJS.ErrnoException).code ?? String(err)}`}`);
  };
  return { lines, info: keep('info'), warn: keep('warn'), error: keep('error') };
}

// The message of a restart test's assert on the restored list.
const restoredMessage = (log: { lines: string[] }, restarted: SessionManager): string =>
  `restored with the session; store log: ${log.lines.join(' | ') || 'empty'}; restored ${restarted.list().length}`;

// A shell that exits on its own with a known code, so the test does not
// have to kill anything or wait on a prompt.
const exitArgs = (code: number) => ['-NoProfile', '-Command', `exit ${code}`];

test('every change lands in sessions.json, and a new manager restores the list as exited', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sessions.json');
  const store = new SessionStore(file, silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const exit = once(manager, 'exit');
    const spawned = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(7), cols: 80, rows: 24 });
    const afterSpawn = store.load();
    assert.equal(afterSpawn.length, 1, 'written on spawn');
    assert.equal(afterSpawn[0]!.id, spawned.id);
    assert.equal(afterSpawn[0]!.exitCode, null, 'live sessions carry no exit');
    assert.deepEqual(spawned.args, exitArgs(7), 'the spawn args are part of the session');
    assert.deepEqual(afterSpawn[0]!.args, exitArgs(7), 'and of the file');
    assert.ok((SESSION_COLORS as readonly string[]).includes(spawned.color ?? ''), 'a palette colour on spawn');
    assert.equal(afterSpawn[0]!.color, spawned.color, 'the colour is in the file');

    assert.equal(spawned.name, folderName(process.cwd()), 'named after the folder');
    assert.equal(spawned.autoName, true);
    manager.rename(spawned.id, 'renamed');
    assert.equal(store.load()[0]!.name, 'renamed', 'written on rename');
    assert.equal(store.load()[0]!.autoName, false, 'a chosen name is remembered as chosen');

    const [exited] = (await exit) as [SessionInfo];
    assert.equal(exited.exitCode, 7);
    const onDisk = store.load()[0]!;
    assert.equal(onDisk.exitCode, 7, 'written on exit');
    assert.equal(onDisk.exitedAt, exited.stateSince);
  } finally {
    manager.killAll();
    manager.close();
  }

  // Simulate a daemon restart: a fresh manager on the same file.
  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    restarted.restore();
    const [s] = restarted.list();
    assert.ok(s !== undefined);
    assert.equal(s.name, 'renamed');
    assert.equal(s.state, 'exited');
    assert.equal(s.exitCode, 7);
    assert.equal(s.pid, null);
    assert.equal(s.color, store.load()[0]!.color, 'the colour comes back with the session');
    assert.equal(restarted.get(s.id).pty, null, 'no PTY behind a restored session');
    // Nothing to kill, nothing to crash on.
    restarted.kill(s.id);
    restarted.killAll();
    // The restored session resumes with the args it was started with, so
    // the same exit command runs again and reports the same code.
    assert.deepEqual(s.args, exitArgs(7), 'args survive the restart');
    const exitAgain = once(restarted, 'exit');
    const resumed = restarted.resume(s.id, 80, 24);
    assert.deepEqual(resumed.args, exitArgs(7));
    assert.equal(resumed.color, s.color, 'a resume keeps the colour');
    const [again] = (await exitAgain) as [SessionInfo];
    assert.equal(again.exitCode, 7, 'resumed with the same args');
    // A restored session persists again on its next change, so a rename
    // survives a second restart too.
    restarted.rename(s.id, 'renamed twice');
    assert.equal(store.load()[0]!.name, 'renamed twice');
    // An empty rename hands the name back to the folder.
    restarted.rename(s.id, '  ');
    assert.equal(restarted.list()[0]!.name, folderName(process.cwd()));
    assert.equal(store.load()[0]!.autoName, true);
  } finally {
    restarted.close();
  }
});

test('a pty exit with no code is kept as unknown and survives a restart (M9 fix 831)', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sessions.json');
  const store = new SessionStore(file, silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 30'], cols: 80, rows: 24 });
    const exit = once(manager, 'exit');
    // node-pty cannot be made to give no code, so the PtySession's own
    // event is raised by hand; the real pty is killed in the finally.
    manager.get(s.id).pty!.emit('exit', undefined);
    const [exited] = (await exit) as [SessionInfo];
    assert.strictEqual(exited.exitCode, null, 'the event carries null, not undefined');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessions: Array<Record<string, unknown>> };
    const entry = raw.sessions.find((e) => e['id'] === s.id)!;
    assert.ok(Object.hasOwn(entry, 'exitCode'), 'the file keeps the key');
    assert.strictEqual(entry['exitCode'], null);
    const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
    try {
      restarted.restore();
      const back = restarted.list().find((x) => x.id === s.id);
      assert.ok(back !== undefined, 'the restart keeps the session');
      assert.equal(back.state, 'exited');
      assert.strictEqual(back.exitCode, null);
    } finally {
      restarted.close();
    }
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('set writes the checkpoint one field at a time, persists it, and a resume keeps it', async () => {
  const dir = tempDir();
  const store = new SessionStore(path.join(dir, 'sessions.json'), silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const exit = once(manager, 'exit');
    const { id } = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    assert.equal(manager.get(id).info.comment, null);
    assert.equal(manager.get(id).info.phase, null);

    manager.set(id, { comment: '  reproduced the bug; testing a fix  ' });
    assert.equal(manager.get(id).info.comment, 'reproduced the bug; testing a fix', 'trimmed');
    assert.equal(manager.get(id).info.phase, null, 'a comment alone leaves the phase');
    manager.set(id, { phase: 'in-progress' });
    assert.equal(manager.get(id).info.comment, 'reproduced the bug; testing a fix', 'a phase alone leaves the comment');
    assert.equal(manager.get(id).info.phase, 'in-progress');
    assert.equal(store.load()[0]!.comment, 'reproduced the bug; testing a fix', 'written to the file');
    assert.equal(store.load()[0]!.phase, 'in-progress');

    // The record is replaced only when something changed, so a no-op set
    // pushes nothing to subscribers or to disk.
    const before = manager.get(id).info;
    manager.set(id, {});
    manager.set(id, { phase: 'in-progress', comment: 'reproduced the bug; testing a fix' });
    assert.equal(manager.get(id).info, before, 'nothing changed, nothing pushed');
    manager.set(id, { comment: '   ' });
    assert.equal(manager.get(id).info.comment, null, 'a blank comment clears it');
    manager.set(id, { comment: 'fix is in', phase: null });
    assert.equal(manager.get(id).info.phase, null, 'null clears the phase');
    // The colour (M29) goes the same way: a set replaces the one picked at
    // spawn, the file has it, a set to the same colour pushes nothing.
    const other = SESSION_COLORS.find((c) => c !== manager.get(id).info.color)!;
    manager.set(id, { color: other });
    assert.equal(manager.get(id).info.color, other);
    assert.equal(store.load()[0]!.color, other, 'the colour is written to the file');
    const colored = manager.get(id).info;
    manager.set(id, { color: other });
    assert.equal(manager.get(id).info, colored, 'the same colour again changes nothing');
    // The colour scheme (M9 fix 244): none at spawn, a set names one and
    // the file has it, null clears it back to the window's.
    assert.equal(manager.get(id).info.scheme, null, "a new session wears the window's scheme");
    manager.set(id, { scheme: 'Solarized Dark' });
    assert.equal(manager.get(id).info.scheme, 'Solarized Dark');
    assert.equal(store.load()[0]!.scheme, 'Solarized Dark', 'the scheme is written to the file');
    const schemed = manager.get(id).info;
    manager.set(id, { scheme: 'Solarized Dark' });
    assert.equal(manager.get(id).info, schemed, 'the same scheme again changes nothing');
    manager.set(id, { scheme: null });
    assert.equal(manager.get(id).info.scheme, null, 'null clears the scheme');
    assert.equal(store.load()[0]!.scheme, null, 'the clear is written to the file');
    // A status line lands the model and the context fill on the record;
    // the resume below starts them over (M9 fix 39), since they describe
    // the process that is gone.
    manager.applyHook(id, { hook_event_name: 'SessionStart', session_id: 'c1', source: 'startup' }, Date.now());
    manager.applyHook(id, { hook_event_name: 'StatusLine', session_id: 'c1', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 21 } }, Date.now());
    assert.equal(manager.get(id).info.model, 'Opus 5');
    assert.equal(manager.get(id).info.contextPercent, 21);

    await exit;
    assert.equal(manager.get(id).info.model, 'Opus 5', 'an exited session keeps its last reading');
    const resumed = manager.resume(id, 80, 24);
    assert.equal(resumed.comment, 'fix is in', 'a resume keeps the checkpoint');
    assert.equal(resumed.color, other, 'and the set colour');
    assert.equal(resumed.model, null, 'a resume starts the model over');
    assert.equal(resumed.contextPercent, null, 'and the context fill');
    await once(manager, 'exit');
    assert.throws(() => manager.set('nope', { comment: 'x' }), /no session nope/);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('compactAsk skips the engine\'s own compaction of a Claude session marked to keep whole while it is idle, waiting or done, and nothing else; a shell cannot be marked (M9 fix 773)', async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const claude: SessionInfo = {
    id: 'keep-1', kind: 'claude', name: 'proj', spawnCwd: process.cwd(), args: [], autoName: true, branch: null, lastPrompt: null, lastReply: null,
    cwd: process.cwd(), groupCwd: process.cwd(), state: 'idle', stateSince: 1000, lastEventAt: 1000, stale: false, needsInputReason: null, errorType: null,
    waitingOn: [], team: [], conversation: null, shellCwd: null, commits: [], model: null, contextPercent: null, contextWindow: null, tokens: null,
    comment: null, phase: null, color: '#61afef', title: null, transcriptPath: null, liveReply: null, liveTool: null, claudeSessionId: 'c-1',
    remoteSessionId: null, startHead: null, pid: 1, exitCode: null, createdAt: 1000,
  };
  store.save([claude]);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    manager.restore();
    // A restored session is exited; the rule reads the state alone, so
    // the record is put in each state by hand.
    const at = (state: SessionInfo['state']) => {
      const rec = manager.get('keep-1');
      rec.info = { ...rec.info, state };
    };
    at('idle');
    assert.equal(manager.compactAsk('keep-1', 'auto'), null, 'not marked: let through');
    manager.set('keep-1', { keepWhole: true });
    assert.equal(manager.get('keep-1').info.keepWhole, true);
    assert.equal(store.load().find((p) => p.id === 'keep-1')!.keepWhole, true, 'the mark is written to the file');
    for (const state of ['idle', 'waiting', 'done'] as const) {
      at(state);
      assert.equal(manager.compactAsk('keep-1', 'auto'), 'kept whole while idle by emerald', `auto at ${state}`);
      assert.equal(manager.compactAsk('keep-1', 'precompute'), 'kept whole while idle by emerald', `precompute at ${state}`);
      assert.equal(manager.compactAsk('keep-1', 'manual'), null, `manual at ${state}`);
      assert.equal(manager.compactAsk('keep-1', 'plugin'), null, `plugin at ${state}`);
    }
    for (const state of ['working', 'needs-input'] as const) {
      at(state);
      assert.equal(manager.compactAsk('keep-1', 'auto'), null, `a full window's mid-turn at ${state}`);
    }
    at('idle');
    const marked = manager.get('keep-1').info;
    manager.set('keep-1', { keepWhole: true });
    assert.equal(manager.get('keep-1').info, marked, 'the same mark again changes nothing');
    manager.set('keep-1', { keepWhole: false });
    assert.equal(manager.compactAsk('keep-1', 'auto'), null, 'unmarked: let through');
    assert.equal(store.load().find((p) => p.id === 'keep-1')!.keepWhole, false);
    assert.equal(manager.compactAsk('nope', 'auto'), null, 'an unknown session: let through');

    const { id } = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    const shell = manager.get(id).info;
    const refused = (err: Error & { code?: string }) => err.code === 'bad-request' && /keep whole is for a session with Claude running in it; .* is a shell with none/.test(err.message);
    assert.throws(() => manager.set(id, { keepWhole: true, comment: 'x' }), refused);
    assert.equal(manager.get(id).info, shell, 'refused before any field is applied');
    manager.set(id, { keepWhole: false });
    assert.equal(manager.get(id).info, shell, 'false on a shell changes nothing');

    // M9 fix 833: a shell with Claude running in it can be marked, and the
    // mark goes when that Claude leaves.
    const { id: id2 } = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 30'], cols: 80, rows: 24 });
    manager.applyHook(id2, { hook_event_name: 'SessionStart', session_id: 'c-hosted', source: 'startup' }, Date.now());
    manager.set(id2, { keepWhole: true });
    assert.equal(manager.get(id2).info.keepWhole, true, 'a hosted shell is marked');
    assert.equal(store.load().find((p) => p.id === id2)!.keepWhole, true, 'and the mark is written');
    const hosted = manager.get(id2);
    hosted.info = { ...hosted.info, state: 'idle' };
    assert.equal(manager.compactAsk(id2, 'auto'), 'kept whole while idle by emerald', 'its idle compaction is skipped');
    manager.applyHook(id2, { hook_event_name: 'SessionEnd', session_id: 'c-hosted', reason: 'prompt_input_exit' }, Date.now());
    assert.equal(manager.get(id2).info.keepWhole, false, "the mark goes with the shell's Claude");
    assert.equal(manager.get(id2).info.claudeSessionId, null);
    assert.throws(() => manager.set(id2, { keepWhole: true }), refused, 'a plain shell again is refused');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("launchedWithMod answers for a shell while Claude runs in it, and not for a plain one (M9 fix 833)", () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, claudeModDir: 'C:\\e\\cli\\mod' });
  try {
    const { id } = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 30'], cols: 80, rows: 24 });
    assert.equal(manager.launchedWithMod(id), false, 'a plain shell');
    manager.applyHook(id, { hook_event_name: 'SessionStart', session_id: 'c-833', source: 'startup' }, Date.now());
    assert.equal(manager.launchedWithMod(id), true, 'a shell with Claude running in it');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('the commit a session started on is read in its start folder at spawn, persisted, restored and kept through a resume (M9 fix 117)', async () => {
  const dir = tempDir();
  const log = recordingLogger();
  const store = new SessionStore(path.join(dir, 'sessions.json'), log);
  const reads: string[] = [];
  let head: string | null = 'a'.repeat(40);
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return head;
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const exit = once(manager, 'exit');
    const { id } = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    assert.equal(manager.get(id).info.startHead, null, 'null until git answers');
    await settle();
    assert.equal(manager.get(id).info.startHead, 'a'.repeat(40));
    assert.deepEqual(reads, [process.cwd()], 'read once, in the start folder');
    assert.equal(store.load()[0]!.startHead, 'a'.repeat(40), 'written to the file');
    await exit;
    head = 'b'.repeat(40);
    const resumed = manager.resume(id, 80, 24);
    await settle();
    assert.equal(resumed.startHead, 'a'.repeat(40), 'a resume keeps the start: it is the same session');
    assert.equal(manager.get(id).info.startHead, 'a'.repeat(40));
    assert.equal(reads.length, 1, 'not read again on resume');
    await once(manager, 'exit');
    // A folder outside any repository leaves it null.
    head = null;
    const outside = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    await settle();
    assert.equal(manager.get(outside.id).info.startHead, null);
    await once(manager, 'exit');
  } finally {
    manager.killAll();
    manager.close();
  }
  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead });
  try {
    restarted.restore();
    const kept = restarted.list().find((s) => s.startHead !== null);
    assert.ok(kept !== undefined && kept.startHead === 'a'.repeat(40), restoredMessage(log, restarted));
  } finally {
    restarted.close();
  }
});

test('an exited session frees its colour for the next spawn (M59)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const exit = once(manager, 'exit');
    const a = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    const live = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 60'], cols: 80, rows: 24 });
    assert.notEqual(live.color, a.color, 'a live session takes another colour');
    await exit;
    assert.equal(manager.get(a.id).info.state, 'exited');
    const b = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    assert.equal(b.color, a.color, "the exited session's colour is picked again");
    assert.notEqual(b.color, live.color, 'the live one is still avoided');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('an exited or removed session with a commit in the last day keeps its colour out of the pool; an older commit frees it (M68)', async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  let head = 'a'.repeat(40);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead: async () => head });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  // A shell that exits at once, with a commit posted while it is still
  // up when `commitAt` is given (a hook on an exited session would move
  // it back to working, which is not the case under test).
  const spawnExited = async (commitAt?: number) => {
    const exit = once(manager, 'exit');
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    if (commitAt !== undefined) {
      manager.applyHook(s.id, { hook_event_name: 'PostToolUse', session_id: 'c1', tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, commitAt);
      await settle();
    }
    await exit;
    return s;
  };
  try {
    const a = await spawnExited(Date.now());
    assert.equal(manager.get(a.id).info.state, 'exited');
    assert.equal(manager.get(a.id).info.commits.length, 1);
    const b = await spawnExited();
    assert.notEqual(b.color, a.color, 'an exited session with a fresh commit keeps its colour taken, its lane is still on the graph');
    const c = await spawnExited();
    assert.equal(c.color, b.color, 'an exited session with no commit frees its colour at once, as M59 had it');
    manager.remove(a.id);
    const d = await spawnExited();
    assert.notEqual(d.color, a.color, 'a removed session with a fresh commit keeps its colour taken too');
    head = 'b'.repeat(40);
    const e = await spawnExited(Date.now() - 2 * 24 * 60 * 60 * 1000);
    assert.equal(manager.get(e.id).info.commits.length, 1, 'the old commit is on the record');
    const f = await spawnExited();
    assert.equal(f.color, e.color, 'a commit older than a day reserves nothing');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a new session is kept far from the live sessions of its own repository, a worktree counting as the repository (M9 fix 133)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  const repoA = tempDir();
  const repoB = tempDir();
  const worktree = tempDir();
  const wtGit = path.join(repoA, '.git', 'worktrees', 'wt');
  fs.mkdirSync(wtGit, { recursive: true });
  fs.mkdirSync(path.join(repoB, '.git'));
  fs.writeFileSync(path.join(repoA, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(repoB, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/feature\n');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${wtGit}\n`);
  const live = (cwd: string) => manager.spawn({ kind: 'shell', cwd, args: ['-NoProfile', '-Command', 'Start-Sleep 60'], cols: 80, rows: 24 });
  try {
    const a = live(repoA);
    const b = live(repoB);
    assert.equal(b.color, pickSessionColor([a.color]), 'no peer in the other repository: the pick over the taken alone');
    const c = live(repoA);
    assert.equal(c.color, pickSessionColor([a.color, b.color], [a.color]), 'a peer in the same repository: the free colour farthest from it');
    assert.notEqual(c.color, b.color);
    const d = live(worktree);
    assert.equal(d.color, pickSessionColor([a.color, b.color, c.color], [a.color, c.color]), 'a worktree of the repository has its sessions as peers');
    for (const [x, y] of [
      [a, c],
      [a, d],
      [c, d],
    ]) assert.ok(colorDistance(x!.color!, y!.color!) > COLOR_FLOOR, `${x!.color} and ${y!.color} tell apart on one graph`);
    const e = live(repoB);
    assert.equal(e.color, pickSessionColor([a.color, b.color, c.color, d.color], [b.color]), "the other repository's peer is b alone");
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a session that was live when the daemon died restores with no exit code', () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  store.save([
    {
      id: 'live-1',
      kind: 'claude',
      name: 'proj',
      spawnCwd: process.cwd(),
      args: [],
      autoName: true,
      branch: null,
      lastPrompt: null,
      lastReply: null,
      cwd: process.cwd(),
      groupCwd: process.cwd(),
      state: 'working',
      stateSince: 1000,
      lastEventAt: 1000,
      stale: false,
      needsInputReason: null,
      errorType: null,
      waitingOn: [],
      team: [],
      conversation: null,
      shellCwd: null,
      commits: [],
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      comment: null,
      phase: null,
      color: '#61afef',
      title: null,
      transcriptPath: null,
      liveReply: null,
      liveTool: null,
      claudeSessionId: 'c-1',
      remoteSessionId: null,
      startHead: null,
      pid: 1,
      exitCode: null,
      createdAt: 1000,
    },
  ]);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const before = Date.now();
    manager.restore();
    const [s] = manager.list();
    assert.equal(s?.state, 'exited');
    assert.equal(s?.exitCode, null);
    assert.equal(s?.claudeSessionId, 'c-1', 'kept for claude --resume');
    assert.ok(s!.stateSince >= before, 'counted as exited from the restart');
    // Restoring twice does not duplicate.
    manager.restore();
    assert.equal(manager.list().length, 1);
  } finally {
    manager.close();
  }
});

test('a restored session keeps its transcript path, and a resume keeps it until the new process names one (M9 fix 804)', () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const transcript = path.join(tempDir(), 'kept.jsonl');
  store.save([
    {
      id: 'kept-804',
      kind: 'shell',
      name: 'proj',
      spawnCwd: process.cwd(),
      args: ['-NoProfile', '-Command', 'Start-Sleep 60'],
      autoName: true,
      branch: null,
      lastPrompt: null,
      lastReply: null,
      cwd: process.cwd(),
      groupCwd: process.cwd(),
      state: 'exited',
      stateSince: 1000,
      lastEventAt: 1000,
      stale: false,
      needsInputReason: null,
      errorType: null,
      waitingOn: [],
      team: [],
      conversation: null,
      shellCwd: null,
      commits: [],
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      comment: null,
      phase: null,
      color: '#61afef',
      title: null,
      transcriptPath: transcript,
      liveReply: null,
      liveTool: null,
      // No session id, so the resume types nothing into the shell.
      claudeSessionId: 'c-1',
      remoteSessionId: null,
      startHead: null,
      pid: null,
      exitCode: 0,
      createdAt: 1000,
    },
  ]);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    manager.restore();
    const [s] = manager.list();
    assert.equal(s?.transcriptPath, transcript, 'the chat face of a restored session has its transcript to draw');
    const resumed = manager.resume('kept-804', 80, 24);
    assert.equal(resumed.transcriptPath, transcript, 'the resume carries on in the same transcript until a SessionStart names another');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('over the pipe: a restored session lists, attaches with a note, reads empty and ignores input', async () => {
  const dir = tempDir();
  const store = new SessionStore(path.join(dir, 'sessions.json'), silentLogger);
  store.save([
    {
      id: 'old-1',
      kind: 'shell',
      name: 'old shell',
      spawnCwd: process.cwd(),
      args: [],
      autoName: true,
      branch: null,
      lastPrompt: null,
      lastReply: null,
      cwd: process.cwd(),
      groupCwd: process.cwd(),
      state: 'exited',
      stateSince: 5000,
      lastEventAt: null,
      stale: false,
      needsInputReason: null,
      errorType: null,
      waitingOn: [],
      team: [],
      conversation: null,
      shellCwd: null,
      commits: [],
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      comment: null,
      phase: null,
      color: '#61afef',
      title: null,
      transcriptPath: null,
      liveReply: null,
      liveTool: null,
      claudeSessionId: null,
      remoteSessionId: null,
      startHead: null,
      pid: null,
      exitCode: 0,
      createdAt: 1000,
    },
  ]);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  manager.restore();
  const layouts = new LayoutStore(path.join(dir, 'state.json'), silentLogger);
  const pipe = `\\\\.\\pipe\\emmerd-test-restore-${process.pid}`;
  const server = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await server.listen();
  const client = await PipeClient.connect(pipe);
  try {
    const { sessions } = await client.request('session.list', {});
    assert.deepEqual(
      sessions.map((s) => [s.id, s.name, s.state, s.exitCode]),
      [['old-1', 'old shell', 'exited', 0]],
    );
    const got: ServerMessage[] = [];
    client.on('message', (m: ServerMessage) => got.push(m));
    await client.request('pty.attach', { sessionId: 'old-1' });
    assert.deepEqual(got.map((m) => m.type), ['pty.output', 'pty.exit']);
    const replay = got[0];
    assert.ok(replay !== undefined && replay.type === 'pty.output' && replay.replay === true);
    assert.match(Buffer.from(replay.data, 'base64').toString(), /scrollback lost/);
    const exit = got[1];
    assert.ok(exit !== undefined && exit.type === 'pty.exit' && exit.exitCode === 0);

    const read = await client.request('session.read', { sessionId: 'old-1' });
    assert.equal(read.data, '');
    // Neither of these may throw or drop the connection.
    client.send({ type: 'pty.input', sessionId: 'old-1', data: 'dir\r' });
    client.send({ type: 'pty.resize', sessionId: 'old-1', cols: 10, rows: 5 });
    await client.request('pty.detach', { sessionId: 'old-1' });
    await client.request('session.kill', { sessionId: 'old-1' });
    assert.equal((await client.request('session.list', {})).sessions.length, 1, 'connection still up');
  } finally {
    client.close();
    await server.close();
    manager.close();
  }
});

test('resumePlan: a Claude session goes back to its conversation folder with --resume, a shell that hosted one gets the line typed (M48)', () => {
  const conv = { id: 'abc', cwd: 'C:\\work\\proj\\sub', args: ['--model', 'opus'] };
  assert.deepEqual(resumePlan({ kind: 'claude', claudeSessionId: 'abc', args: ['--model', 'opus'], spawnCwd: 'C:\\work\\proj', conversation: conv }), { cwd: 'C:\\work\\proj\\sub', args: ['--model', 'opus', '--resume', 'abc'], typed: null });
  // Ours goes last, so a session started with --resume old picks up the bound one.
  assert.deepEqual(resumePlan({ kind: 'claude', claudeSessionId: 'abc', args: ['--resume', 'old'], spawnCwd: 'C:\\work', conversation: { ...conv, args: ['--resume', 'old'] } }).args, ['--resume', 'old', '--resume', 'abc']);
  // A bound id with no conversation still resumes, in the spawn folder.
  assert.deepEqual(resumePlan({ kind: 'claude', claudeSessionId: 'abc', args: [], spawnCwd: 'C:\\work', conversation: null }), { cwd: 'C:\\work', args: ['--resume', 'abc'], typed: null });
  // Nothing behind it: the spawn folder and the args, as before.
  assert.deepEqual(resumePlan({ kind: 'claude', claudeSessionId: null, args: ['--model', 'opus'], spawnCwd: 'C:\\work', conversation: null }), { cwd: 'C:\\work', args: ['--model', 'opus'], typed: null });
  assert.deepEqual(resumePlan({ kind: 'shell', claudeSessionId: null, args: ['-NoProfile'], spawnCwd: 'C:\\work', conversation: null }), { cwd: 'C:\\work', args: ['-NoProfile'], typed: null });
  // A shell that hosted a conversation: a shell again, where Claude was,
  // with the line to type; the shell's own args, not Claude's.
  assert.deepEqual(resumePlan({ kind: 'shell', claudeSessionId: null, args: ['-NoProfile'], spawnCwd: 'C:\\work', conversation: { id: 'abc', cwd: 'C:\\work\\sub', args: [] } }), { cwd: 'C:\\work\\sub', args: ['-NoProfile'], typed: 'claude --resume abc' });
  // Killed with Claude still inside: the bound id is the conversation.
  assert.deepEqual(resumePlan({ kind: 'shell', claudeSessionId: 'abc', args: [], spawnCwd: 'C:\\work', conversation: { id: 'abc', cwd: 'C:\\work\\sub', args: [] } }).typed, 'claude --resume abc');
});

test('resumePlan: a malformed saved id resumes like none, nothing typed and no --resume (M9 fix 508)', () => {
  const bad = { id: 'x; y', cwd: 'C:\\work\\sub', args: [] };
  assert.deepEqual(resumePlan({ kind: 'shell', claudeSessionId: null, args: ['-NoProfile'], spawnCwd: 'C:\\work', conversation: bad }), { cwd: 'C:\\work', args: ['-NoProfile'], typed: null });
  assert.deepEqual(resumePlan({ kind: 'claude', claudeSessionId: 'x; y', args: ['--model', 'opus'], spawnCwd: 'C:\\work', conversation: bad }), { cwd: 'C:\\work', args: ['--model', 'opus'], typed: null });
});

// A claude.cmd first on the PATH of every shell the manager spawns, so a
// line typed at a prompt shows up as its echo rather than starting the
// real Claude Code. The env is read when each PTY is spawned.
function shimClaude(): { dir: string; restore: () => void } {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'claude.cmd'), '@echo shim-claude %*\r\n');
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const was = process.env[key];
  process.env[key] = `${dir};${was ?? ''}`;
  return { dir, restore: () => { process.env[key] = was; } };
}

test('a /clear opens a conversation span with its own start commit, and the spans survive a restart (M9 fix 185)', async () => {
  const reads: string[] = [];
  const heads = new Map<string, string>();
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return heads.get(cwd) ?? null;
  };
  const log = recordingLogger();
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), log);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const here = fs.realpathSync.native(tempDir());
    heads.set(here, 'a'.repeat(40));
    const s = manager.spawn({ kind: 'shell', cwd: here, cols: 120, rows: 30 });
    await settle();
    // The shell ran a while and a commit landed before its person typed
    // claude (M9 fix 378): the first span starts at the SessionStart and
    // reads HEAD then, a second git read; the record's own start is the
    // spawn's.
    assert.deepEqual(reads, [here]);
    heads.set(here, 'b'.repeat(40));
    const startAt = Date.now() + 7_200_000;
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-1', cwd: here, source: 'startup' }, startAt);
    await settle();
    assert.deepEqual(reads, [here, here]);
    assert.deepEqual(manager.get(s.id).info.spans?.map((x) => [x.conversation, x.startHead, x.startedAt, x.endedAt === null]), [['conv-1', 'b'.repeat(40), startAt, true]]);
    assert.equal(manager.get(s.id).info.startHead, 'a'.repeat(40), 'the record keeps the spawn\'s read');
    // A commit lands, then the clear: the new span starts at the new HEAD
    // and the record's own start stays where the session began.
    heads.set(here, 'c'.repeat(40));
    manager.applyHook(s.id, { hook_event_name: 'SessionEnd', session_id: 'conv-1', cwd: here, reason: 'clear' }, Date.now());
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-2', cwd: here, source: 'clear' }, Date.now());
    await settle();
    assert.deepEqual(reads, [here, here, here]);
    const spans = manager.get(s.id).info.spans ?? [];
    assert.deepEqual(spans.map((x) => [x.conversation, x.startHead, x.endedAt === null]), [['conv-1', 'b'.repeat(40), false], ['conv-2', 'c'.repeat(40), true]]);
    assert.equal(manager.get(s.id).info.startHead, 'a'.repeat(40));
    assert.equal(manager.get(s.id).info.claudeSessionId, 'conv-2');
    assert.deepEqual(store.load()[0]!.spans, spans, 'written to the file');
    manager.kill(s.id);
    await once(manager, 'exit');
    assert.equal(manager.get(s.id).info.spans?.[1]?.endedAt !== null, true, 'the process going closed the open span');
  } finally {
    manager.killAll();
    manager.close();
  }
  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead });
  try {
    restarted.restore();
    const kept = restarted.list()[0];
    assert.deepEqual(kept?.spans?.map((x) => [x.conversation, x.startHead]), [['conv-1', 'b'.repeat(40)], ['conv-2', 'c'.repeat(40)]], restoredMessage(log, restarted));
  } finally {
    restarted.close();
  }
});

test('the start commit is read again where Claude started when that is another folder than the shell was opened in (M9 fix 148)', async () => {
  const reads: string[] = [];
  const heads = new Map<string, string>();
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return heads.get(cwd) ?? null;
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const here = fs.realpathSync.native(tempDir());
    const there = fs.realpathSync.native(tempDir());
    heads.set(here, 'a'.repeat(40));
    heads.set(there, 'b'.repeat(40));
    const s = manager.spawn({ kind: 'shell', cwd: here, cols: 120, rows: 30 });
    await settle();
    assert.equal(manager.get(s.id).info.startHead, 'a'.repeat(40), 'the spawn folder first');
    // Claude reports in from the same folder: the group does not move,
    // and the one read is the first span's own (M9 fix 378), in the same
    // folder.
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-here', cwd: here, source: 'startup' }, Date.now());
    await settle();
    assert.deepEqual(reads, [here, here], 'the group did not move; the span read its own start here');
    assert.equal(manager.get(s.id).info.startHead, 'a'.repeat(40));
    manager.applyHook(s.id, { hook_event_name: 'SessionEnd', session_id: 'conv-here', cwd: here }, Date.now());
    // A cd, then claude in another repository: grouped there, and the
    // start commit is that repository's HEAD.
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-there', cwd: there, source: 'startup' }, Date.now());
    assert.equal(manager.get(s.id).info.groupCwd, there);
    await settle();
    assert.equal(manager.get(s.id).info.startHead, 'b'.repeat(40));
    assert.deepEqual(reads, [here, here, there], 'the move re-reads once; the span opened by it takes that read');
    assert.equal(manager.get(s.id).info.spans?.at(-1)?.startHead, 'b'.repeat(40));
    // A compact restarts the session object in place: no move, no read.
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-there', cwd: there, source: 'compact' }, Date.now());
    await settle();
    assert.equal(reads.length, 3);
    manager.kill(s.id);
    await once(manager, 'exit');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a session spawned or resumed with a PATH runs with it, and one given none keeps the daemon\'s (M9 fix 971)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  // A shell that echoes its PATH and exits; its output collected until it
  // holds `want`, or, with no `want`, until it exits.
  const echoes = async (id: string, want: string | null): Promise<string> => {
    const output: string[] = [];
    manager.get(id).pty!.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    const exited = once(manager, 'exit');
    const deadline = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`no ${want ?? 'exit'} within 20 s; output: ${output.join('').slice(-400)}`)), 20_000).unref();
    });
    await Promise.race([exited, deadline]);
    const all = output.join('');
    if (want !== null) assert.ok(all.includes(want), `the shell echoed ${want}; output: ${all.slice(-400)}`);
    return all;
  };
  const args = ['-NoProfile', '-Command', 'echo ("P=" + $env:Path)'];
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 200, rows: 30, args }, 'C:\\emerald-971-fresh');
    await echoes(s.id, 'P=C:\\emerald-971-fresh');
    manager.resume(s.id, 200, 30, 'C:\\emerald-971-again');
    await echoes(s.id, 'P=C:\\emerald-971-again');
    const plain = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 200, rows: 30, args });
    const out = await echoes(plain.id, null);
    assert.ok(out.includes('P='), `the third shell echoed its PATH; output: ${out.slice(-400)}`);
    assert.ok(!out.includes('emerald-971'), 'a shell given no PATH keeps the daemon\'s');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a resumed shell that hosted a conversation starts in its folder and gets claude --resume typed at its first prompt (M48)', async () => {
  const shim = shimClaude();
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    // The conversation's folder is the long form, as a prompt reports it.
    const sub = fs.realpathSync.native(tempDir());
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    const output: string[] = [];
    manager.get(s.id).pty!.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    // Claude reports in from sub (a cd typed before it), then leaves.
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-typed', cwd: sub, source: 'startup' }, Date.now());
    manager.applyHook(s.id, { hook_event_name: 'SessionEnd', session_id: 'conv-typed', cwd: sub }, Date.now());
    const left = manager.get(s.id).info;
    assert.deepEqual(left.conversation, { id: 'conv-typed', cwd: sub, args: [] });
    assert.equal(left.claudeSessionId, null);
    manager.kill(s.id);
    await once(manager, 'exit');

    const resumed = manager.resume(s.id, 120, 30);
    assert.equal(resumed.cwd, sub, 'the shell is back where Claude was');
    assert.equal(resumed.groupCwd, sub);
    assert.equal(resumed.shellCwd, null, 'no prompt has reported yet');
    assert.equal(resumed.kind, 'shell');
    assert.ok(manager.get(s.id).typeAtPrompt, 'the line waits for the prompt');
    const typed = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`no shim echo within 20 s; output: ${output.join('').slice(-400)}`)), 20_000);
      manager.get(s.id).pty!.on('data', (chunk: Buffer) => {
        output.push(chunk.toString());
        if (output.join('').includes('shim-claude --resume conv-typed')) {
          clearTimeout(deadline);
          resolve();
        }
      });
    });
    await typed;
    assert.equal(manager.get(s.id).typeAtPrompt, null, 'written once');
    const after = manager.get(s.id).info;
    assert.equal(after.shellCwd?.toLowerCase(), sub.toLowerCase(), 'the prompt reported the conversation folder');
    assert.deepEqual(after.conversation, left.conversation, 'the conversation stays until a SessionStart replaces it');
  } finally {
    manager.killAll();
    manager.close();
    shim.restore();
  }
});

test('a resumed shell whose prompt never reports is not typed into (M48)', async () => {
  const shim = shimClaude();
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, resumeTypeTimeoutMs: 300 });
  try {
    // A shell started with args has no prompt wrapper, so no OSC arrives.
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), args: ['-NoProfile', '-NoExit', '-Command', 'Write-Host quiet'], cols: 120, rows: 30 });
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-blind', cwd: os.tmpdir(), source: 'startup' }, Date.now());
    manager.kill(s.id);
    await once(manager, 'exit');
    manager.resume(s.id, 120, 30);
    const output: string[] = [];
    manager.get(s.id).pty!.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    assert.ok(manager.get(s.id).typeAtPrompt, 'the line waits');
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(manager.get(s.id).typeAtPrompt, null, 'given up');
    assert.ok(!output.join('').includes('shim-claude'), 'nothing typed blind');
  } finally {
    manager.killAll();
    manager.close();
    shim.restore();
  }
});

test('resume gives an exited session a new PTY under the same id and persists it', async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const first = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(2), cols: 80, rows: 24 });
    assert.throws(() => manager.resume(first.id, 80, 24), { code: 'bad-request' }, 'still running');
    const [exited] = (await once(manager, 'exit')) as [SessionInfo];
    assert.equal(exited.exitCode, 2);

    const changes: SessionInfo[] = [];
    manager.on('changed', (info: SessionInfo) => changes.push(info));
    const secondExit = once(manager, 'exit');
    const resumed = manager.resume(first.id, 80, 24);
    assert.equal(resumed.id, first.id);
    assert.equal(resumed.state, 'idle');
    assert.equal(resumed.exitCode, null);
    assert.equal(resumed.spawnCwd, first.spawnCwd);
    assert.equal(resumed.createdAt, first.createdAt, 'identity is kept');
    assert.ok(resumed.pid !== null && resumed.pid !== first.pid, 'a new process');
    assert.equal(changes[0]?.state, 'idle', 'subscribers hear the resume as a change');
    assert.equal(store.load()[0]!.exitCode, null, 'the file no longer records an exit');
    assert.equal(manager.list().length, 1, 'no second record');

    // The resumed shell (plain, no exit arg) is killed and exits like any other.
    manager.kill(first.id);
    const [again] = (await secondExit) as [SessionInfo];
    assert.equal(again.id, first.id);
    assert.equal(again.state, 'exited');
    assert.throws(() => manager.resume('nope', 80, 24), { code: 'not-found' });
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('over the pipe: a restored session resumes in spawnCwd and a re-attach streams the new PTY', async () => {
  const dir = tempDir();
  const store = new SessionStore(path.join(dir, 'sessions.json'), silentLogger);
  store.save([
    {
      id: 'old-2',
      kind: 'shell',
      name: 'old shell',
      spawnCwd: process.cwd(),
      args: [],
      autoName: true,
      branch: null,
      lastPrompt: null,
      lastReply: null,
      cwd: 'C:\\somewhere\\else',
      groupCwd: 'C:\\somewhere\\else',
      state: 'exited',
      stateSince: 5000,
      lastEventAt: null,
      stale: false,
      needsInputReason: null,
      errorType: null,
      waitingOn: [],
      team: [],
      conversation: null,
      shellCwd: null,
      commits: [],
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      comment: null,
      phase: null,
      color: '#61afef',
      title: null,
      transcriptPath: null,
      liveReply: null,
      liveTool: null,
      claudeSessionId: 'stale-claude-id',
      remoteSessionId: null,
      startHead: null,
      pid: null,
      exitCode: null,
      createdAt: 1000,
    },
  ]);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  manager.restore();
  const layouts = new LayoutStore(path.join(dir, 'state.json'), silentLogger);
  const pipe = `\\\\.\\pipe\\emmerd-test-resume-${process.pid}`;
  const server = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await server.listen();
  const client = await PipeClient.connect(pipe);
  try {
    await client.request('pty.attach', { sessionId: 'old-2' });
    const { session } = await client.request('session.resume', { sessionId: 'old-2', cols: 100, rows: 30 });
    assert.equal(session.id, 'old-2');
    assert.equal(session.state, 'idle');
    assert.equal(session.cwd, process.cwd(), 'cwd starts over at spawnCwd');
    assert.equal(session.claudeSessionId, null, 'unbound until the new process reports in');
    await assert.rejects(client.request('session.resume', { sessionId: 'old-2', cols: 100, rows: 30 }), { code: 'bad-request' });

    // Attaching again picks up the new PTY; typing reaches the new shell.
    const marker = `EMERALD_RESUME_${Date.now()}`;
    const seen = new Promise<void>((resolve) => {
      client.on('message', (m: ServerMessage) => {
        if (m.type === 'pty.output' && Buffer.from(m.data, 'base64').toString().includes(`OUT:${marker}`)) resolve();
      });
    });
    await client.request('pty.attach', { sessionId: 'old-2' });
    client.send({ type: 'pty.input', sessionId: 'old-2', data: `Write-Output ('OUT:' + '${marker}')\r` });
    await seen;
    const exited = new Promise<void>((resolve) => {
      client.on('message', (m: ServerMessage) => {
        if (m.type === 'pty.exit' && m.sessionId === 'old-2') resolve();
      });
    });
    await client.request('session.kill', { sessionId: 'old-2' });
    await exited;
    assert.equal((await client.request('session.list', {})).sessions[0]?.state, 'exited');
  } finally {
    client.close();
    await server.close();
    manager.killAll();
    manager.close();
  }
});

test('a session carries the branch of its folder, re-read at turn boundaries and on the timer', async () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/first\n');
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const changes: SessionInfo[] = [];
    manager.on('changed', (info: SessionInfo) => changes.push(info));
    // A shell, so no claude.exe runs: hooks reach a shell session the same
    // way (a claude started inside one reports into it).
    const s = manager.spawn({ kind: 'shell', cwd: dir, args: [], cols: 80, rows: 24 });
    assert.equal(s.branch, 'first', 'read at spawn');
    assert.equal(s.lastPrompt, null);

    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/second\n');
    manager.applyHook(s.id, { hook_event_name: 'PreToolUse', session_id: 'c1', tool_name: 'Bash' }, Date.now());
    assert.equal(manager.list()[0]!.branch, 'first', 'a tool call does not re-read');
    manager.applyHook(s.id, { hook_event_name: 'Stop', session_id: 'c1', last_assistant_message: 'Done.\nDetails follow.' }, Date.now());
    const afterStop = manager.list()[0]!;
    assert.equal(afterStop.branch, 'second', 'Stop re-reads');
    assert.equal(afterStop.lastReply, 'Done.', 'and the reply landed, first line only');

    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/third\n');
    const before = changes.length;
    manager.checkStale(Date.now());
    assert.equal(manager.list()[0]!.branch, 'third', 'the timer re-reads for live sessions');
    assert.equal(changes.length, before + 1, 'one change for the new branch');
    manager.checkStale(Date.now());
    assert.equal(changes.length, before + 1, 'none when it is the same');
    assert.equal(readBranch(process.cwd()), manager.spawn({ kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 }).branch, 'a shell in the repo has its branch');
  } finally {
    manager.killAll();
    manager.close();
  }

  // Restored sessions read the branch afresh and keep the last turn.
  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    restarted.restore();
    const restored = restarted.list().find((x) => x.spawnCwd === fs.realpathSync.native(dir))!;
    assert.equal(restored.branch, 'third');
    assert.equal(restored.lastReply, 'Done.', 'the last turn survived the restart');
  } finally {
    restarted.killAll();
    restarted.close();
  }
});

test('a shell reports its folder through its prompt: cd moves the session, its name and its branch', async () => {
  // The prompt reports the long form of the path; os.tmpdir() may be the
  // 8.3 form (ZACHAR~1), so compare against the real path.
  const repo = fs.realpathSync.native(tempDir());
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/reported\n');
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    assert.equal(s.branch, null, 'the temp dir is not a repository');
    const moved = new Promise<SessionInfo>((resolve) => {
      manager.on('changed', (info: SessionInfo) => {
        if (info.id === s.id && info.cwd.toLowerCase() === repo.toLowerCase()) resolve(info);
      });
    });
    manager.get(s.id).pty!.write(`cd '${repo}'\r`);
    await Promise.race([moved, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no cwd report within 20 s')), 20_000))]);
    // The move is one change and the branch that follows it another, so
    // read the record rather than the first event.
    const after = manager.get(s.id).info;
    assert.equal(after.name, folderName(repo), 'named after the new folder');
    assert.equal(after.branch, 'reported', 'the branch followed');
    assert.equal(after.spawnCwd, fs.realpathSync.native(os.tmpdir()), 'spawnCwd is untouched by a cd, in the real spelling of the request');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a shell that sets its window title puts it on the session, throttled, and a resume starts with none', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    assert.equal(s.title, null, 'no title before the shell sets one');
    const titles: string[] = [];
    manager.on('changed', (info: SessionInfo) => {
      if (info.id === s.id && info.title !== null && !titles.includes(info.title)) titles.push(info.title);
    });
    const titled = (want: string) =>
      Promise.race([
        new Promise<void>((resolve) => {
          const seen = () => manager.get(s.id).info.title === want;
          if (seen()) resolve();
          else manager.on('changed', () => { if (seen()) resolve(); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no title ${want} within 20 s`)), 20_000)),
      ]);
    // OSC 2 through the console; ConPTY passes the title on as OSC 0.
    const osc = (text: string) => `Write-Host "$([char]27)]2;${text}$([char]7)"`;
    manager.get(s.id).pty!.write(osc('◐ first') + '\r');
    await titled('◐ first');
    // Only the titles the burst below sets count: PowerShell puts its own
    // exe path on the title as it starts, and whether that lands before
    // or after the first one above is the shell's timing, not the hold's.
    const before = new Set(titles);
    // Three titles in one command land in one chunk or a burst, so the
    // hold publishes the last of them rather than each.
    manager.get(s.id).pty!.write(`${osc('a')}; ${osc('b')}; ${osc('c')}\r`);
    await titled('c');
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(manager.get(s.id).info.title, 'c', 'the latest title is the one kept');
    const burst = titles.filter((t) => !before.has(t));
    assert.ok(burst.length < 3, `fewer publishes than titles, got ${burst.join(', ')}`);
    // A cleared title reads as none.
    manager.get(s.id).pty!.write(osc('') + '\r');
    await Promise.race([
      new Promise<void>((resolve) => manager.on('changed', (info: SessionInfo) => { if (info.id === s.id && info.title === null) resolve(); })),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('title not cleared within 20 s')), 20_000)),
    ]);
    manager.get(s.id).pty!.write(osc('gone with the process') + '; exit\r');
    await titled('gone with the process');
    await once(manager, 'exit');
    assert.equal(manager.get(s.id).info.title, 'gone with the process', 'an exited session keeps its last title');
    const back = manager.resume(s.id, 120, 30);
    assert.equal(back.title, null, 'the new process starts with none');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a spinner line on the stream puts the word on the session, the latest one, and a resume starts with none (M9 fix 158)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    assert.equal(s.liveVerb, null, 'no word before the stream carries one');
    const worded = (want: string) =>
      Promise.race([
        new Promise<void>((resolve) => {
          const seen = () => manager.get(s.id).info.liveVerb === want;
          if (seen()) resolve();
          else manager.on('changed', () => { if (seen()) resolve(); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no spinner word ${want} within 20 s`)), 20_000)),
      ]);
    // The line as Claude Code draws it: a glyph, a space, the word, the
    // ellipsis, at the start of a line; ConPTY passes it on with its own
    // cursor moves, which the scanner takes as well as the newline.
    const spin = (word: string) => `Write-Host "$([char]10)$([char]0x2736) ${word}$([char]0x2026) (esc to interrupt)"`;
    manager.get(s.id).pty!.write(spin('Grinding') + '\r');
    await worded('Grinding');
    manager.get(s.id).pty!.write(`${spin('Finagling')}; ${spin('Boogieing')}; exit\r`);
    await worded('Boogieing');
    await once(manager, 'exit');
    assert.equal(manager.get(s.id).info.liveVerb, null, 'the exit clears the word with the turn');
    const back = manager.resume(s.id, 120, 30);
    assert.equal(back.liveVerb, null, 'the new process starts with none');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a spinner word on a row at a permission ask puts it back at working with the ask gone (M9 fix 775)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    const at = Date.now();
    manager.applyHook(s.id, { hook_event_name: 'UserPromptSubmit', session_id: 'conv-775', prompt: 'ping it' }, at);
    manager.applyHook(s.id, { hook_event_name: 'ToolAsk', session_id: 'conv-775', tool_name: 'Bash', tool_input: { command: 'ping -n 11 127.0.0.1' }, tool_use_id: 'u1' }, at + 1);
    manager.applyHook(s.id, { hook_event_name: 'PermissionRequest', session_id: 'conv-775', tool_name: 'Bash' }, at + 2);
    assert.equal(manager.get(s.id).info.state, 'needs-input');
    assert.equal(manager.get(s.id).info.askedFor?.toolUseId, 'u1');
    const working = Promise.race([
      new Promise<void>((resolve) => {
        const seen = () => manager.get(s.id).info.state === 'working';
        if (seen()) resolve();
        else manager.on('changed', () => { if (seen()) resolve(); });
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the row did not go back to working within 20 s')), 20_000)),
    ]);
    manager.get(s.id).pty!.write(`Write-Host "$([char]10)$([char]0x2736) Roosting$([char]0x2026) (esc to interrupt)"\r`);
    await working;
    assert.equal(manager.get(s.id).info.askedFor, null, 'the ask goes with the dialog');
    assert.equal(manager.get(s.id).info.needsInputReason, null);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a title from a bound Claude names the session and lands in sessions.json; a glyph flip does not write', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'sessions.json');
  const store = new SessionStore(file, silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    // The long form: the shell's prompt reports the folder that way, and a
    // short-name spawn would make that first prompt a folder change (a
    // write) racing the assertions below.
    const cwd = fs.realpathSync.native(os.tmpdir());
    const s = manager.spawn({ kind: 'shell', cwd, cols: 120, rows: 30 });
    const folder = folderName(cwd);
    assert.equal(s.name, folder);
    const named = (want: string) =>
      Promise.race([
        new Promise<void>((resolve) => {
          const seen = () => manager.get(s.id).info.name === want;
          if (seen()) resolve();
          else manager.on('changed', () => { if (seen()) resolve(); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no name ${want} within 20 s`)), 20_000)),
      ]);
    const titled = (want: string) =>
      Promise.race([
        new Promise<void>((resolve) => {
          const seen = () => manager.get(s.id).info.title === want;
          if (seen()) resolve();
          else manager.on('changed', () => { if (seen()) resolve(); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no title ${want} within 20 s`)), 20_000)),
      ]);
    const osc = (text: string) => `Write-Host "$([char]27)]2;${text}$([char]7)"`;
    // The title prints before the prompt comes back, and a hook of the
    // conversation landing inside a command makes that command's end
    // Claude leaving (M9 fix 360); a real SessionStart lands inside the
    // `claude` command, so the fixture's lands at the prompt.
    const prompted = () =>
      Promise.race([
        new Promise<void>((resolve) => {
          const seen = () => manager.get(s.id).info.command?.state === 'ok';
          if (seen()) resolve();
          else manager.on('changed', () => { if (seen()) resolve(); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no prompt within 20 s')), 20_000)),
      ]);
    // A shell's own title never names it.
    manager.get(s.id).pty!.write(osc('◐ Git log hash') + '\r');
    await titled('◐ Git log hash');
    await prompted();
    assert.equal(manager.get(s.id).info.name, folder, 'no Claude bound');
    // Claude starts in the shell: the title already on the record is picked up.
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'c1', source: 'startup', cwd }, Date.now());
    assert.equal(manager.get(s.id).info.name, 'Git log hash');
    assert.equal(store.load()[0]!.name, 'Git log hash', 'the name is in the file');
    assert.equal(store.load()[0]!.autoName, true, 'and still automatic');
    // The spinner flips the glyph: a publish, not a write.
    const written = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    manager.get(s.id).pty!.write(osc('◑ Git log hash') + '\r');
    await titled('◑ Git log hash');
    assert.equal(fs.statSync(file).mtimeMs, written, 'a glyph flip does not touch sessions.json');
    // A new conversation name follows.
    manager.get(s.id).pty!.write(osc('✳ Second name') + '\r');
    await named('Second name');
    assert.equal(store.load()[0]!.name, 'Second name');
    // A hand rename holds against the next title; an empty one picks it up.
    manager.rename(s.id, 'mine');
    manager.get(s.id).pty!.write(osc('◐ Third name') + '\r');
    await titled('◐ Third name');
    assert.equal(manager.get(s.id).info.name, 'mine');
    manager.rename(s.id, '');
    assert.equal(manager.get(s.id).info.name, 'Third name', 'an empty rename takes the title at once');
    // Claude leaves: back to the folder.
    manager.applyHook(s.id, { hook_event_name: 'SessionEnd', session_id: 'c1' }, Date.now());
    assert.equal(manager.get(s.id).info.name, folder);
    assert.equal(store.load()[0]!.name, folder);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('kill with remove forgets the session once it has exited, and at once when it already had', async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const removed: string[] = [];
    manager.on('removed', (id: string) => removed.push(id));
    const live = manager.spawn({ kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
    const exit = once(manager, 'exit');
    manager.kill(live.id, true);
    assert.equal(manager.list().length, 1, 'still listed until the PTY exit lands');
    const [exited] = (await exit) as [SessionInfo];
    assert.equal(exited.state, 'exited', 'the exit is announced before the removal');
    assert.deepEqual(removed, [live.id], 'removed right after the exit');
    assert.equal(manager.list().length, 0);
    assert.deepEqual(store.load().map((s) => typeof s.removedAt), ['number'], 'and in the file as removed (M57)');

    // Already exited: removed on the spot, no PTY to wait for.
    const done = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    await once(manager, 'exit');
    manager.kill(done.id, true);
    assert.deepEqual(removed, [live.id, done.id]);
    assert.equal(manager.list().length, 0);

    // Without remove, a killed session stays as exited, as before.
    const kept = manager.spawn({ kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
    const keptExit = once(manager, 'exit');
    manager.kill(kept.id);
    await keptExit;
    assert.equal(manager.list()[0]?.state, 'exited');
    assert.equal(removed.length, 2);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('remove takes an exited session off the list, refuses a live one, and keeps the record marked removed (M57)', async () => {
  const file = path.join(tempDir(), 'sessions.json');
  const store = new SessionStore(file, silentLogger);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const removed: string[] = [];
    manager.on('removed', (id: string) => removed.push(id));
    const live = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    assert.throws(() => manager.remove(live.id), { code: 'bad-request' });
    await once(manager, 'exit');
    manager.remove(live.id);
    assert.deepEqual(removed, [live.id]);
    assert.deepEqual(manager.list(), [], 'off the list');
    const kept = manager.list({ removed: true });
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.id, live.id);
    assert.equal(typeof kept[0]?.removedAt, 'number', 'the record says when it was removed');
    assert.equal(kept[0]?.name, live.name, 'the name is kept for the timeline and the lanes');
    const onDisk = store.load();
    assert.deepEqual(onDisk.map((s) => [s.id, typeof s.removedAt]), [[live.id, 'number']], 'in the file, marked');
    assert.throws(() => manager.get(live.id), { code: 'not-found' });
    assert.throws(() => manager.remove(live.id), { code: 'not-found' });
    assert.throws(() => manager.resume(live.id, 80, 24), { code: 'not-found' }, 'a removed session cannot be resumed');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a removed record survives a restart: restored as removed, never listed, still behind the flag (M57)', async () => {
  const file = path.join(tempDir(), 'sessions.json');
  const store = new SessionStore(file, silentLogger);
  const first = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  let id: string;
  try {
    const live = first.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    id = live.id;
    await once(first, 'exit');
    first.remove(id);
  } finally {
    first.killAll();
    first.close();
  }
  const second = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    second.restore();
    assert.deepEqual(second.list(), [], 'not restored as an exited row');
    const kept = second.list({ removed: true });
    assert.deepEqual(kept.map((s) => [s.id, s.state, typeof s.removedAt]), [[id, 'exited', 'number']]);
    // A restart saves the file again; the removed record is still in it.
    const live = second.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    await once(second, 'exit');
    assert.deepEqual(store.load().map((s) => s.id).sort(), [id, live.id].sort());
  } finally {
    second.killAll();
    second.close();
  }
});

test('over the pipe: remove empties the panes first, then pushes session.removed', async () => {
  const dir = tempDir();
  const store = new SessionStore(path.join(dir, 'sessions.json'), silentLogger);
  store.save([
    {
      id: 'old-3',
      kind: 'shell',
      name: 'old shell',
      spawnCwd: process.cwd(),
      args: [],
      autoName: true,
      branch: null,
      lastPrompt: null,
      lastReply: null,
      cwd: process.cwd(),
      groupCwd: process.cwd(),
      state: 'exited',
      stateSince: 5000,
      lastEventAt: null,
      stale: false,
      needsInputReason: null,
      errorType: null,
      waitingOn: [],
      team: [],
      conversation: null,
      shellCwd: null,
      commits: [],
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      comment: null,
      phase: null,
      color: '#61afef',
      title: null,
      transcriptPath: null,
      liveReply: null,
      liveTool: null,
      claudeSessionId: null,
      remoteSessionId: null,
      startHead: null,
      pid: null,
      exitCode: 0,
      createdAt: 1000,
    },
  ]);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  manager.restore();
  const layouts = new LayoutStore(path.join(dir, 'state.json'), silentLogger);
  layouts.load();
  const pipe = `\\\\.\\pipe\\emmerd-test-remove-${process.pid}`;
  const server = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await server.listen();
  const client = await PipeClient.connect(pipe);
  try {
    await client.request('subscribe', { topics: ['sessions', 'layout'] });
    const base = layouts.get();
    await client.request('layout.set', { layout: replaceTab(base, setPaneSession(currentTab(base), currentTab(base).root.id, 'old-3')) });
    await client.request('pty.attach', { sessionId: 'old-3' });

    const got: ServerMessage[] = [];
    client.on('message', (m: ServerMessage) => got.push(m));
    await client.request('session.remove', { sessionId: 'old-3' });
    const types = got.map((m) => m.type);
    assert.deepEqual(types, ['layout.changed', 'session.removed'], `pane cleared before the session vanished, got ${types.join()}`);
    const layoutPush = got[0];
    assert.ok(layoutPush !== undefined && layoutPush.type === 'layout.changed');
    const root = currentTab(layoutPush.layout).root;
    assert.equal(root.kind === 'pane' ? root.sessionId : 'split', null);
    assert.deepEqual((await client.request('session.list', {})).sessions, []);
    // The record is kept behind the flag (M57), with when it was removed.
    const kept = (await client.request('session.list', { removed: true })).sessions;
    assert.deepEqual(kept.map((s) => [s.id, s.name, typeof s.removedAt]), [['old-3', 'old shell', 'number']]);
    assert.deepEqual(store.load().map((s) => [s.id, typeof s.removedAt]), [['old-3', 'number']]);
    // The renderer detaches when its pane empties. The connection already
    // forgot the attachment, so that is a quiet no-op rather than an error.
    await client.request('pty.detach', { sessionId: 'old-3' });
    await assert.rejects(client.request('session.remove', { sessionId: 'old-3' }), { code: 'not-found' });
  } finally {
    client.close();
    await server.close();
    manager.close();
  }
});

test('a git-writing Bash call with no read before it records HEAD on the session, once per hash, capped, and it survives a restart (M49)', async () => {
  const log = recordingLogger();
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), log);
  let head = 'a'.repeat(40);
  const reads: string[] = [];
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return head;
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: [], cols: 80, rows: 24 });
    assert.deepEqual(s.commits, []);
    // The spawn reads HEAD once for the start commit (M9 fix 117); the
    // reads under test come after it.
    await settle();
    reads.length = 0;
    const post = (command: string, event = 'PostToolUse') => manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', tool_name: 'Bash', tool_input: { command } }, Date.now());
    post('git status');
    await settle();
    assert.equal(reads.length, 0, 'a status reads nothing');
    const t1 = Date.now();
    post('git commit -m x');
    await settle();
    assert.deepEqual(reads, [process.cwd()], 'read in the session folder');
    const first = manager.list()[0]!.commits;
    assert.equal(first.length, 1);
    assert.equal(first[0]!.hash, head);
    assert.ok(first[0]!.at >= t1, 'the claim carries its time');
    assert.deepEqual(store.load()[0]!.commits, first, 'persisted');
    post('git commit --amend --no-edit');
    await settle();
    assert.deepEqual(manager.list()[0]!.commits, first, 'the same hash again is not a second commit');
    head = 'b'.repeat(40);
    post('git merge fix-rail', 'PostToolUseFailure');
    await settle();
    assert.deepEqual(manager.list()[0]!.commits, first, 'a failed call credits nothing (M58)');
    post('git merge fix-rail');
    await settle();
    assert.deepEqual(manager.list()[0]!.commits.map((c) => c.hash), ['a'.repeat(40), 'b'.repeat(40)], 'oldest first');
    for (let i = 0; i < 250; i++) {
      head = i.toString(16).padStart(40, '0');
      post('git commit -m more');
      await settle();
    }
    const commits = manager.list()[0]!.commits;
    assert.equal(commits.length, 200, 'capped');
    assert.equal(commits[commits.length - 1]!.hash, (249).toString(16).padStart(40, '0'), 'the newest is kept');
  } finally {
    manager.killAll();
    manager.close();
  }

  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    restarted.restore();
    assert.equal(restarted.list()[0]!.commits.length, 200, restoredMessage(log, restarted));
  } finally {
    restarted.close();
  }
});

test('the claude.ai session id is read off the transcript head at a turn boundary, kept, persisted, and read afresh for a new transcript (M58)', async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const reads: string[] = [];
  let remote: string | null = null;
  const readRemoteSessionId = async (p: string) => {
    reads.push(p);
    return remote;
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readRemoteSessionId });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: [], cols: 80, rows: 24 });
    const post = (event: string, transcript = 'C:\t\one.jsonl') => manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', transcript_path: transcript }, Date.now());
    post('SessionStart');
    await settle();
    assert.deepEqual(reads, ['C:\t\one.jsonl'], 'looked at on SessionStart once the path is known');
    assert.equal(manager.list()[0]!.remoteSessionId, null, 'not there yet');
    post('PreToolUse');
    await settle();
    assert.equal(reads.length, 1, 'a tool call is not a turn boundary');
    remote = 'session_abc';
    post('UserPromptSubmit');
    await settle();
    assert.equal(manager.list()[0]!.remoteSessionId, 'session_abc', 'found at the prompt');
    assert.equal(store.load()[0]!.remoteSessionId, 'session_abc', 'persisted');
    post('Stop');
    await settle();
    assert.equal(reads.length, 2, 'not read again once known');
    // A new transcript is a new conversation: read afresh.
    remote = 'session_def';
    post('SessionStart', 'C:\t\two.jsonl');
    await settle();
    assert.equal(manager.list()[0]!.remoteSessionId, 'session_def');
    assert.deepEqual(reads, ['C:\t\one.jsonl', 'C:\t\one.jsonl', 'C:\t\two.jsonl']);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('HEAD read before and after a git-writing call credits the first-parent commits between the two, in the folder the command names, and nothing on a failure (M58)', async () => {
  const heads = new Map<string, string | null>([['C:\\repo', 'a'.repeat(40)], ['C:\\wt\\x', 'm'.repeat(40)]]);
  const reads: string[] = [];
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return heads.get(cwd) ?? null;
  };
  const revs: Array<[string, string | null, string]> = [];
  const revList = async (cwd: string, before: string | null, after: string) => {
    revs.push([cwd, before, after]);
    return ['c'.repeat(40), 'd'.repeat(40)];
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead, revList });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: [], cols: 80, rows: 24 });
    // The spawn reads HEAD once for the start commit (M9 fix 117); the
    // reads under test come after it.
    await settle();
    reads.length = 0;
    const post = (event: string, command: string, id: string, cwd = 'C:\\repo') => manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', cwd, tool_name: 'Bash', tool_use_id: id, tool_input: { command } }, Date.now());
    // A merge in a worktree named by a leading cd: read there, before and after.
    post('PreToolUse', 'cd ../wt/x && git merge feature', 't1');
    await settle();
    assert.deepEqual(reads, ['C:\\wt\\x'], 'HEAD read in the worktree before the call');
    heads.set('C:\\wt\\x', 'n'.repeat(40));
    post('PostToolUse', 'cd ../wt/x && git merge feature', 't1');
    await settle();
    assert.deepEqual(reads, ['C:\\wt\\x', 'C:\\wt\\x'], 'and after');
    assert.deepEqual(revs, [['C:\\wt\\x', 'm'.repeat(40), 'n'.repeat(40)]], 'the commits between the two, first parents only');
    assert.deepEqual(manager.list()[0]!.commits.map((c) => c.hash), ['c'.repeat(40), 'd'.repeat(40)]);
    // A command that moved nothing credits nothing.
    post('PreToolUse', 'git commit -m nothing', 't2');
    await settle();
    post('PostToolUse', 'git commit -m nothing', 't2');
    await settle();
    assert.equal(revs.length, 1, 'the same HEAD before and after asks for no list');
    assert.equal(manager.list()[0]!.commits.length, 2);
    // A failed call drops what was held and credits nothing.
    post('PreToolUse', 'git commit -m fails', 't3');
    await settle();
    heads.set('C:\\repo', 'z'.repeat(40));
    post('PostToolUseFailure', 'git commit -m fails', 't3');
    await settle();
    assert.equal(manager.list()[0]!.commits.length, 2, 'a failed call credits nothing');
    // A held read is forgotten at the next prompt: the call after it
    // falls back to the plain read.
    post('PreToolUse', 'git commit -m lost', 't4');
    await settle();
    manager.applyHook(s.id, { hook_event_name: 'UserPromptSubmit', session_id: 'c1', prompt: 'again' }, Date.now());
    heads.set('C:\\repo', 'y'.repeat(40));
    post('PostToolUse', 'git commit -m lost', 't4');
    await settle();
    assert.equal(revs.length, 1, 'no read from before, no list');
    assert.deepEqual(manager.list()[0]!.commits.map((c) => c.hash).slice(-1), ['y'.repeat(40)], 'the new HEAD credited as M49 did');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("a subagent's Bash calls give its member a folder, a branch and the commits it made there, and move nothing on the parent (M61)", async () => {
  const heads = new Map<string, string>();
  const reads: string[] = [];
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return heads.get(cwd) ?? null;
  };
  const ranges: string[] = [];
  const listCommits = async (cwd: string, before: string, after: string) => {
    ranges.push(`${cwd} ${before.slice(0, 2)}..${after.slice(0, 2)}`);
    return after === 'c'.repeat(40) ? ['b'.repeat(40), 'c'.repeat(40)] : [];
  };
  const branches: Record<string, string> = { 'C:/code/emerald': 'main', 'C:/code/emerald-wt/m61': 'm61-agent-lanes', 'C:/code/other': 'other' };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead, listCommits, readBranch: (cwd) => branches[cwd] ?? null });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const changes: number[] = [];
  manager.on('changed', (info: SessionInfo) => changes.push(info.team.length));
  try {
    // A shell that prints no prompt for the test's half second: a real
    // one running Claude prints none either, and a prompt here would put
    // the session back in the test's own folder under the hooks' (M9 fix
    // 74's report). Short, since a hidden runner's -Wait outlives it.
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    // The spawn reads HEAD once for the start commit (M9 fix 117); the
    // reads under test come after it.
    await settle();
    reads.length = 0;
    const post = (payload: Record<string, unknown>) => manager.applyHook(s.id, { session_id: 'c1', cwd: 'C:/code/emerald', ...payload }, 1000);
    // Bound to Claude, so the session's folder is the one its hooks
    // report (M9 fix 113), which is what a member's call is measured
    // against (M9 fix 116).
    post({ hook_event_name: 'SessionStart', source: 'startup' });
    assert.equal(manager.list()[0]!.cwd, 'C:/code/emerald');
    // Claude started in another folder than the shell was opened in, so
    // the start commit is read again there (M9 fix 148); not under test.
    await settle();
    assert.deepEqual(reads, ['C:/code/emerald'], 'the start commit re-read where Claude started');
    reads.length = 0;
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'run the batch' });
    post({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'fork' });
    const member = () => manager.list()[0]!.team.find((m) => m.id === 'a1')!;
    assert.equal(member().cwd, null);
    // Before the member exists its calls are dropped, as every agent hook was.
    assert.equal(post({ hook_event_name: 'PostToolUse', agent_id: 'a2', tool_name: 'Bash', tool_input: { command: 'git status' } }).outcome, 'ignored-agent');
    const stateBefore = manager.list()[0]!.state;
    const eventBefore = manager.list()[0]!.lastEventAt;
    // A first call in the parent's own folder places nothing (M9 fix 116):
    // the agent has no worktree yet, so it sits on the parent's line.
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'git worktree add ../emerald-wt/m61 -b m61-agent-lanes' } });
    await settle();
    assert.equal(member().cwd, null, 'a call in the repository itself gives no folder');
    assert.equal(member().branch, null);
    // A cd into the worktree: the member's folder and branch, nothing on the parent.
    heads.set('C:/code/emerald-wt/m61', 'a'.repeat(40));
    assert.deepEqual(post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd ../emerald-wt/m61 && git commit -m x' } }), { outcome: 'applied-agent' });
    await settle();
    assert.equal(member().cwd, 'C:/code/emerald-wt/m61');
    assert.equal(member().branch, 'm61-agent-lanes');
    assert.equal(manager.list()[0]!.state, stateBefore, 'the parent did not move');
    assert.equal(manager.list()[0]!.lastEventAt, eventBefore, 'not even its clock');
    assert.deepEqual(reads, ['C:/code/emerald-wt/m61'], 'HEAD read before the commit, in the worktree');
    heads.set('C:/code/emerald-wt/m61', 'c'.repeat(40));
    post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd ../emerald-wt/m61 && git commit -m x' } });
    await settle();
    assert.deepEqual(ranges, ['C:/code/emerald-wt/m61 aa..cc'], 'the range between the two reads');
    assert.deepEqual(member().commits, [{ hash: 'b'.repeat(40), at: 1000 }, { hash: 'c'.repeat(40), at: 1000 }], 'what the range added, oldest first');
    assert.deepEqual(manager.list()[0]!.commits, [], "the parent's own commits take none of it");
    // A command that did not move HEAD adds nothing; a failed one credits nothing.
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd ../emerald-wt/m61 && git commit --amend --no-edit' } });
    await settle();
    post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd ../emerald-wt/m61 && git commit --amend --no-edit' } });
    await settle();
    assert.equal(member().commits.length, 2);
    heads.set('C:/code/emerald-wt/m61', 'd'.repeat(40));
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'git -C C:/code/emerald-wt/m61 merge main' } });
    await settle();
    post({ hook_event_name: 'PostToolUseFailure', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'git -C C:/code/emerald-wt/m61 merge main' } });
    await settle();
    assert.equal(member().commits.length, 2, 'a failed call credits nothing');
    // With no PreToolUse seen (the daemon attached mid-call) the new HEAD alone is credited.
    heads.set('C:/code/emerald-wt/m61', 'e'.repeat(40));
    post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd ../emerald-wt/m61 && git commit -m y' } });
    await settle();
    assert.equal(member().commits[2]!.hash, 'e'.repeat(40));
    assert.ok(changes.length >= 3, 'each change was published');
    // A later call back in the parent's folder leaves the worktree on the
    // member (M9 fix 116), and so does one in a folder outside any
    // repository (M9 fix 137: the logs folder beside the worktrees, where
    // readBranch answers null and no .git is above it); a call in a
    // second repository moves it.
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'sleep 25' } });
    await settle();
    assert.equal(member().cwd, 'C:/code/emerald-wt/m61', 'the worktree sticks through a call in the repository');
    assert.equal(member().branch, 'm61-agent-lanes');
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd C:/code/emerald-wt/logs && grep -c PASS run.log' } });
    await settle();
    assert.equal(member().cwd, 'C:/code/emerald-wt/m61', 'a folder outside any repository leaves the worktree on the member');
    assert.equal(member().branch, 'm61-agent-lanes');
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd C:/code/other && ls' } });
    await settle();
    assert.equal(member().cwd, 'C:/code/other', 'a second repository moves it');
    assert.equal(member().branch, 'other');
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'cd C:/code/emerald-wt/m61 && ls' } });
    await settle();
    assert.equal(member().cwd, 'C:/code/emerald-wt/m61');
    // M65: the member's activity is the phrase of its latest call, any
    // tool, and stays past its return; a tool of an unknown agent sets none.
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: 'C:/code/emerald-wt/m61/README.md' } });
    assert.equal(member().activity, 'Reading README.md');
    post({ hook_event_name: 'PreToolUse', agent_id: 'a9', tool_name: 'Read', tool_input: { file_path: 'C:/x.md' } });
    assert.equal(member().activity, 'Reading README.md', 'an unknown agent sets nothing');
    post({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'fork' });
    assert.equal(member().activity, 'Reading README.md', 'kept past the return');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a Bash call that names no git is measured all the same when it runs in a repository, on the session and on a member, and not outside one (M9 fix 195)', async () => {
  // A folder with a .git in it, since the gate is the .git walk; the reads
  // are stubbed so no git runs and HEAD can be moved by hand.
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  const elsewhere = tempDir();
  let head = 'a'.repeat(40);
  const reads: string[] = [];
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return head;
  };
  const revs: Array<[string | null, string]> = [];
  const revList = async (_cwd: string, before: string | null, after: string) => {
    revs.push([before, after]);
    return ['b'.repeat(40)];
  };
  const listCommits = async (_cwd: string, before: string, after: string) => {
    revs.push([before, after]);
    return ['m'.repeat(40)];
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead, revList, listCommits, readBranch: () => null });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    await settle();
    reads.length = 0;
    const post = (event: string, command: string, id: string, extra: Record<string, unknown> = {}) =>
      manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', cwd: repo, tool_name: 'Bash', tool_use_id: id, tool_input: { command }, ...extra }, 1000);
    // A script that commits: no git in the text, HEAD moves between the two reads.
    post('PreToolUse', 'node tools/land.mjs x', 't1');
    await settle();
    assert.equal(reads.length, 1, 'HEAD held before a call in a repository, whatever its text');
    head = 'c'.repeat(40);
    post('PostToolUse', 'node tools/land.mjs x', 't1');
    await settle();
    assert.equal(reads.length, 2, 'and read after');
    assert.deepEqual(revs, [['a'.repeat(40), 'c'.repeat(40)]], 'the range between the two');
    assert.deepEqual(manager.list()[0]!.commits.map((c) => c.hash), ['b'.repeat(40)], 'credited to the session that ran the script');
    // A call that moved nothing lists nothing.
    post('PreToolUse', 'npm test', 't2');
    await settle();
    post('PostToolUse', 'npm test', 't2');
    await settle();
    assert.equal(revs.length, 1, 'the same HEAD before and after asks for no list');
    // With no read before it, a command that names no git claims nothing,
    // not even the current HEAD; a git write still does, as M49 did.
    head = 'd'.repeat(40);
    post('PostToolUse', 'ls', 't3');
    await settle();
    assert.equal(reads.length, 4, 'not even read');
    assert.equal(manager.list()[0]!.commits.length, 1);
    post('PostToolUse', 'git commit -m x', 't4');
    await settle();
    assert.deepEqual(manager.list()[0]!.commits.map((c) => c.hash).slice(-1), ['d'.repeat(40)]);
    // Outside any repository a call that names no git holds nothing.
    reads.length = 0;
    post('PreToolUse', 'node build.mjs', 't5', { cwd: elsewhere });
    await settle();
    post('PostToolUse', 'node build.mjs', 't5', { cwd: elsewhere });
    await settle();
    assert.equal(reads.length, 0, 'no repository, no read');
    // A member's script commit is credited to the member the same way.
    post('SubagentStart', '', 'x', { agent_id: 'm1', agent_type: 'fork' });
    revs.length = 0;
    head = 'e'.repeat(40);
    post('PreToolUse', 'node tools/land.mjs y', 't6', { agent_id: 'm1' });
    await settle();
    head = 'f'.repeat(40);
    post('PostToolUse', 'node tools/land.mjs y', 't6', { agent_id: 'm1' });
    await settle();
    assert.deepEqual(revs, [['e'.repeat(40), 'f'.repeat(40)]]);
    const member = manager.list()[0]!.team.find((m) => m.id === 'm1')!;
    assert.deepEqual(member.commits.map((c) => c.hash), ['m'.repeat(40)], "credited to the member, off the member's own reads");
    assert.equal(manager.list()[0]!.commits.length, 2, 'and not to the session');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("a member's git read credits nothing when HEAD moves under it, on the session too, and a hash another record holds is not credited twice (M9 fix 311)", async () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  let head = 'a'.repeat(40);
  const reads: string[] = [];
  const readHead = async (cwd: string) => {
    reads.push(cwd);
    return head;
  };
  // A linear history a, b, c, ... so a range is the letters between.
  const listCommits = async (_cwd: string, before: string | null, after: string) => {
    const order = 'abcdefghijk';
    return order.slice(order.indexOf(before?.[0] ?? '') + 1, order.indexOf(after[0]!) + 1).split('').map((l) => l.repeat(40));
  };
  const revList = listCommits;
  const infos: string[] = [];
  const logger = { ...silentLogger, info: (msg: string) => void infos.push(msg) };
  const manager = new SessionManager(logger, { staleCheckIntervalMs: 0, readHead, revList, listCommits, readBranch: () => null });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    const t = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    await settle();
    reads.length = 0;
    const post = (id: string, event: string, command: string, extra: Record<string, unknown> = {}) =>
      manager.applyHook(id, { hook_event_name: event, session_id: `c-${id}`, cwd: repo, tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command }, ...extra }, 1000);
    post(s.id, 'SubagentStart', '', { agent_id: 'm1', agent_type: 'fork' });
    post(s.id, 'SubagentStart', '', { agent_id: 'm2', agent_type: 'fork' });
    const member = (id: string) => manager.list().find((i) => i.id === s.id)!.team.find((m) => m.id === id)!;
    // A gate poll while the tech lead fast-forwards main: HEAD moves
    // between the two hooks and nothing is credited, nothing even read.
    post(s.id, 'PreToolUse', 'git rev-list --count main..fix-x', { agent_id: 'm1' });
    await settle();
    head = 'b'.repeat(40);
    post(s.id, 'PostToolUse', 'git rev-list --count main..fix-x', { agent_id: 'm1' });
    await settle();
    assert.deepEqual(reads, [], 'a git read holds no HEAD and reads none after');
    assert.deepEqual(member('m1').commits, [], 'the fast-forward is not the poll\'s');
    // The session's own git read the same.
    post(s.id, 'PreToolUse', 'git log --oneline -3');
    await settle();
    head = 'c'.repeat(40);
    post(s.id, 'PostToolUse', 'git log --oneline -3');
    await settle();
    assert.deepEqual(reads, [], 'not on the session either');
    assert.deepEqual(manager.list().find((i) => i.id === s.id)!.commits, []);
    // A value left by an earlier call whose end never landed: consumed by
    // the read-only call, HEAD found moved is logged and credited nowhere.
    post(s.id, 'PreToolUse', 'node tools/land.mjs', { agent_id: 'm1' });
    await settle();
    head = 'd'.repeat(40);
    post(s.id, 'PostToolUse', 'git status', { agent_id: 'm1' });
    await settle();
    assert.deepEqual(member('m1').commits, []);
    assert.ok(infos.includes('head moved under a read-only call'), infos.join('\n'));
    post(s.id, 'PreToolUse', 'git status', { agent_id: 'm1' });
    await settle();
    head = 'e'.repeat(40);
    post(s.id, 'PostToolUse', 'git status', { agent_id: 'm1' });
    await settle();
    assert.deepEqual(member('m1').commits, [], 'and the stale value is gone');
    // A script commit is still measured (M9 fix 195).
    post(s.id, 'PreToolUse', 'node tools/land.mjs', { agent_id: 'm1' });
    await settle();
    head = 'f'.repeat(40);
    post(s.id, 'PostToolUse', 'node tools/land.mjs', { agent_id: 'm1' });
    await settle();
    assert.deepEqual(member('m1').commits.map((c) => c.hash), ['f'.repeat(40)]);
    // The other session's git write with no read before it would claim
    // the same hash as M49 had it, and since M9 fix 472 it does not: m1
    // holds f, and a member's claim is never taken. A member is never
    // credited what a record already holds either: m1 reads HEAD at f,
    // main moves on to g while m2's own command takes it to h, and m1's
    // range f..h credits m1 the g nobody holds and not m2's h.
    post(t.id, 'PostToolUse', 'git commit -m x');
    await settle();
    assert.deepEqual(manager.list().find((i) => i.id === t.id)!.commits.map((c) => c.hash), [], 'the hash m1 holds is claimed once');
    post(s.id, 'PreToolUse', 'node tools/land.mjs', { agent_id: 'm1' });
    await settle();
    head = 'g'.repeat(40);
    post(s.id, 'PreToolUse', 'node tools/land.mjs', { agent_id: 'm2' });
    await settle();
    head = 'h'.repeat(40);
    post(s.id, 'PostToolUse', 'node tools/land.mjs', { agent_id: 'm2' });
    await settle();
    assert.deepEqual(member('m2').commits.map((c) => c.hash), ['h'.repeat(40)]);
    post(s.id, 'PostToolUse', 'node tools/land.mjs', { agent_id: 'm1' });
    await settle();
    assert.deepEqual(member('m1').commits.map((c) => c.hash), ['f'.repeat(40), 'g'.repeat(40)], "the range less what m2 holds");
    // A range made only of held hashes credits nothing, not even the new HEAD.
    post(s.id, 'PreToolUse', 'node tools/land.mjs', { agent_id: 'm2' });
    await settle();
    head = 'i'.repeat(40);
    post(t.id, 'PostToolUse', 'git commit -m y');
    await settle();
    assert.deepEqual(manager.list().find((i) => i.id === t.id)!.commits.map((c) => c.hash), ['i'.repeat(40)]);
    post(s.id, 'PostToolUse', 'node tools/land.mjs', { agent_id: 'm2' });
    await settle();
    assert.deepEqual(member('m2').commits.map((c) => c.hash), ['h'.repeat(40)], "i is the other session's");
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('the range is asked from the hold\'s time, and a held null credits nothing for an unnamed command but still does for a git write (M9 fixes 470 and 471)', async () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  let head: string | null = 'a'.repeat(40);
  let failNext = false;
  const readHead = async () => {
    if (failNext) {
      failNext = false;
      return null;
    }
    return head;
  };
  const revs: Array<[string | null, string, number | null]> = [];
  const revList = async (_cwd: string, before: string | null, after: string, since: number | null) => {
    revs.push([before, after, since]);
    return before === null ? [after] : ['b'.repeat(40)];
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead, revList, readBranch: () => null });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    await settle();
    const post = (event: string, command: string, id: string, at: number) =>
      manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', cwd: repo, tool_name: 'Bash', tool_use_id: id, tool_input: { command } }, at);
    const commits = () => manager.list()[0]!.commits.map((c) => c.hash);
    post('PreToolUse', 'npm test', 't1', 5000);
    await settle();
    head = 'c'.repeat(40);
    post('PostToolUse', 'npm test', 't1', 9000);
    await settle();
    assert.deepEqual(revs, [['a'.repeat(40), 'c'.repeat(40), 5000]], "the PreToolUse's time goes with the range");
    assert.deepEqual(commits(), ['b'.repeat(40)]);
    // The read before an `ls` fails; HEAD after it is some other session's.
    failNext = true;
    post('PreToolUse', 'ls', 't2', 10_000);
    await settle();
    head = 'd'.repeat(40);
    post('PostToolUse', 'ls', 't2', 11_000);
    await settle();
    assert.equal(revs.length, 1, 'a held null is no hold');
    assert.deepEqual(commits(), ['b'.repeat(40)], 'and the ls credits nothing');
    // The same failed read before a git write still credits the new HEAD.
    failNext = true;
    post('PreToolUse', 'git commit -m x', 't3', 12_000);
    await settle();
    head = 'e'.repeat(40);
    post('PostToolUse', 'git commit -m x', 't3', 13_000);
    await settle();
    assert.deepEqual(commits(), ['b'.repeat(40), 'e'.repeat(40)], 'a git write with a held null credits HEAD, as before');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a commit another session claims from an unnamed call is claimed once, by the committer, whichever post lands first (M9 fix 472)', async () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  let head = 'a'.repeat(40);
  const readHead = async () => head;
  // A linear history a, b, c, ... so a range is the letters between.
  const revList = async (_cwd: string, before: string | null, after: string) => {
    const order = 'abcdefghijk';
    return order.slice(order.indexOf(before?.[0] ?? '') + 1, order.indexOf(after[0]!) + 1).split('').map((l) => l.repeat(40));
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead, revList, readBranch: () => null });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    const t = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    await settle();
    const post = (id: string, event: string, command: string, use: string) =>
      manager.applyHook(id, { hook_event_name: event, session_id: `c-${id}`, cwd: repo, tool_name: 'Bash', tool_use_id: use, tool_input: { command } }, Date.now());
    const commits = (id: string) => manager.list().find((i) => i.id === id)!.commits.map((c) => c.hash);
    // s runs a long build; t commits in the same checkout meanwhile, and
    // the build's end lands first.
    post(s.id, 'PreToolUse', 'npm run build', 'u1');
    post(t.id, 'PreToolUse', 'git commit -m x', 'u2');
    await settle();
    head = 'b'.repeat(40);
    post(s.id, 'PostToolUse', 'npm run build', 'u1');
    await settle();
    assert.deepEqual(commits(s.id), ['b'.repeat(40)], 'the build claims it first');
    post(t.id, 'PostToolUse', 'git commit -m x', 'u2');
    await settle();
    assert.deepEqual(commits(t.id), ['b'.repeat(40)], 'the committer takes it');
    assert.deepEqual(commits(s.id), [], 'and the build holds it no more');
    // The other order: the commit's end lands first, the build's after.
    post(s.id, 'PreToolUse', 'npm test', 'u3');
    post(t.id, 'PreToolUse', 'git commit -m y', 'u4');
    await settle();
    head = 'c'.repeat(40);
    post(t.id, 'PostToolUse', 'git commit -m y', 'u4');
    await settle();
    post(s.id, 'PostToolUse', 'npm test', 'u3');
    await settle();
    assert.deepEqual(commits(t.id), ['b'.repeat(40), 'c'.repeat(40)], 'the committer holds it');
    assert.deepEqual(commits(s.id), [], 'and the build claims nothing');
    // A committer's claim is never taken by another git write (here one
    // with no read before it, which claims HEAD as M49 did).
    post(s.id, 'PostToolUse', 'git commit --amend', 'u6');
    await settle();
    assert.deepEqual(commits(t.id), ['b'.repeat(40), 'c'.repeat(40)], "a named claim stays with its committer");
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("a member's head read that lands after its call's end is discarded, the pick credited once through the fallback, and the files answer before any spawn (M9 fix 311)", async () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  // Each spawned read is a deferred the test resolves by hand, in the
  // order it wants; the file read answers from a table.
  const pending: Array<(hash: string | null) => void> = [];
  const readHead = (_cwd: string) => new Promise<string | null>((resolve) => void pending.push(resolve));
  let fromFiles: string | null = null;
  let fileReads = 0;
  const readHeadFile = (_cwd: string) => {
    fileReads += 1;
    return fromFiles;
  };
  const ranges: string[] = [];
  const listCommits = async (_cwd: string, before: string, after: string) => {
    ranges.push(`${before[0]}..${after[0]}`);
    return [after];
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, readHead, readHeadFile, listCommits, readBranch: () => null });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    await settle();
    // The spawn's own start-commit read; answered so it is out of the way.
    while (pending.length > 0) pending.shift()!(null);
    await settle();
    const post = (event: string, command: string, extra: Record<string, unknown> = {}) =>
      manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', cwd: repo, tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command }, agent_id: 'm1', ...extra }, 1000);
    post('SubagentStart', '');
    const member = () => manager.list()[0]!.team.find((m) => m.id === 'm1')!;
    // The files say nothing, so the read before the pick is a spawn; the
    // pick finishes and its end lands while that read is still out.
    post('PreToolUse', 'git cherry-pick abc1234');
    await settle();
    assert.equal(pending.length, 1, 'one read out for the head before');
    const late = pending.shift()!;
    post('PostToolUse', 'git cherry-pick abc1234');
    await settle();
    assert.equal(pending.length, 1, 'the read after, with no value in hand');
    pending.shift()!('b'.repeat(40));
    await settle();
    assert.deepEqual(member().commits.map((c) => c.hash), ['b'.repeat(40)], 'the new HEAD alone, through the fallback');
    assert.deepEqual(ranges, [], 'no range: there was no before');
    // The late value lands now, after the call it was for: discarded.
    late('b'.repeat(40));
    await settle();
    post('PreToolUse', 'git cherry-pick def5678');
    await settle();
    assert.equal(pending.length, 1, 'the next call reads afresh');
    pending.shift()!('b'.repeat(40));
    await settle();
    post('PostToolUse', 'git cherry-pick def5678');
    await settle();
    pending.shift()!('c'.repeat(40));
    await settle();
    assert.deepEqual(ranges, ['b..c'], 'the fresh read is the before');
    assert.deepEqual(member().commits.map((c) => c.hash), ['b'.repeat(40), 'c'.repeat(40)]);
    // With the files answering, no spawn: the value is in hand before
    // the hook returns.
    fromFiles = 'c'.repeat(40);
    fileReads = 0;
    post('PreToolUse', 'git cherry-pick 0123456');
    assert.equal(fileReads, 1);
    assert.equal(pending.length, 0, 'nothing spawned');
    fromFiles = 'd'.repeat(40);
    post('PostToolUse', 'git cherry-pick 0123456');
    await settle();
    assert.equal(pending.length, 0);
    assert.deepEqual(ranges, ['b..c', 'c..d']);
    assert.deepEqual(member().commits.map((c) => c.hash), ['b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40)]);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('two spellings of one folder group as one: the spawn folder, a hook cwd and a resume all take the real spelling (M9 fix 108)', async () => {
  // Windows keeps a folder's case and hands out an 8.3 form beside the
  // long one; a lower-cased path is the spelling any machine can vary.
  const dir = tempDir();
  const real = fs.realpathSync.native(dir);
  const other = real.toLowerCase();
  assert.notEqual(other, real, 'the temp folder has a letter to vary');
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const exits = new Promise<void>((resolve) => {
      let left = 2;
      manager.on('exit', () => {
        if (--left === 0) resolve();
      });
    });
    const a = manager.spawn({ kind: 'shell', cwd: other, args: exitArgs(0), cols: 80, rows: 24 });
    assert.equal(a.cwd, real);
    assert.equal(a.groupCwd, real);
    assert.equal(a.spawnCwd, real, 'the request is recorded in the real spelling (M9 fix 711)');
    const b = manager.spawn({ kind: 'shell', cwd: real, args: exitArgs(0), cols: 80, rows: 24 });
    assert.equal(b.groupCwd, a.groupCwd, 'one heading for the two');
    manager.applyHook(b.id, { hook_event_name: 'SessionStart', session_id: 'c-108', cwd: other, source: 'startup' }, Date.now());
    assert.equal(manager.get(b.id).info.groupCwd, real, 'a hook reporting the other spelling moves nothing');
    assert.equal(manager.get(b.id).info.cwd, real);
    // The shells have to be gone before the folder can go.
    await exits;

    // A record saved before fix 711 holds the asked spelling, and one
    // saved before M9 has no autoName; the restore makes spawnCwd real,
    // while the store's name guess, which runs at load, still reads the
    // stored spelling.
    const file = path.join(tempDir(), 'sessions.json');
    const store = new SessionStore(file, silentLogger);
    store.save([{ ...manager.get(a.id).info, spawnCwd: other, cwd: other, groupCwd: other, name: folderName(other) }]);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessions: Record<string, unknown>[] };
    for (const s of saved.sessions) delete s['autoName'];
    fs.writeFileSync(file, JSON.stringify(saved));
    const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
    try {
      restarted.restore();
      const restored = restarted.get(a.id).info;
      assert.equal(restored.spawnCwd, real, 'a restored record takes the real spelling');
      assert.equal(restored.autoName, true, 'the old-record name guess read the stored spelling');
    } finally {
      restarted.killAll();
      restarted.close();
    }
  } finally {
    manager.killAll();
    manager.close();
    removeWithPatience(dir);
  }
});

test("Claude's task list is read off its files when a conversation reports in with one made, or a TaskUpdate names a task the record lacks (M9 fix 153), and is persisted", async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const reads: string[] = [];
  let files: SessionTask[] = [];
  const readTasks = async (id: string) => {
    reads.push(id);
    return files;
  };
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readTasks });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: [], cols: 80, rows: 24 });
    const post = (payload: Record<string, unknown>) => manager.applyHook(s.id, { session_id: 'c1', ...payload }, Date.now());
    const tasksOf = () => manager.list()[0]!.tasks ?? [];
    // A fresh conversation: the folder is looked at once at SessionStart and holds nothing.
    post({ hook_event_name: 'SessionStart', source: 'startup' });
    await settle();
    assert.deepEqual(reads, ['c1']);
    assert.deepEqual(tasksOf(), []);
    // The hooks build the list; nothing is read for a known id.
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'plan it' });
    post({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'Extend the row', activeForm: 'Extending the row' }, tool_response: { task: { id: '1' } } });
    post({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'Wire the hooks' }, tool_response: { task: { id: '2' } } });
    post({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } });
    await settle();
    assert.equal(reads.length, 1);
    assert.deepEqual(tasksOf().map((t) => [t.id, t.status]), [['1', 'completed'], ['2', 'pending']]);
    assert.deepEqual(store.load()[0]!.tasks.map((t) => t.id), ['1', '2'], 'persisted');
    // The next prompt clears the list; Claude carrying on with task 2 names an id the record lacks, so the files are read and win.
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
    assert.deepEqual(tasksOf(), []);
    files = [
      { id: '1', subject: 'Extend the row', activeForm: 'Extending the row', status: 'completed' },
      { id: '2', subject: 'Wire the hooks', activeForm: 'Wiring the hooks', status: 'in_progress' },
      { id: '3', subject: 'Write the tests', activeForm: null, status: 'pending' },
    ];
    post({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'in_progress' } });
    await settle();
    assert.deepEqual(reads, ['c1', 'c1']);
    assert.deepEqual(tasksOf().map((t) => [t.id, t.status]), [['1', 'completed'], ['2', 'in_progress'], ['3', 'pending']], 'the files brought the whole list back');
    // A resumed conversation with a list already made reads it at its SessionStart.
    post({ hook_event_name: 'SessionEnd', reason: 'exit' });
    assert.deepEqual(tasksOf(), [], "a shell's Claude takes its list with it");
    files = [{ id: '1', subject: 'Extend the row', activeForm: null, status: 'in_progress' }];
    post({ hook_event_name: 'SessionStart', source: 'resume' });
    await settle();
    assert.deepEqual(tasksOf().map((t) => t.id), ['1']);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("a member's task carries the member (M9 fix 394): its TaskCreate's agent_id lands on the task, the session's count holds it, and a reread off the files keeps the owner", async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  let files: SessionTask[] = [];
  const readTasks = async () => files;
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readTasks });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: [], cols: 80, rows: 24 });
    const post = (payload: Record<string, unknown>) => manager.applyHook(s.id, { session_id: 'c1', ...payload }, Date.now());
    const tasksOf = () => manager.list()[0]!.tasks ?? [];
    post({ hook_event_name: 'SessionStart', source: 'startup' });
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'fan it out' });
    post({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'Plan it' }, tool_response: { task: { id: '1', subject: 'Plan it' } } });
    post({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'fork' });
    post({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'Explore' });
    // The member's own calls: the hook is applied as an agent's now, and
    // the task it names is that member's from then on.
    assert.equal(post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'TaskCreate', tool_input: { subject: 'Read the graph' }, tool_response: { task: { id: '2', subject: 'Read the graph' } } }).outcome, 'applied-agent');
    post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'TaskCreate', tool_input: { subject: 'Write the step' }, tool_response: { task: { id: '3', subject: 'Write the step' } } });
    post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'completed' }, tool_response: { success: true, taskId: '2' } });
    await settle();
    assert.deepEqual(tasksOf().map((t) => [t.id, t.agentId ?? null, t.status]), [['1', null, 'pending'], ['2', 'a1', 'completed'], ['3', 'a1', 'pending']]);
    assert.deepEqual(store.load()[0]!.tasks.map((t) => [t.id, t.agentId ?? null]), [['1', null], ['2', 'a1'], ['3', 'a1']], 'the owner is persisted');
    // The files know nothing of owners: the reread keeps what the hooks
    // attributed and leaves a task they never saw unowned.
    files = [
      { id: '1', subject: 'Plan it', activeForm: null, status: 'pending' },
      { id: '2', subject: 'Read the graph', activeForm: null, status: 'completed' },
      { id: '3', subject: 'Write the step', activeForm: null, status: 'pending' },
      { id: '4', subject: 'Made before we looked', activeForm: null, status: 'pending' },
    ];
    post({ hook_event_name: 'PostToolUse', agent_id: 'a2', tool_name: 'TaskUpdate', tool_input: { taskId: '4', status: 'in_progress' }, tool_response: { success: true, taskId: '4' } });
    await settle();
    assert.deepEqual(tasksOf().map((t) => [t.id, t.agentId ?? null]), [['1', null], ['2', 'a1'], ['3', 'a1'], ['4', null]], "a member's TaskUpdate naming an unknown id reads the files, whose task stays unowned");
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("a shell's prompt marks put its last command on the record: running at Enter, ok or failed by the code at the next prompt, and a long one's end puts the row at done or errored until an ack or the next command (M9 fix 196)", async () => {
  // A second and a half is the line between short and long here, so a
  // sleep of two seconds is long and everything else is short.
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, shellDoneAfterMs: 1500 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    assert.equal(s.command, null, 'no command before the first Enter');
    const until = (what: string, seen: (info: SessionInfo) => boolean) =>
      Promise.race([
        new Promise<SessionInfo>((resolve) => {
          const now = manager.get(s.id).info;
          if (seen(now)) resolve(now);
          else manager.on('changed', (info: SessionInfo) => { if (info.id === s.id && seen(info)) resolve(info); });
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no ${what} within 20 s`)), 20_000)),
      ]);
    const pty = manager.get(s.id).pty!;
    // The prompt must be up before the first line, or the C lands before the wrapper.
    await until('first prompt', (info) => info.shellCwd !== null);
    pty.write('cmd /c exit 3\r');
    const running = await until('running', (info) => info.command?.state === 'running');
    assert.equal(running.command!.exitCode, null);
    assert.equal(running.command!.endedAt, null);
    const failed = await until('failed', (info) => info.command?.state === 'failed');
    assert.equal(failed.command!.exitCode, 3, 'the native exit code');
    assert.ok(failed.command!.endedAt! >= failed.command!.startedAt, 'ended after it started');
    // Each short command is judged by its own measured span: the stamps are taken
    // when the daemon parses the marks, so a loaded box can push a short one past
    // the line, and then it is rightly long.
    const failedSpan = failed.command!.endedAt! - failed.command!.startedAt;
    assert.equal(failed.state, failedSpan >= 1500 ? 'errored' : 'idle', `the failure's state by its own span (${failedSpan} ms)`);
    pty.write('Write-Host ok\r');
    const ok = await until('ok', (info) => info.command?.state === 'ok');
    assert.equal(ok.command!.exitCode, 0);
    const okSpan = ok.command!.endedAt! - ok.command!.startedAt;
    assert.equal(ok.state, okSpan >= 1500 ? 'done' : 'idle', `the success's state by its own span (${okSpan} ms)`);
    // A cmdlet's failure reads as 1, with no native code to carry.
    pty.write('Get-Item C:\emerald-no-such-folder\nope\r');
    const cmdlet = await until('cmdlet failure', (info) => info.command?.state === 'failed');
    assert.equal(cmdlet.command!.exitCode, 1);
    const cmdletSpan = cmdlet.command!.endedAt! - cmdlet.command!.startedAt;
    assert.equal(cmdlet.state, cmdletSpan >= 1500 ? 'errored' : 'idle', `the cmdlet failure's state by its own span (${cmdletSpan} ms)`);
    // An empty Enter is no command: the record stays as it was.
    pty.write('\r');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(manager.get(s.id).info.command!.state, 'failed', 'an empty Enter changes nothing');
    // A long command's end wants someone: done, with stateSince at the end.
    pty.write('Start-Sleep -m 2000; Write-Host slept\r');
    await until('long running', (info) => info.command?.state === 'running');
    const done = await until('done', (info) => info.state === 'done');
    assert.equal(done.command!.state, 'ok');
    assert.ok(done.command!.endedAt! - done.command!.startedAt >= 1500, `ran long, got ${done.command!.endedAt! - done.command!.startedAt} ms`);
    assert.equal(done.stateSince, done.command!.endedAt, 'the state started when the command ended');
    manager.ack(s.id);
    assert.equal(manager.get(s.id).info.state, 'idle', 'an ack clears the done');
    // And a long failure is errored, cleared by the next command's start.
    pty.write('Start-Sleep -m 2000; cmd /c exit 7\r');
    const errored = await until('errored', (info) => info.state === 'errored');
    assert.equal(errored.command!.exitCode, 7);
    pty.write('Write-Host next\r');
    const cleared = await until('cleared', (info) => info.command?.state === 'running');
    assert.equal(cleared.state, 'idle', 'the next command clears the errored');
    await until('next ok', (info) => info.command?.state === 'ok');
    // A resume starts with none.
    pty.write('exit\r');
    await once(manager, 'exit');
    assert.equal(manager.resume(s.id, 120, 30).command, null, 'the new process starts with none');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test("the files a session writes are kept on the record, one entry per path, a member's with its id, persisted and kept across a restart (M9 fix 198)", async () => {
  const log = recordingLogger();
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), log);
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 3'], cols: 80, rows: 24 });
    assert.equal(s.touched, undefined, 'none until the first write');
    const post = (payload: Record<string, unknown>, at: number) => manager.applyHook(s.id, { session_id: 'c1', cwd: 'C:/code/emerald', ...payload }, at);
    post({ hook_event_name: 'SessionStart', source: 'startup' }, 1000);
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'edit things' }, 1001);
    // A PreToolUse is not a write yet; a Read touches nothing.
    post({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/code/emerald/a.ts' } }, 1002);
    post({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'C:/code/emerald/a.ts' } }, 1003);
    assert.deepEqual(manager.list()[0]!.touched ?? [], []);
    post({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/code/emerald/a.ts' } }, 1004);
    post({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:/code/emerald/b.ts' } }, 1005);
    assert.deepEqual(manager.list()[0]!.touched, [
      { path: 'C:/code/emerald/a.ts', at: 1004, agentId: null },
      { path: 'C:/code/emerald/b.ts', at: 1005, agentId: null },
    ]);
    // The same path again moves to the end with the new time, not doubled.
    post({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'C:/code/emerald/a.ts' } }, 1006);
    assert.deepEqual(manager.list()[0]!.touched!.map((t) => `${t.path}@${t.at}`), ['C:/code/emerald/b.ts@1005', 'C:/code/emerald/a.ts@1006']);
    // A notebook names its path in another field.
    post({ hook_event_name: 'PostToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: 'C:/code/emerald/n.ipynb' } }, 1007);
    assert.equal(manager.list()[0]!.touched!.at(-1)!.path, 'C:/code/emerald/n.ipynb');
    // A known member's Edit carries its id; an unknown agent's is dropped.
    post({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'fork' }, 1008);
    post({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: 'C:/code/emerald-wt/x/c.ts' } }, 1009);
    post({ hook_event_name: 'PostToolUse', agent_id: 'a9', tool_name: 'Edit', tool_input: { file_path: 'C:/code/emerald-wt/x/d.ts' } }, 1010);
    const touched = manager.list()[0]!.touched!;
    assert.deepEqual(touched.at(-1), { path: 'C:/code/emerald-wt/x/c.ts', at: 1009, agentId: 'a1' });
    assert.equal(touched.length, 4, "the unknown agent's write is not kept");
    // A foreign conversation's write is not the session's.
    post({ hook_event_name: 'PostToolUse', session_id: 'other', tool_name: 'Edit', tool_input: { file_path: 'C:/code/emerald/e.ts' } }, 1011);
    assert.equal(manager.list()[0]!.touched!.length, 4);
    assert.deepEqual(store.load()[0]!.touched, touched, 'persisted');
    // Bounded, the oldest going first.
    for (let i = 0; i < 250; i++) post({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: `C:/code/emerald/many/${i}.ts` } }, 2000 + i);
    const many = manager.list()[0]!.touched!;
    assert.equal(many.length, 200, 'capped');
    assert.equal(many.at(-1)!.path, 'C:/code/emerald/many/249.ts');
  } finally {
    manager.killAll();
    manager.close();
  }

  const restarted = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store });
  try {
    restarted.restore();
    assert.equal(restarted.list()[0]!.touched!.length, 200, restoredMessage(log, restarted));
    assert.equal(restarted.list()[0]!.touched!.at(-1)!.path, 'C:/code/emerald/many/249.ts');
  } finally {
    restarted.close();
  }
});

test("the stall threshold is the turn's own: three times the median PostToolUse gap, floored, reset by the next prompt (M9 fix 232)", () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, staleAfterMs: 60_000 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: [], cols: 80, rows: 24 });
    const info = () => manager.list().find((x) => x.id === s.id)!;
    const post = (event: string, at: number, extra: object = {}) => manager.applyHook(s.id, { hook_event_name: event, session_id: 'c1', ...extra }, at);
    const T = 1_000_000;
    post('SessionStart', T, { source: 'startup' });
    post('UserPromptSubmit', T + 1000);
    // A turn of five-minute tool calls: the threshold is fifteen minutes.
    post('PostToolUse', T + 1000, { tool_name: 'Bash' });
    post('PostToolUse', T + 301_000, { tool_name: 'Bash' });
    post('PostToolUse', T + 601_000, { tool_name: 'Bash' });
    manager.checkStale(T + 601_000 + 899_999);
    assert.equal(info().stale, false, 'quiet for under three gaps');
    manager.checkStale(T + 601_000 + 900_000);
    assert.equal(info().stale, true, 'three gaps of silence');
    assert.equal(info().staleThresholdMs, 900_000, 'the threshold it tripped');
    // A subagent's tool calls do not count: the parent's own pace does.
    post('PostToolUse', T + 1_600_000, { tool_name: 'Bash' });
    assert.equal(info().stale, false, 'cleared by the hook');
    assert.equal(info().staleThresholdMs, null);
    post('PostToolUse', T + 1_601_000, { tool_name: 'Bash', agent_id: 'agent-x' });
    manager.checkStale(T + 1_601_000 + 60_000);
    assert.equal(info().stale, false, 'the median gap is still five minutes');
    // The next prompt starts a fresh turn with no pace yet: the floor.
    post('UserPromptSubmit', T + 2_000_000);
    manager.checkStale(T + 2_000_000 + 59_999);
    assert.equal(info().stale, false);
    manager.checkStale(T + 2_000_000 + 60_000);
    assert.equal(info().stale, true, 'the floor alone');
    assert.equal(info().staleThresholdMs, 60_000);
  } finally {
    manager.killAll();
    manager.close();
  }
});

// A store that counts its saves and holds nothing (M9 fix 459).
function countingStore(): { store: SessionStore; saves: () => number } {
  let n = 0;
  const store = { save: () => void n++, load: () => [] } as unknown as SessionStore;
  return { store, saves: () => n };
}

test("a member's activity line and a branch move are published without a save (M9 fix 459)", async () => {
  const { store, saves } = countingStore();
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead: async () => null, readBranch: () => null });
  const changes: string[] = [];
  manager.on('changed', (info: SessionInfo) => changes.push(info.team.find((m) => m.id === 'a1')?.activity ?? ''));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 10'], cols: 80, rows: 24 });
    const post = (payload: Record<string, unknown>) => manager.applyHook(s.id, { session_id: 'c1', cwd: process.cwd(), ...payload }, 1000);
    post({ hook_event_name: 'SessionStart', source: 'startup' });
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'run the batch' });
    post({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'fork' });
    await new Promise((r) => setTimeout(r, 50));
    const baseline = saves();
    changes.length = 0;
    for (let i = 1; i <= 5; i++) post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: `C:/code/file${i}.ts` } });
    assert.equal(changes.length, 5, 'each activity line is published');
    assert.match(changes[4]!, /file5/);
    assert.equal(saves(), baseline, 'and none of them saved');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a member keeps its last three tool phrases, oldest first, the latest its activity line (M9 fix 835)', async () => {
  const { store, saves } = countingStore();
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, readHead: async () => null, readBranch: () => null });
  const changes: Array<string[] | undefined> = [];
  manager.on('changed', (info: SessionInfo) => changes.push(info.team.find((m) => m.id === 'a1')?.recent));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 10'], cols: 80, rows: 24 });
    const post = (payload: Record<string, unknown>) => manager.applyHook(s.id, { session_id: 'c1', cwd: process.cwd(), ...payload }, 1000);
    post({ hook_event_name: 'SessionStart', source: 'startup' });
    post({ hook_event_name: 'UserPromptSubmit', prompt: 'run the batch' });
    post({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'fork' });
    await new Promise((r) => setTimeout(r, 50));
    const baseline = saves();
    changes.length = 0;
    for (let i = 1; i <= 4; i++) post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: `C:/code/file${i}.ts` } });
    assert.equal(changes.length, 4, 'each phrase is published');
    const member = manager.get(s.id).info.team.find((m) => m.id === 'a1')!;
    assert.deepEqual(member.recent, ['Reading file2.ts', 'Reading file3.ts', 'Reading file4.ts']);
    assert.equal(member.activity, 'Reading file4.ts');
    // The latest phrase again adds nothing and publishes nothing.
    post({ hook_event_name: 'PreToolUse', agent_id: 'a1', tool_name: 'Read', tool_input: { file_path: 'C:/code/file4.ts' } });
    assert.equal(changes.length, 4, 'a repeat of the latest phrase is no push');
    assert.deepEqual(manager.get(s.id).info.team.find((m) => m.id === 'a1')!.recent, ['Reading file2.ts', 'Reading file3.ts', 'Reading file4.ts']);
    assert.equal(saves(), baseline, 'and none of them saved');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('saves inside the coalescing window are written once, and keepScreens and close write a pending one at once (M9 fix 459)', async () => {
  const { store, saves } = countingStore();
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, store, saveDelayMs: 250, readHead: async () => null, readBranch: () => null });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const s = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: ['-NoProfile', '-Command', 'Start-Sleep 10'], cols: 80, rows: 24 });
    await wait(400);
    const baseline = saves();
    let published = 0;
    manager.on('changed', () => published++);
    for (let i = 1; i <= 10; i++) manager.rename(s.id, `name ${i}`);
    assert.equal(published, 10, 'every change goes out at once');
    assert.equal(saves(), baseline, 'none is written inside the window');
    await wait(400);
    assert.equal(saves(), baseline + 1, 'ten changes, one write');
    manager.rename(s.id, 'before the stop');
    await manager.keepScreens();
    assert.equal(saves(), baseline + 2, 'keepScreens writes before it returns');
    await wait(400);
    assert.equal(saves(), baseline + 2, 'and leaves no write pending');
    manager.rename(s.id, 'last');
    manager.close();
    assert.equal(saves(), baseline + 3, 'close writes the pending change');
    manager.rename(s.id, 'after close');
    assert.equal(saves(), baseline + 4, 'after close every save is written at once');
  } finally {
    manager.killAll();
    manager.close();
  }
});

// M9 fix 624: the shells the manager is handed, from the box's own, so
// the files are real; Windows PowerShell and cmd are on every box.
function boxShells(...ids: string[]) {
  return findShells().filter((o) => ids.includes(o.id));
}

test('a spawn runs the shell asked for, records it, and refuses one not installed (M9 fix 624)', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, shells: boxShells('powershell', 'cmd') });
  try {
    assert.deepEqual(manager.installedShells().map((o) => o.id), ['powershell', 'cmd']);
    const exit = once(manager, 'exit');
    const s = manager.spawn({ kind: 'shell', shell: 'cmd', cwd: fs.realpathSync.native(tempDir()), args: ['/c', 'exit 5'], cols: 80, rows: 24 });
    assert.equal(s.shell, 'cmd');
    const [exited] = (await exit) as [SessionInfo];
    assert.equal(exited.exitCode, 5, 'cmd ran /c exit 5; PowerShell would have refused /c');
    assert.throws(() => manager.spawn({ kind: 'shell', shell: 'gitbash', cwd: process.cwd(), cols: 80, rows: 24 }), {
      code: 'bad-request',
      message: 'shell gitbash is not installed on this box; installed: powershell, cmd',
    });
    const plain = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 });
    assert.equal(plain.shell, 'powershell', 'none asked is the first');
    await once(manager, 'exit');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a cmd shell resumes as cmd, and a record whose shell has gone resumes in the default with a warning (M9 fix 624)', async () => {
  const store = new SessionStore(path.join(tempDir(), 'sessions.json'), silentLogger);
  const warns: { msg: string; extra: unknown }[] = [];
  const noting = { info() {}, warn: (msg: string, extra?: unknown) => warns.push({ msg, extra }), error() {} };
  const shells = boxShells('powershell', 'cmd');
  const manager = new SessionManager(noting, { staleCheckIntervalMs: 0, store, shells });
  let restarted: SessionManager | null = null;
  try {
    const s = manager.spawn({ kind: 'shell', shell: 'cmd', cwd: fs.realpathSync.native(tempDir()), cols: 80, rows: 24 });
    manager.kill(s.id);
    await once(manager, 'exit');
    const resumed = manager.resume(s.id, 80, 24);
    assert.equal(resumed.shell, 'cmd');
    const output: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`no cmd banner within 10 s: ${output.join('').slice(-300)}`)), 10_000);
      manager.get(s.id).pty!.on('data', (chunk: Buffer) => {
        output.push(chunk.toString());
        if (output.join('').includes('Microsoft Windows [Version')) {
          clearTimeout(deadline);
          resolve();
        }
      });
    });
    manager.kill(s.id);
    await once(manager, 'exit');
    // The same record saved as having run Git Bash, which this manager
    // does not offer: a new manager restores it and resumes the default.
    store.save(manager.list().map((i) => ({ ...i, shell: 'gitbash' as const })));
    manager.close();
    restarted = new SessionManager(noting, { staleCheckIntervalMs: 0, store, shells });
    restarted.restore();
    const back = restarted.resume(s.id, 80, 24);
    assert.equal(back.shell, 'powershell');
    assert.deepEqual(warns.at(-1), { msg: 'shell is not installed now, resuming in the default', extra: { id: s.id, shell: 'gitbash', default: 'powershell' } });
  } finally {
    manager.killAll();
    manager.close();
    restarted?.killAll();
    restarted?.close();
  }
});

test('one load tick emits one load event and no changed (M9 fix 703)', () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const a = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 }).id;
    const b = manager.spawn({ kind: 'shell', cwd: process.cwd(), args: exitArgs(0), cols: 80, rows: 24 }).id;
    const changed: unknown[] = [];
    const loads: LoadTick[] = [];
    const onChanged = (info: unknown) => changed.push(info);
    const onLoad = (tick: LoadTick) => loads.push(tick);
    manager.on('changed', onChanged);
    manager.on('load', onLoad);
    manager.applyLoad(
      new Map([
        [a, { sample: { at: 1000, cpu: 5, rss: 10 }, names: ['pwsh'] }],
        [b, { sample: { at: 1000, cpu: 7, rss: 20 }, names: [] }],
        ['nobody', { sample: { at: 1000, cpu: 1, rss: 1 }, names: [] }],
      ]),
    );
    manager.off('changed', onChanged);
    manager.off('load', onLoad);
    assert.equal(changed.length, 0, 'no record per session');
    assert.equal(loads.length, 1, 'one load event a tick');
    assert.deepEqual(loads[0]!.samples, [
      { sessionId: a, sample: { at: 1000, cpu: 5, rss: 10 }, names: ['pwsh'] },
      { sessionId: b, sample: { at: 1000, cpu: 7, rss: 20 }, names: [] },
    ]);
    assert.deepEqual(
      loads[0]!.sessions.map((s) => s.id),
      [a, b],
      'the records in the same order, for an older window',
    );
    const byId = new Map(manager.list().map((s) => [s.id, s]));
    assert.deepEqual(byId.get(a)!.load, [{ at: 1000, cpu: 5, rss: 10 }]);
    assert.deepEqual(byId.get(a)!.loadNames, ['pwsh']);
    assert.equal(byId.get(b)!.load!.length, 1);
    assert.deepEqual(byId.get(b)!.loadNames, []);

    manager.on('load', onLoad);
    manager.on('changed', onChanged);
    manager.applyLoad(new Map([['nobody', { sample: { at: 2000, cpu: 1, rss: 1 }, names: [] }]]));
    manager.off('changed', onChanged);
    manager.off('load', onLoad);
    assert.equal(loads.length, 1, 'a tick with no session of ours emits nothing');
    assert.equal(changed.length, 0);
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('a SessionStart under another conversation is told in the log once per new id, with the bound one (M9 fix 734)', async () => {
  const log = recordingLogger();
  const manager = new SessionManager(log, { staleCheckIntervalMs: 0 });
  try {
    const here = fs.realpathSync.native(tempDir());
    const s = manager.spawn({ kind: 'shell', cwd: here, cols: 120, rows: 30 });
    const hook = (event: string, id: string) => manager.applyHook(s.id, { hook_event_name: event, session_id: id, cwd: here }, Date.now());
    hook('SessionStart', 'conv-1');
    hook('SessionStart', 'nested-1');
    hook('SessionStart', 'nested-1');
    hook('Stop', 'nested-1');
    hook('SessionStart', 'nested-2');
    const told = log.lines.filter((l) => l.startsWith('info hook SessionStart under another conversation ignored'));
    assert.equal(told.length, 2, log.lines.join(' | '));
    assert.equal(manager.get(s.id).info.claudeSessionId, 'conv-1');
  } finally {
    manager.killAll();
    manager.close();
  }
});

test('an Append from the bound conversation emits row once and leaves the record alone; a foreign one or one with no uuid emits none (M9 fix 769)', () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0 });
  try {
    const s = manager.spawn({ kind: 'shell', cwd: os.tmpdir(), cols: 120, rows: 30 });
    const rows: Array<{ sessionId: string; uuid: string; row: unknown; cut: boolean }> = [];
    manager.on('row', (r: { sessionId: string; uuid: string; row: unknown; cut: boolean }) => rows.push(r));
    const row = { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'From the mod.' }] };
    manager.applyHook(s.id, { hook_event_name: 'SessionStart', session_id: 'conv-769', source: 'startup' }, Date.now());
    const info = manager.get(s.id).info;
    const result = manager.applyHook(s.id, { hook_event_name: 'Append', session_id: 'conv-769', uuid: 'u-769', door: 'response', row }, Date.now());
    assert.equal(result.outcome, 'applied');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.sessionId, s.id);
    assert.equal(rows[0]!.uuid, 'u-769');
    assert.deepEqual(rows[0]!.row, row);
    assert.equal(rows[0]!.cut, false);
    assert.equal(manager.get(s.id).info, info, 'the record is the same object');
    manager.applyHook(s.id, { hook_event_name: 'Append', session_id: 'conv-other', uuid: 'u-other', door: 'response', row }, Date.now());
    assert.equal(rows.length, 1, 'a foreign row emits nothing');
    manager.applyHook(s.id, { hook_event_name: 'Append', session_id: 'conv-769', door: 'response', row }, Date.now());
    assert.equal(rows.length, 1, 'a row with no uuid emits nothing');
  } finally {
    manager.killAll();
    manager.close();
  }
});
