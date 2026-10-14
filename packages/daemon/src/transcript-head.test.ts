import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { findRemoteSessionId, readRemoteSessionId, remoteSessionIdOf } from './transcript-head.ts';

const attachment = (url: string) => JSON.stringify({ parentUuid: 'p', isSidechain: false, attachment: { type: 'remote_session_change', url, commit: 'x' }, type: 'attachment', uuid: 'u' });

test('remoteSessionIdOf: the session token off the claude.ai URL', () => {
  assert.equal(remoteSessionIdOf('https://claude.ai/code/session_016dsNFgEPpQnBDuqkFtUvnv'), 'session_016dsNFgEPpQnBDuqkFtUvnv');
  assert.equal(remoteSessionIdOf('https://claude.ai/code/session_01abc/'), 'session_01abc');
  assert.equal(remoteSessionIdOf('https://claude.ai/code/'), null);
  assert.equal(remoteSessionIdOf(7), null);
});

test('findRemoteSessionId: the first remote_session_change attachment wins, other lines and torn ones are skipped', () => {
  const text = [
    JSON.stringify({ type: 'user', message: { content: 'remote_session_change is mentioned here' } }),
    '{"type":"attachment","attachment":{"type":"remote_session_change","url":"https://claude.ai/code/session_torn',
    attachment('https://claude.ai/code/session_first'),
    attachment('https://claude.ai/code/session_second'),
  ].join('\n');
  assert.equal(findRemoteSessionId(text), 'session_first');
  assert.equal(findRemoteSessionId('{"type":"user"}\n'), null);
});

test.after(removeTemps);

test('readRemoteSessionId: reads the head of the file, and a missing file is null', async () => {
  const dir = mkTemp('emerald-head-');
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, `{"type":"user"}\n${attachment('https://claude.ai/code/session_abc')}\n`);
  assert.equal(await readRemoteSessionId(file), 'session_abc');
  assert.equal(await readRemoteSessionId(path.join(dir, 'missing.jsonl')), null);
});
