import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from '@emerald/shared';
import { nameActivity, needsHistoryTitles, transcriptsByRemoteId } from './history-index.ts';
import { anActivitySession } from './test-support.ts';

function row(over: Partial<ActivitySession>): ActivitySession {
  return anActivitySession({ sessionId: 's', name: null, ...over });
}

test('nameActivity: an unnamed track takes the transcript title of its conversation, a named one keeps its name (M57)', () => {
  const titles = new Map([['c-1', 'Backlog review'], ['c-2', 'The batch']]);
  const rows = [row({ sessionId: 'a', name: 'kept', claudeSessionId: 'c-1' }), row({ sessionId: 'b', claudeSessionId: 'c-2' }), row({ sessionId: 'c', claudeSessionId: 'c-9' }), row({ sessionId: 'd' })];
  assert.deepEqual(
    nameActivity(rows, titles).map((s) => s.name),
    ['kept', 'The batch', null, null],
  );
  assert.equal(needsHistoryTitles(rows), true, 'b and c have a conversation and no name');
  assert.equal(needsHistoryTitles([rows[0]!, rows[3]!]), false, 'a track with no conversation id has nothing to look up');
});

test('transcriptsByRemoteId reaches one transcript by every id it names, the first to name an id keeping it (M70)', () => {
  const t = (id: string, remoteIds: string[]) => ({ id, title: id, cwd: 'C:/x', cwdExists: true, path: id, startedAt: null, lastAt: null, remoteIds });
  const map = transcriptsByRemoteId([t('a', ['session_1', 'session_2']), t('b', ['session_2', 'session_3']), t('c', [])]);
  assert.deepEqual([...map.keys()], ['session_1', 'session_2', 'session_3']);
  assert.equal(map.get('session_1')!.id, 'a');
  assert.equal(map.get('session_2')!.id, 'a');
  assert.equal(map.get('session_3')!.id, 'b');
});
