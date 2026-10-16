import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepFold, stepList, stepState } from '@emerald/shared';
import { LIVE_ROW_MS, dropTaken, liveTurns } from './chat-feed.ts';
import type { LiveRow } from './chat-feed.ts';

// M9 fix 769: the mod's rows over the file's turns.
const fileLine = (o: Record<string, unknown>) => JSON.stringify(o);
const prompt = fileLine({ type: 'user', uuid: 'f-p', timestamp: 1000, message: { role: 'user', content: 'read the notes' } });
const call = fileLine({ type: 'assistant', uuid: 'f-t', timestamp: 2000, message: { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'C:/n.md' } }] } });
const row = (uuid: string, content: unknown[], type: 'user' | 'assistant' = 'assistant', came = 0): LiveRow => ({ uuid, at: 3000, row: { type, content }, cut: false, came });

test('liveTurns: a live tool_result shows its result while the file state keeps the call pending', () => {
  const state = stepState();
  stepFold(state, [prompt, call].join('\n'));
  const turns = liveTurns(state, [row('m-r', [{ type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'text', text: 'one' }] }], 'user')]);
  const drawn = turns[0]!.steps[0]!;
  assert.ok(drawn.kind === 'tool' && drawn.result !== null);
  const filed = stepList(state)[0]!.steps[0]!;
  assert.ok(filed.kind === 'tool' && filed.result === null);
});

test('liveTurns: a row the file has folded is drawn once, from the file; a cut row is never drawn', () => {
  const state = stepState();
  const reply = fileLine({ type: 'assistant', uuid: 'm-a', timestamp: 3000, message: { role: 'assistant', content: [{ type: 'text', text: 'Read them.' }] } });
  stepFold(state, [prompt, call, reply].join('\n'));
  const turns = liveTurns(state, [row('m-a', [{ type: 'text', text: 'Read them.' }]), { ...row('m-cut', []), cut: true }]);
  assert.equal(turns[0]!.steps.filter((s) => s.kind === 'text').length, 1);
  assert.deepEqual(turns, stepList(state));
});

test('dropTaken: drops a row the file took and one older than LIVE_ROW_MS, keeps the rest in order', () => {
  const now = 100_000;
  const live = [row('a', [], 'assistant', now - 10), row('taken', [], 'assistant', now - 10), row('old', [], 'assistant', now - LIVE_ROW_MS), row('b', [], 'assistant', now - 5)];
  assert.deepEqual(dropTaken(live, new Set(['taken']), now).map((r) => r.uuid), ['a', 'b']);
  // Nothing to drop: the same array.
  const kept = [row('a', [], 'assistant', now)];
  assert.equal(dropTaken(kept, new Set(), now), kept);
});
