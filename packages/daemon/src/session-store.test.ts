import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { SESSION_COLORS, isSessionColor } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { silentLogger } from './log.ts';
import { REMOVED_KEPT, SessionStore, toPersisted } from './session-store.ts';

function tempFile(): string {
  return path.join(mkTemp('emerald-sessions-'), 'nested', 'sessions.json');
}

test.after(removeTemps);

function info(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'a',
    kind: 'claude',
    name: 'proj',
    spawnCwd: 'C:\\work\\proj',
    args: ['--model', 'opus'],
    autoName: true,
    branch: 'main',
    lastPrompt: 'commit this',
    lastReply: 'Committed as 97af82b.',
    lastPromptAt: 1500,
    lastReplyAt: 1900,
    cwd: 'C:\\work\\proj\\src',
    groupCwd: 'C:\\work\\proj\\src',
    state: 'working',
    stateSince: 2000,
    lastEventAt: 2500,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    conversation: { id: 'claude-1', cwd: 'C:\\work\\proj', args: ['--model', 'opus'] },
    shellCwd: null,
    commits: [],
    model: 'Fable',
    contextPercent: 42,
    contextWindow: { size: 1000000, used: 420000, cacheRead: 400000, cacheWrite: 19000, fresh: 1000, output: 300 },
    tokens: { fresh: 3000, cacheWrite: 57000, cacheRead: 1200000, output: 900 },
    comment: null,
    phase: null,
    color: '#61afef',
    title: '◐ proj',
    transcriptPath: null,
    liveReply: null,
    liveTool: null,
    claudeSessionId: 'claude-1',
    remoteSessionId: null,
    startHead: null,
    pid: 42,
    exitCode: null,
    createdAt: 1000,
    ...over,
  };
}

test('toPersisted keeps identity and records the exit only for exited sessions', () => {
  assert.deepEqual(toPersisted(info({})), {
    id: 'a',
    kind: 'claude',
    name: 'proj',
    spawnCwd: 'C:\\work\\proj',
    args: ['--model', 'opus'],
    shell: null,
    autoName: true,
    cwd: 'C:\\work\\proj\\src',
    groupCwd: 'C:\\work\\proj\\src',
    claudeSessionId: 'claude-1',
    remoteSessionId: null,
    startHead: null,
    conversation: { id: 'claude-1', cwd: 'C:\\work\\proj', args: ['--model', 'opus'] },
    spans: [],
    commits: [],
    touched: [],
    lastPrompt: 'commit this',
    lastReply: 'Committed as 97af82b.',
    lastPromptAt: 1500,
    lastReplyAt: 1900,
    model: 'Fable',
    contextPercent: 42,
    contextWindow: { size: 1000000, used: 420000, cacheRead: 400000, cacheWrite: 19000, fresh: 1000, output: 300 },
    tokens: { fresh: 3000, cacheWrite: 57000, cacheRead: 1200000, output: 900 },
    costUsd: null,
    tasks: [],
    lastScreen: null,
    comment: null,
    phase: null,
    color: '#61afef',
    scheme: null,
    keepWhole: false,
    createdAt: 1000,
    exitCode: null,
    exitedAt: null,
    removedAt: null,
  });
  const exited = toPersisted(info({ state: 'exited', exitCode: 3, stateSince: 9000, pid: null }));
  assert.equal(exited.exitCode, 3);
  assert.equal(exited.exitedAt, 9000);
});

test('save writes through a temp file and load reads it back', () => {
  const file = tempFile();
  const store = new SessionStore(file, silentLogger);
  assert.deepEqual(store.load(), [], 'no file yet');
  store.save([info({}), info({ id: 'b', kind: 'shell', state: 'exited', exitCode: 0, stateSince: 5000, claudeSessionId: null })]);
  assert.ok(!fs.existsSync(`${file}.tmp`), 'temp file was renamed away');
  const loaded = store.load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.kind, s.exitCode, s.exitedAt]),
    [
      ['a', 'claude', null, null],
      ['b', 'shell', 0, 5000],
    ],
  );
  assert.deepEqual(loaded[0]!.args, ['--model', 'opus'], 'args round trip');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number };
  assert.equal(raw.version, 1);
});

test('load fills in args and autoName for entries written before they were persisted', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { args: _dropped, autoName: _alsoDropped, ...old } = toPersisted(info({}));
  const { autoName: _dropped2, ...named } = toPersisted(info({ id: 'c', name: 'mine' }));
  const bad = { ...toPersisted(info({ id: 'b' })), args: ['--model', 7] };
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, named, bad] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.args, s.autoName]),
    [
      ['a', [], true],
      ['c', ['--model', 'opus'], false],
    ],
    'old entries load with no args; a name still equal to the folder counts as automatic; a non-string arg drops the entry',
  );
});

test('load fills in a null last turn for entries written before M9 fix 8', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { lastPrompt: _p, lastReply: _r, lastPromptAt: _pa, lastReplyAt: _ra, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b' }))] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.lastPrompt, s.lastReply, s.lastPromptAt, s.lastReplyAt]),
    [
      ['a', null, null, null, null],
      ['b', 'commit this', 'Committed as 97af82b.', 1500, 1900],
    ],
  );
  // M73: a time that is not a number reads as none, and since M9 fix 458
  // the entry is kept rather than skipped.
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [{ ...toPersisted(info({})), lastReplyAt: 'noon' }] }));
  assert.deepEqual(new SessionStore(file, silentLogger).load().map((s) => [s.id, s.lastReply, s.lastReplyAt]), [['a', 'Committed as 97af82b.', null]]);
});

test('the group folder round trips and loads as the live folder for entries written before M9 fix 60', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { groupCwd: _g, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b', groupCwd: 'C:\\work\\proj' })), { ...toPersisted(info({ id: 'c' })), groupCwd: 7 }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.groupCwd]),
    [
      ['a', 'C:\\work\\proj\\src'],
      ['b', 'C:\\work\\proj'],
    ],
    'a wrong shape drops the entry, as any identity field does',
  );
});

test('load gives a colour to entries written before M24 and replaces one of the wrong shape', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { color: _c, ...old } = toPersisted(info({}));
  const { color: _d, ...old2 } = toPersisted(info({ id: 'b' }));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, old2, { ...toPersisted(info({ id: 'c' })), color: 'red' }, toPersisted(info({ id: 'd', color: SESSION_COLORS[11] }))] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(loaded.map((s) => s.id), ['a', 'b', 'c', 'd'], 'nothing is dropped over a colour');
  for (const s of loaded) assert.ok(isSessionColor(s.color) && (SESSION_COLORS as readonly string[]).includes(s.color), `${s.id} has a palette colour`);
  assert.equal(loaded[3]!.color, SESSION_COLORS[11], 'a good colour is kept');
  assert.equal(new Set(loaded.map((s) => s.color)).size, 4, 'the given colours avoid each other and the kept one');
});

test('load fills in a null model and context for entries written before M16', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { model: _m, contextPercent: _c, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b' })), { ...toPersisted(info({ id: 'c' })), contextPercent: 'lots' }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.model, s.contextPercent]),
    [
      ['a', null, null],
      ['b', 'Fable', 42],
      ['c', 'Fable', null],
    ],
    'old entries load with nothing known; a percent that is not a number reads as none (M9 fix 458)',
  );
});

test('the context window counts round trip, load as null for entries written before M42, and a bad shape reads as none', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { contextWindow: _w, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b' })), { ...toPersisted(info({ id: 'c' })), contextWindow: { size: 'big' } }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.contextWindow]),
    [
      ['a', null],
      ['b', { size: 1000000, used: 420000, cacheRead: 400000, cacheWrite: 19000, fresh: 1000, output: 300 }],
      ['c', null],
    ],
    'an old entry loads with nothing known; a malformed one reads as none rather than dropping the session',
  );
});

test('the running token sum round trips, loads as null for entries written before M9 fix 143, and a bad shape reads as none', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { tokens: _t, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b' })), { ...toPersisted(info({ id: 'c' })), tokens: { fresh: 'many' } }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.tokens]),
    [
      ['a', null],
      ['b', { fresh: 3000, cacheWrite: 57000, cacheRead: 1200000, output: 900 }],
      ['c', null],
    ],
    'an old entry loads with no sum; a malformed one reads as none rather than dropping the session',
  );
});

test('the cost round trips, loads as null for entries written before M9 fix 154, and a bad shape reads as none', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { costUsd: _c, ...old } = toPersisted(info({}));
  assert.equal(toPersisted(info({ costUsd: 1.4029585 })).costUsd, 1.4029585);
  assert.equal(toPersisted(info({})).costUsd, null, 'a record from before the field persists as none');
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b', costUsd: 6.797 })), { ...toPersisted(info({ id: 'c' })), costUsd: 'lots' }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.costUsd]),
    [
      ['a', null],
      ['b', 6.797],
      ['c', null],
    ],
    'an old entry loads with no cost; a malformed one reads as none rather than dropping the session',
  );
});

test('the colour scheme round trips, loads as null for entries written before M9 fix 244, and a bad shape reads as none', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { scheme: _s, ...old } = toPersisted(info({}));
  assert.equal(toPersisted(info({ scheme: 'Solarized Dark' })).scheme, 'Solarized Dark');
  assert.equal(toPersisted(info({})).scheme, null, 'a record from before the field persists as none');
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b', scheme: 'Dracula' })), { ...toPersisted(info({ id: 'c' })), scheme: 7 }, { ...toPersisted(info({ id: 'd' })), scheme: '' }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.scheme]),
    [
      ['a', null],
      ['b', 'Dracula'],
      ['c', null],
      ['d', null],
    ],
    "an old entry loads on the window's scheme; a malformed or empty one reads as none rather than dropping the session",
  );
});

test('the keep-whole mark round trips, loads as not marked for entries written before M9 fix 773, and a bad shape reads as not marked', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { keepWhole: _k, ...old } = toPersisted(info({}));
  assert.equal(toPersisted(info({ keepWhole: true })).keepWhole, true);
  assert.equal(toPersisted(info({})).keepWhole, false, 'a record from before the field persists as not marked');
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b', keepWhole: true })), { ...toPersisted(info({ id: 'c' })), keepWhole: 'yes' }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.keepWhole]),
    [
      ['a', false],
      ['b', true],
      ['c', false],
    ],
  );
});

test('the shell round trips, and an entry with none or one of the wrong shape loads as none and is kept (M9 fix 624)', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const shellInfo = (id: string, over: Partial<SessionInfo> = {}) => info({ id, kind: 'shell', args: [], conversation: null, claudeSessionId: null, ...over });
  assert.equal(toPersisted(shellInfo('x', { shell: 'gitbash' })).shell, 'gitbash');
  const { shell: _s, ...old } = toPersisted(shellInfo('a'));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [toPersisted(shellInfo('g', { shell: 'gitbash' })), old, { ...toPersisted(shellInfo('z')), shell: 'zsh' }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.shell]),
    [
      ['g', 'gitbash'],
      ['a', null],
      ['z', null],
    ],
    'a record from before the field, or with a shell no daemon knows, resumes in the default rather than dropping the session',
  );
});

test('the conversation round trips, and an entry written before M48 gets one from its bound id (M48)', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { conversation: _c, ...oldClaude } = toPersisted(info({}));
  const { conversation: _s, ...oldShell } = toPersisted(info({ id: 'b', kind: 'shell', args: ['-NoProfile'] }));
  const { conversation: _u, ...oldUnbound } = toPersisted(info({ id: 'c', claudeSessionId: null }));
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      sessions: [
        oldClaude,
        oldShell,
        oldUnbound,
        toPersisted(info({ id: 'd', kind: 'shell', conversation: { id: 'conv-d', cwd: 'C:\\work\\proj\\src', args: [] } })),
        { ...toPersisted(info({ id: 'e' })), conversation: { id: 'conv-e' } },
      ],
    }),
  );
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.conversation]),
    [
      ['a', { id: 'claude-1', cwd: 'C:\\work\\proj', args: ['--model', 'opus'] }],
      ['b', { id: 'claude-1', cwd: 'C:\\work\\proj\\src', args: [] }],
      ['c', null],
      ['d', { id: 'conv-d', cwd: 'C:\\work\\proj\\src', args: [] }],
      ['e', null],
    ],
    'a Claude entry resumes in spawnCwd with its args, a shell where it was with none, an unbound one has nothing, and a bad shape reads as none',
  );
});

test('the checkpoint round trips, loads as null for entries written before M18, and a bad phase reads as none', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { comment: _c, phase: _p, ...old } = toPersisted(info({}));
  const withCheckpoint = toPersisted(info({ id: 'b', comment: 'reproduced; testing the fix', phase: 'in-progress' }));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, withCheckpoint, { ...toPersisted(info({ id: 'c', comment: 'kept' })), phase: 'shipping' }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.comment, s.phase]),
    [
      ['a', null, null],
      ['b', 'reproduced; testing the fix', 'in-progress'],
      ['c', 'kept', null],
    ],
  );
});

test('a wrongly typed decoration field reads as none and keeps the record, where a bad identity field still drops it (M9 fix 458)', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const good = toPersisted(info({ id: 'good', comment: 'c', phase: 'in-review' }));
  const bad = {
    ...toPersisted(info({ id: 'bad' })),
    lastPrompt: 7,
    lastReply: { text: 'x' },
    lastPromptAt: '1500',
    lastReplyAt: true,
    model: ['opus'],
    contextPercent: '40',
    comment: 12,
    phase: { name: 'testing' },
  };
  const noCreated = { ...toPersisted(info({ id: 'noCreated' })), createdAt: 'yesterday' };
  const badExit = { ...toPersisted(info({ id: 'badExit' })), exitCode: '0' };
  const badRemoved = { ...toPersisted(info({ id: 'badRemoved' })), removedAt: 'x' };
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [good, bad, noCreated, badExit, badRemoved] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(loaded.map((s) => s.id), ['good', 'bad'], 'the identity fields still drop');
  const b = loaded[1]!;
  assert.deepEqual(
    [b.lastPrompt, b.lastReply, b.lastPromptAt, b.lastReplyAt, b.model, b.contextPercent, b.comment, b.phase],
    [null, null, null, null, null, null, null, null],
  );
  assert.equal(b.claudeSessionId, bad.claudeSessionId, 'the rest of the record is whole');
  assert.equal(loaded[0]!.phase, 'in-review');
});

test('load skips bad entries and survives a corrupt file', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const good = toPersisted(info({}));
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, sessions: [good, { id: 'x' }, { ...good, kind: 'wsl' }, { ...good }, 'nope'] }),
  );
  const store = new SessionStore(file, silentLogger);
  assert.deepEqual(store.load(), [good], 'one good entry, duplicate and malformed ones dropped');

  // A file the store cannot read is set aside whole beside the new one
  // (M9 fix 457), so the next save does not overwrite it.
  for (const contents of ['{not json', '{"version":2,"sessions":[]}', '[]']) {
    fs.writeFileSync(file, contents);
    assert.deepEqual(store.load(), [], contents);
    assert.equal(fs.existsSync(file), false, `${contents}: the bad file is moved away`);
  }
  const aside = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('sessions.json.bad-')).sort();
  assert.equal(aside.length, 3, 'one set-aside file per bad read');
  assert.deepEqual(
    aside.map((n) => fs.readFileSync(path.join(path.dirname(file), n), 'utf8')).sort(),
    ['{"version":2,"sessions":[]}', '[]', '{not json'].sort(),
    'each keeps the bytes it had',
  );
  store.save([info({ id: 'new' })]);
  assert.equal(fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('sessions.json.bad-')).length, 3, 'the next save leaves them be');
});

test('the commits round trip with their times, a bare hash from before M58 reads at time zero, and a bad shape reads as none (M49, M58)', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const h1 = '0'.repeat(40);
  const h2 = 'f'.repeat(40);
  const { commits: _c, ...old } = toPersisted(info({}));
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      sessions: [
        toPersisted(info({ commits: [{ hash: h1, at: 10 }, { hash: h2, at: 20, agent: { id: 'ag1', branch: 'wt', type: 'fork', description: 'the lane' } }] })),
        { ...toPersisted(info({ id: 'b' })), commits: [h1, 'abc', 7, null, { hash: h2, at: 'soon' }, { hash: 'abc', at: 5 }, { hash: h2, at: 30, agent: { branch: 'wt' } }] },
        { ...toPersisted(info({ id: 'c' })), commits: 'nope' },
        { ...old, id: 'd' },
      ],
    }),
  );
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.commits]),
    [
      ['a', [{ hash: h1, at: 10 }, { hash: h2, at: 20, agent: { id: 'ag1', branch: 'wt', type: 'fork', description: 'the lane' } }]],
      ['b', [{ hash: h1, at: 0 }, { hash: h2, at: 30 }]],
      ['c', []],
      ['d', []],
    ],
    "full hashes kept in order with their times and the agent on a folded one (M9 fix 138), a bare one at zero, an agent with no id dropped to the session's own, anything else dropped entry by entry",
  );
});

test('the start commit round trips, loads as null for entries written before M9 fix 117, and a bad shape reads as none', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const h = 'c'.repeat(40);
  const { startHead: _s, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [toPersisted(info({ startHead: h })), { ...old, id: 'b' }, { ...toPersisted(info({ id: 'c' })), startHead: 7 }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.startHead]),
    [
      ['a', h],
      ['b', null],
      ['c', null],
    ],
  );
});

test('removedAt round trips, loads as null for entries written before M57, and the file keeps the newest REMOVED_KEPT removed records (M57)', () => {
  const file = tempFile();
  const store = new SessionStore(file, silentLogger);
  const removed = Array.from({ length: REMOVED_KEPT + 3 }, (_, i) => info({ id: `r${i}`, state: 'exited', stateSince: 100 + i, removedAt: 1000 + i }));
  store.save([info({ id: 'live' }), ...removed]);
  const loaded = store.load();
  assert.equal(loaded.length, REMOVED_KEPT + 1, 'the listed one and the cap of removed');
  assert.equal(loaded[0]?.id, 'live', 'listed first');
  assert.equal(loaded[0]?.removedAt, null);
  assert.equal(loaded[1]?.id, 'r3', 'the three oldest removed are dropped');
  assert.equal(loaded[1]?.removedAt, 1003);
  assert.equal(loaded[loaded.length - 1]?.id, `r${REMOVED_KEPT + 2}`);
  // A file written before M57 has no removedAt: the entry is a listed one.
  const { removedAt: _r, ...old } = toPersisted(info({ id: 'old' }));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, { ...toPersisted(info({ id: 'bad' })), removedAt: 'soon' }] }));
  const again = store.load();
  assert.deepEqual(again.map((s) => [s.id, s.removedAt]), [['old', null]], 'no removedAt reads as listed; a bad one drops the entry');
});

test("Claude's task list round trips, loads as none for entries written before M9 fix 153, and a bad entry is skipped", () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tasks = [
    { id: '1', subject: 'Extend the row', activeForm: 'Extending the row', status: 'completed' as const },
    { id: '2', subject: 'Wire the hooks', activeForm: null, status: 'in_progress' as const },
  ];
  const { tasks: _t, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, toPersisted(info({ id: 'b', tasks })), { ...toPersisted(info({ id: 'c' })), tasks: [{ subject: 'no status' }, tasks[0]] }] }));
  const loaded = new SessionStore(file, silentLogger).load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.tasks]),
    [
      ['a', []],
      ['b', tasks],
      ['c', [tasks[0]]],
    ],
    'an old entry loads with no list; an entry that is not a task is skipped rather than dropping the session',
  );
});

test('the kept screen round trips beside its record, loads as none for entries written before M9 fix 159, and a bad shape reads as none', () => {
  const file = tempFile();
  const store = new SessionStore(file, silentLogger);
  const screen = { rows: ['$ npm test', '', '  12 passing'], cursor: { x: 2, y: 3 } };
  store.save([info({}), info({ id: 'b', state: 'exited', exitCode: 0, stateSince: 5000 })], new Map([['b', screen]]));
  const loaded = store.load();
  assert.deepEqual(
    loaded.map((s) => [s.id, s.lastScreen]),
    [
      ['a', null],
      ['b', screen],
    ],
    'the frame rides the record it was kept on',
  );
  const { lastScreen: _dropped, ...old } = toPersisted(info({}));
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [old, { ...toPersisted(info({ id: 'c' })), lastScreen: { rows: ['ok', 3] } }] }));
  assert.deepEqual(
    store.load().map((s) => [s.id, s.lastScreen]),
    [
      ['a', null],
      ['c', null],
    ],
    'an old entry loads with no frame; a frame of the wrong shape reads as none rather than dropping the session',
  );
});
