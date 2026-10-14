import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityStats, weekProfiles } from '@emerald/shared';
import type { ActivitySession } from '@emerald/shared';
import { renderActivity, renderWeek } from './activity.ts';

const day = new Date(2026, 8, 13).getTime();
const MIN = 60_000;

test('renderActivity: the stats line, then one line per session with its spans as clock times, an agent indented under its parent', () => {
  const sessions: ActivitySession[] = [
    { sessionId: '0123456789abcdef', name: 'emerald', color: '#123456', kind: 'claude', claudeSessionId: 'c-0123', removedAt: null, cwd: null, groupCwd: null, requests: [], lifetime: false, spans: [{ from: day + 552 * MIN, to: day + 558 * MIN, prompt: 'plan' }, { from: day + 600 * MIN, to: day + 700 * MIN, prompt: 'code' }], parentId: null, agentId: null, agentType: null },
    { sessionId: '0123456789abcdef', name: 'fix-title: fixes 93 and 96', color: '#123456', kind: 'agent', claudeSessionId: null, removedAt: null, cwd: null, groupCwd: null, requests: [], lifetime: false, spans: [{ from: day + 610 * MIN, to: day + 640 * MIN, prompt: null }], parentId: '0123456789abcdef', agentId: 'a1b2c3d4e5f6', agentType: 'fork' },
    { sessionId: '0123456789abcdef', name: 'Explore', color: '#123456', kind: 'agent', claudeSessionId: null, removedAt: null, cwd: null, groupCwd: null, requests: [], lifetime: false, spans: [{ from: day + 620 * MIN, to: day + 625 * MIN, prompt: null }], parentId: '0123456789abcdef', agentId: 'ffeeddccbbaa', agentType: 'Explore' },
    { sessionId: 'fedcba9876543210', name: null, color: null, kind: 'shell', claudeSessionId: null, removedAt: null, cwd: null, groupCwd: null, requests: [], lifetime: true, spans: [{ from: day + 540 * MIN, to: day + 720 * MIN, prompt: null }], parentId: null, agentId: null, agentType: null },
  ];
  const stats = activityStats(sessions, day, day + 720 * MIN);
  const lines = renderActivity('2026-09-13', sessions, stats, true);
  // The agents count: 1h 46m of the session plus 30m and 5m of its agents, in the session's 1h 46m.
  assert.equal(lines[0], '2026-09-13 (today) · 2h 21m agent time in 1h 46m · 1.3× parallel · peak 3');
  assert.equal(lines[1], '  01234567  agent   1h 46m  emerald  09:12 to 09:18, 10:00 to 11:40');
  assert.equal(lines[2], '    a1b2c3d4  agent      30m  fix-title: fixes 93 and 96 (fork)  10:10 to 10:40');
  assert.equal(lines[3], '    ffeeddcc  agent       5m  Explore  10:20 to 10:25');
  assert.equal(lines[4], '  fedcba98  shell       3h  no longer listed  09:00 to 12:00');
});

// M9 fix 230: the week as text.
test('renderWeek: the week line, then a line per day with its peak, its agent time and its steps', () => {
  const monday = new Date(2026, 8, 14).getTime();
  const tuesday = new Date(2026, 8, 15).getTime();
  const sessions = [
    { sessionId: 'a', name: 'a', color: null, kind: 'claude', lifetime: false, spans: [{ from: monday + 552 * MIN, to: monday + 600 * MIN, prompt: null }], parentId: null, agentId: null, agentType: null, requests: [] },
    { sessionId: 'b', name: 'b', color: null, kind: 'claude', lifetime: false, spans: [{ from: monday + 570 * MIN, to: monday + 580 * MIN, prompt: null }], parentId: null, agentId: null, agentType: null, requests: [] },
  ] as unknown as ActivitySession[];
  const now = tuesday + 12 * 60 * MIN;
  const lines = renderWeek('week of Mon 14 Sep', weekProfiles(sessions, monday, now), true);
  // M9 fix 274: the wall time (48m, 09:12 to 10:00) and the parallelism
  // it implies (58m of agent time over it) lead the line, the peak after.
  assert.equal(lines[0], 'week of Mon 14 Sep (this week) · 1.0 agent-hours in 0.8 · 1.2× parallel · peak 2 Mon 14 09:30 · busiest hour 09:00 across the week');
  assert.equal(lines[1], '  2026-09-14  Mon 14  peak  2      58m  09:12 1 → 09:30 2 → 09:40 1 → 10:00 0');
  assert.equal(lines[2], '  2026-09-15  Tue 15  peak  0       0s (today)');
  assert.equal(lines[3], '  2026-09-16  Wed 16  peak  0       0s (not yet)');
  assert.equal(lines.length, 8);
});
