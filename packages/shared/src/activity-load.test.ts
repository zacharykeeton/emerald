import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from './activity.ts';
import { activityLoad, loadAt, pickHead, pickRows, weekProfiles, weekStats, weekStatsHead, weekStatsText } from './activity-load.ts';
import { activityStats } from './activity-model.ts';

const MIN = 60_000;

function session(id: string, spans: Array<[number, number]>, lifetime = false): ActivitySession {
  return { sessionId: id, name: id, color: null, kind: lifetime ? 'shell' : 'claude', lifetime, spans: spans.map(([from, to]) => ({ from: from * MIN, to: to * MIN, prompt: null })) } as ActivitySession;
}

const fixtures: Array<[string, ActivitySession[], number, number]> = [
  ['overlapping and apart', [session('a', [[0, 10]]), session('b', [[5, 15]]), session('c', [[20, 22]])], 0, 60 * MIN],
  ['nested', [session('a', [[0, 10]]), session('b', [[2, 4]])], 0, 60 * MIN],
  ['touching', [session('a', [[0, 10]]), session('b', [[10, 20]])], 0, 60 * MIN],
  ['a lifetime span and a clip', [session('sh', [[0, 50]], true), session('a', [[0, 10]])], 5 * MIN, 60 * MIN],
  ['a fan-out', [session('p', [[0, 30]]), session('q', [[5, 8]]), session('r', [[5, 9]]), session('s', [[6, 7]])], 0, 30 * MIN],
  ['nothing', [], 0, 60 * MIN],
];

test('the steps are the open count at every change, closed on the baseline at both ends', () => {
  const load = activityLoad([session('a', [[0, 10]]), session('b', [[5, 15]]), session('c', [[20, 22]])], 0, 60 * MIN);
  assert.deepEqual(load.steps, [
    { at: 0, open: 1 },
    { at: 5 * MIN, open: 2 },
    { at: 10 * MIN, open: 1 },
    { at: 15 * MIN, open: 0 },
    { at: 20 * MIN, open: 1 },
    { at: 22 * MIN, open: 0 },
    { at: 60 * MIN, open: 0 },
  ]);
  assert.equal(load.peak, 2);
});

test('an end and a start at one instant leave the count where it was, and a span past the window is clipped', () => {
  const touching = activityLoad([session('a', [[0, 10]]), session('b', [[10, 20]])], 0, 60 * MIN);
  assert.deepEqual(touching.steps, [
    { at: 0, open: 1 },
    { at: 20 * MIN, open: 0 },
    { at: 60 * MIN, open: 0 },
  ]);
  const clipped = activityLoad([session('sh', [[0, 50]], true), session('a', [[0, 10]])], 5 * MIN, 60 * MIN);
  assert.deepEqual(clipped.steps, [
    { at: 5 * MIN, open: 1 },
    { at: 10 * MIN, open: 0 },
    { at: 60 * MIN, open: 0 },
  ]);
});

test('the peak is the stats line\'s peak on every fixture', () => {
  for (const [name, sessions, from, to] of fixtures) {
    assert.equal(activityLoad(sessions, from, to).peak, activityStats(sessions, from, to).peak, name);
  }
});

test('the median is time-weighted over the busy stretches', () => {
  // The fan-out: level 1 for 0 to 5 and 9 to 30 (26 minutes), 3 for 5 to
  // 6 and 7 to 8 (2 minutes), 4 for 6 to 7 (1 minute), 2 for 8 to 9 (1
  // minute); 30 busy minutes, and the halfway point falls in level 1.
  const fan = activityLoad([session('p', [[0, 30]]), session('q', [[5, 8]]), session('r', [[5, 9]]), session('s', [[6, 7]])], 0, 30 * MIN);
  assert.equal(fan.peak, 4);
  assert.equal(fan.median, 1);
  // Two at 0 to 10 and one at 10 to 12: 10 minutes at level 2 against 2 at
  // level 1, so the median is 2 though the levels are two of each.
  const two = activityLoad([session('a', [[0, 10]]), session('b', [[0, 12]])], 0, 60 * MIN);
  assert.equal(two.median, 2);
  // Ten minutes at 1 and ten at 2: the halfway point is the end of the
  // level 1 stretch, which counts as reached.
  const even = activityLoad([session('a', [[0, 20]]), session('b', [[10, 20]])], 0, 60 * MIN);
  assert.equal(even.median, 1);
});

test('an empty window is a flat baseline with a peak and a median of 0', () => {
  const load = activityLoad([], 0, 60 * MIN);
  assert.deepEqual(load, { steps: [{ at: 0, open: 0 }, { at: 60 * MIN, open: 0 }], peak: 0, median: 0 });
  assert.deepEqual(activityLoad([session('sh', [[0, 50]], true)], 0, 60 * MIN).peak, 0);
});

test('loadAt reads the level in force at an instant', () => {
  const load = activityLoad([session('a', [[0, 10]]), session('b', [[5, 15]])], 0, 60 * MIN);
  assert.equal(loadAt(load, -1), 0);
  assert.equal(loadAt(load, 0), 1);
  assert.equal(loadAt(load, 4 * MIN), 1);
  assert.equal(loadAt(load, 5 * MIN), 2);
  assert.equal(loadAt(load, 9 * MIN + 59_999), 2);
  assert.equal(loadAt(load, 10 * MIN), 1);
  assert.equal(loadAt(load, 15 * MIN), 0);
  assert.equal(loadAt(load, 90 * MIN), 0);
  assert.equal(loadAt({ steps: [], peak: 0, median: 0 }, 5), 0);
});

// M9 fix 230: the week's seven profiles.
test('weekProfiles splits the week into seven day rows, clipping a span across midnight onto both days, on one shared peak', () => {
  const monday = new Date(2026, 8, 14).getTime();
  const tuesday = new Date(2026, 8, 15).getTime();
  const abs = (day: number, minutes: number) => ({ from: day + minutes * MIN, to: 0, prompt: null });
  const spans = (day: number, list: Array<[number, number]>) => list.map(([f, t]) => ({ ...abs(day, f), to: day + t * MIN }));
  const sessions = [
    // Monday 23:30 to Tuesday 00:30, across midnight.
    { sessionId: 'a', name: 'a', color: null, kind: 'claude', lifetime: false, spans: spans(monday, [[23 * 60 + 30, 24 * 60 + 30]]) },
    // Tuesday 14:00 to 15:00, two at once with b for the peak.
    { sessionId: 'b', name: 'b', color: null, kind: 'claude', lifetime: false, spans: spans(tuesday, [[14 * 60, 15 * 60]]) },
    { sessionId: 'c', name: 'c', color: null, kind: 'claude', lifetime: false, spans: spans(tuesday, [[14 * 60, 14 * 60 + 30]]) },
  ] as unknown as ActivitySession[];
  // Now is Wednesday noon: Monday and Tuesday are past, Wednesday today, the rest future.
  const now = new Date(2026, 8, 16, 12).getTime();
  const week = weekProfiles(sessions, monday, now);
  assert.equal(week.rows.length, 7);
  assert.deepEqual(week.rows.map((r) => r.name), ['Mon 14', 'Tue 15', 'Wed 16', 'Thu 17', 'Fri 18', 'Sat 19', 'Sun 20']);
  assert.deepEqual(week.rows.map((r) => r.when), ['past', 'past', 'today', 'future', 'future', 'future', 'future']);
  assert.equal(week.peak, 2);
  assert.equal(week.rows[0]!.agentMs, 30 * MIN);
  assert.equal(week.rows[1]!.agentMs, 30 * MIN + 60 * MIN + 30 * MIN);
  assert.equal(week.rows[0]!.profile.peak, 1);
  assert.equal(week.rows[1]!.profile.peak, 2);
  // Monday's profile ends on its own midnight, Tuesday's begins on it, still open.
  assert.equal(week.rows[0]!.profile.steps[week.rows[0]!.profile.steps.length - 1]!.at, tuesday);
  assert.equal(loadAt(week.rows[1]!.profile, tuesday + 10 * MIN), 1);
  // Today's profile ends at now; a future day is a flat baseline over its whole day.
  assert.equal(week.rows[2]!.profile.steps[week.rows[2]!.profile.steps.length - 1]!.at, now);
  assert.deepEqual(week.rows[3]!.profile.steps.map((s) => s.open), [0, 0]);
  assert.equal(week.rows[3]!.to - week.rows[3]!.profile.steps[0]!.at, 24 * 60 * MIN);
  const stats = weekStats(week);
  assert.equal(stats.peak, 2);
  assert.equal(stats.peakDay, 'Tue 15');
  assert.equal(stats.peakAt, tuesday + 14 * 60 * MIN);
  assert.equal(stats.busiestHour, 14);
  assert.equal(stats.agentMs, 150 * MIN);
  // M9 fix 274: the wall time is each day's own stretch with the count
  // above zero (Monday's 30 minutes across midnight, Tuesday's 30 then
  // 60 overlapping at 14:00, not double counted), and the parallelism
  // the agent time over their sum.
  assert.equal(week.rows[0]!.wallMs, 30 * MIN);
  assert.equal(week.rows[1]!.wallMs, 30 * MIN + 60 * MIN);
  assert.equal(stats.wallMs, 120 * MIN);
  assert.equal(stats.parallel, 150 / 120);
  assert.equal(weekStatsText(stats), '2.5 agent-hours in 2.0 · 1.3× parallel · peak 2 Tue 15 14:00 · busiest hour 14:00 across the week');
  assert.equal(weekStatsText(weekStats(weekProfiles([], monday, now))), 'nothing yet');
});

// M9 fix 280: picking days to compare.
test('pickRows filters to the picked days and recomputes the peak over them alone', () => {
  const monday = new Date(2026, 8, 14).getTime();
  const tuesday = new Date(2026, 8, 15).getTime();
  const abs = (day: number, minutes: number) => ({ from: day + minutes * MIN, to: 0, prompt: null });
  const spans = (day: number, list: Array<[number, number]>) => list.map(([f, t]) => ({ ...abs(day, f), to: day + t * MIN }));
  const sessions = [
    { sessionId: 'a', name: 'a', color: null, kind: 'claude', lifetime: false, spans: spans(monday, [[23 * 60 + 30, 24 * 60 + 30]]) },
    { sessionId: 'b', name: 'b', color: null, kind: 'claude', lifetime: false, spans: spans(tuesday, [[14 * 60, 15 * 60]]) },
    { sessionId: 'c', name: 'c', color: null, kind: 'claude', lifetime: false, spans: spans(tuesday, [[14 * 60, 14 * 60 + 30]]) },
  ] as unknown as ActivitySession[];
  const now = new Date(2026, 8, 16, 12).getTime();
  const week = weekProfiles(sessions, monday, now);
  // Monday and Wednesday: Monday peaks at 1, Wednesday (today, nothing
  // seeded) at 0, so the picked peak is 1, not the week's 2 from Tuesday.
  const picked = pickRows(week, new Set(['Mon', 'Wed'].map((_, i) => week.rows[i === 0 ? 0 : 2]!.key)));
  assert.deepEqual(picked.rows.map((r) => r.name), ['Mon 14', 'Wed 16']);
  assert.equal(picked.peak, 1);
  // A pick with nothing left on is the caller's guard failing; the
  // function answers the week unfiltered rather than an empty one.
  assert.deepEqual(pickRows(week, new Set()), week);
  assert.deepEqual(pickRows(week, new Set(['not-a-day'])), week);
});

test('pickHead names the pick against the total, empty at none or all picked', () => {
  assert.equal(pickHead(7, 0), '');
  assert.equal(pickHead(7, 7), '');
  assert.equal(pickHead(7, 2), '2 of 7 days');
  assert.equal(pickHead(7, 1), '1 of 7 days');
});

test("weekStatsHead cuts the busiest-hour clause off weekStatsText's own text", () => {
  assert.equal(weekStatsHead('2.5 agent-hours in 2.0 · 1.3× parallel · peak 2 Tue 15 14:00 · busiest hour 14:00 across the week'), '2.5 agent-hours in 2.0 · 1.3× parallel · peak 2 Tue 15 14:00');
  // No busiest hour (a peak with none to report) leaves the text whole,
  // as does the empty-week text.
  assert.equal(weekStatsHead('2.5 agent-hours in 2.0 · 1.3× parallel · peak 2 Tue 15 14:00'), '2.5 agent-hours in 2.0 · 1.3× parallel · peak 2 Tue 15 14:00');
  assert.equal(weekStatsHead('nothing yet'), 'nothing yet');
});
