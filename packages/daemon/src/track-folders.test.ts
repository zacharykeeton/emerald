import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TRACK_FOLDERS_NAME, readTrackFolders, writeTrackFoldersOnce } from './track-folders.ts';

// M9 fix 1187: the track folders written once from the session records
// and Claude Code's prompt history.

function scratch(): { dir: string; logs: string; sessions: string; history: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-track-folders-'));
  return { dir, logs: path.join(dir, 'logs'), sessions: path.join(dir, 'sessions.json'), history: path.join(dir, 'history.jsonl') };
}

function recorder(): { log: { info(msg: string, extra?: unknown): void; warn(msg: string, extra?: unknown): void; error(): void }; infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return { log: { info: (msg) => infos.push(msg), warn: (msg) => warns.push(msg), error() {} }, infos, warns };
}

test('the record and history folders are written as they stand, the first project winning and no prompt text kept (M9 fix 1187)', () => {
  const s = scratch();
  fs.writeFileSync(
    s.sessions,
    JSON.stringify({
      version: 1,
      sessions: [
        { id: 'listed', cwd: 'C:/code/a', groupCwd: 'C:/code/a', removedAt: null, name: 'a name' },
        { id: 'gone', cwd: 'C:/code/b/wt', groupCwd: 'C:/code/b', removedAt: 5 },
        { id: 'old', cwd: 'C:/code/c' },
      ],
    }),
  );
  fs.writeFileSync(
    s.history,
    [
      JSON.stringify({ display: 'first', sessionId: 'c-1', project: 'C:/code/a' }),
      JSON.stringify({ display: 'second', sessionId: 'c-1', project: 'C:/code/z' }),
      '{"display": "torn',
      JSON.stringify({ display: 'secret prompt', sessionId: 'c-2', project: 'C:/code/b' }),
    ].join('\n') + '\n',
  );
  const r = recorder();
  writeTrackFoldersOnce(s.logs, s.sessions, s.history, r.log);
  const text = fs.readFileSync(path.join(s.logs, TRACK_FOLDERS_NAME), 'utf8');
  assert.equal(text.includes('secret prompt'), false);
  assert.equal(text.includes('a name'), false);
  const read = readTrackFolders(s.logs, r.log);
  assert.deepEqual(read, {
    sessions: { listed: { cwd: 'C:/code/a', groupCwd: 'C:/code/a' }, gone: { cwd: 'C:/code/b/wt', groupCwd: 'C:/code/b' }, old: { cwd: 'C:/code/c', groupCwd: 'C:/code/c' } },
    conversations: { 'c-1': 'C:/code/a', 'c-2': 'C:/code/b' },
  });
  assert.deepEqual(r.warns, []);
  assert.deepEqual(r.infos, ['track folders written']);
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test('with neither file present the map is empty and nothing is warned (M9 fix 1187)', () => {
  const s = scratch();
  const r = recorder();
  writeTrackFoldersOnce(s.logs, s.sessions, s.history, r.log);
  assert.deepEqual(readTrackFolders(s.logs, r.log), { sessions: {}, conversations: {} });
  assert.deepEqual(r.warns, []);
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test('a written file is never rewritten (M9 fix 1187)', () => {
  const s = scratch();
  fs.writeFileSync(s.sessions, JSON.stringify({ version: 1, sessions: [{ id: 'a', cwd: 'C:/code/a' }] }));
  const r = recorder();
  writeTrackFoldersOnce(s.logs, s.sessions, s.history, r.log);
  const file = path.join(s.logs, TRACK_FOLDERS_NAME);
  const before = fs.readFileSync(file);
  fs.writeFileSync(s.sessions, JSON.stringify({ version: 1, sessions: [{ id: 'a', cwd: 'C:/code/a' }, { id: 'b', cwd: 'C:/code/b' }] }));
  writeTrackFoldersOnce(s.logs, s.sessions, s.history, r.log);
  assert.deepEqual(fs.readFileSync(file), before);
  fs.rmSync(s.dir, { recursive: true, force: true });
});

test('a sessions.json that does not parse writes nothing and warns once (M9 fix 1187)', () => {
  const s = scratch();
  fs.writeFileSync(s.sessions, '{"sessions": [');
  const r = recorder();
  writeTrackFoldersOnce(s.logs, s.sessions, s.history, r.log);
  assert.equal(fs.existsSync(path.join(s.logs, TRACK_FOLDERS_NAME)), false);
  assert.deepEqual(r.warns, ['track folders not written: sessions.json could not be read']);
  fs.rmSync(s.dir, { recursive: true, force: true });
});
