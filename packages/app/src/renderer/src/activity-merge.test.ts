import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityRequest, ActivitySession } from '@emerald/shared';
import { mergeRequests } from './activity-merge.ts';

const row = (requests: ActivityRequest[]): ActivitySession => ({ sessionId: 'a', name: 'a', color: null, kind: 'claude', claudeSessionId: null, removedAt: null, cwd: null, groupCwd: null, requests, commits: [], lifetime: false, spans: [{ from: 0, to: 100, prompt: null }], debt: [], awayMs: 0, cappedMs: 0, parentId: null, agentId: null, agentType: null, outside: false });
const point = (at: number, agent?: string): ActivityRequest => ({ at, fresh: 1, cacheWrite: 0, cacheRead: 0, output: 1, usd: agent === undefined ? 0.1 : 0, model: null, ...(agent === undefined ? {} : { agent, count: 2 }) });

test('mergeRequests keeps a session point and an agent point opened at one time, and two agents read at one Stop, apart (M9 fix 1189)', () => {
  const held = [row([point(10), point(50, 'ag1')])];
  const fresh = [row([point(50), point(50, 'ag2'), point(60)])];
  const merged = mergeRequests(held, fresh)[0]!.requests;
  assert.deepEqual(
    merged.map((r) => [r.at, r.agent ?? null]),
    [
      [10, null],
      [50, 'ag1'],
      [50, null],
      [50, 'ag2'],
      [60, null],
    ].sort((a, b) => (a[0] as number) - (b[0] as number)),
  );
  assert.equal(merged.length, 5);
  // The same point again replaces the held copy.
  const again = mergeRequests([row([{ ...point(10), output: 1 }])], [row([{ ...point(10), output: 9 }])])[0]!.requests;
  assert.deepEqual(again.map((r) => r.output), [9]);
});
