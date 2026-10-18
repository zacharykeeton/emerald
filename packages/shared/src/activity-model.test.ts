import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from './activity.ts';
import type { ActivityStats } from './activity-model.ts';
import { activityTotals, monthBounds, monthKey } from './activity-model.ts';
import { activityStats, cappedStats, cappedStatsTitle, cappedWallMs, clockTime, commitsStats, compareKeys, commitsStatsTitle, dayBounds, dayKey, debtStats, debtStatsTitle, drawnSessions, fiveHourKey, formatSpanLength, historyFromText, liveSpans, mergeStats, packTracks, sessionDebt, statsText, stepWindow, tokensStats, tokensStatsTitle, unitBounds, unitKey, unitLabel, unitWord, weekDays, windowName } from './activity-model.ts';
import type { ActivityCommit, ActivityRequest } from './activity.ts';

const MIN = 60_000;

function session(id: string, spans: Array<[number, number]>, lifetime = false): ActivitySession {
  return { sessionId: id, name: id, color: null, kind: lifetime ? 'shell' : 'claude', lifetime, spans: spans.map(([from, to]) => ({ from: from * MIN, to: to * MIN, prompt: null })) };
}

test('activityStats sums the spans, unions them for the wall time and counts the peak', () => {
  // a: 0 to 10, b: 5 to 15 (overlapping by half), c: 20 to 22 (apart).
  const stats = activityStats([session('a', [[0, 10]]), session('b', [[5, 15]]), session('c', [[20, 22]])], 0, 60 * MIN);
  assert.equal(stats.agentMs, 22 * MIN);
  assert.equal(stats.wallMs, 17 * MIN);
  assert.equal(stats.peak, 2);
  assert.equal(stats.parallel.toFixed(2), (22 / 17).toFixed(2));
});

test('nested and touching spans: the inner one adds agent time and not wall time, and touching is not overlapping', () => {
  const nested = activityStats([session('a', [[0, 10]]), session('b', [[2, 4]])], 0, 60 * MIN);
  assert.equal(nested.agentMs, 12 * MIN);
  assert.equal(nested.wallMs, 10 * MIN);
  assert.equal(nested.peak, 2);
  const touching = activityStats([session('a', [[0, 10]]), session('b', [[10, 20]])], 0, 60 * MIN);
  assert.equal(touching.wallMs, 20 * MIN);
  assert.equal(touching.peak, 1);
  assert.equal(touching.parallel, 1);
});

test('a lifetime span is not counted, and the window clips what is summed', () => {
  const stats = activityStats([session('sh', [[0, 50]], true), session('a', [[0, 10]])], 5 * MIN, 60 * MIN);
  assert.equal(stats.agentMs, 5 * MIN);
  assert.equal(stats.wallMs, 5 * MIN);
  assert.equal(stats.peak, 1);
  assert.deepEqual(activityStats([], 0, 1), { agentMs: 0, wallMs: 0, parallel: 0, peak: 0, running: null, up: 0, fresh: 0, cacheWrite: 0, cached: 0, down: 0, usd: 0, estimated: false, requests: 0, commits: 0, merges: 0, committers: [], debtMs: 0, askedMs: 0, unreadMs: 0, waits: 0, debtWallMs: 0, debtPeak: 0, awayMs: 0, cappedMs: 0 });
});

// M9 fix 218: the commits the rows' records credit inside the window,
// merges apart, the rows with the most named for the tooltip.
test('activityStats counts the commits and merges landed in the window and names the committers; statsText prints the tally after the peak', () => {
  const c = (at: number, merge = false): ActivityCommit => ({ hash: `h${at}`, at: at * MIN, merge });
  const a: ActivitySession = { ...session('a', [[0, 10]]), commits: [c(1), c(2), c(8, true), c(70)] };
  const b: ActivitySession = { ...session('b', [[5, 15]]), commits: [c(6)] };
  const agent: ActivitySession = { ...session('b', [[6, 9]]), kind: 'agent', parentId: 'b', agentId: 'ag1', agentType: 'fork', name: 'the fork', commits: [c(7), c(8)] };
  const sh: ActivitySession = { ...session('sh', [[0, 50]], true), commits: [c(3, true)] };
  const stats = activityStats([a, b, agent, sh], 0, 60 * MIN);
  assert.equal(stats.commits, 7, 'the commit past the window is not counted; a shell that committed by hand is');
  assert.equal(stats.merges, 2);
  assert.deepEqual(stats.committers, [{ name: 'a', commits: 3 }, { name: 'the fork', commits: 2 }, { name: 'b', commits: 1 }, { name: 'sh', commits: 1 }]);
  assert.equal(commitsStats(stats), '7 commits, 2 merges');
  assert.equal(commitsStatsTitle(stats), '7 commits, 2 merges landed by the sessions on the graph: a 3, the fork 2, b 1 and 1 more');
  assert.equal(statsText({ ...stats, running: null }), '23m agent time in 15m · 1.5× parallel · peak 3 · 7 commits, 2 merges');
  const one = activityStats([{ ...session('a', [[0, 10]]), commits: [c(1)] }], 0, 60 * MIN);
  assert.equal(commitsStats(one), '1 commit');
  assert.equal(commitsStats(activityStats([session('a', [[0, 10]])], 0, 60 * MIN)), null);
});

// M9 fix 217: the window's tokens and cost over the request points that
// opened inside it; a point without Claude Code's figure is priced from
// the rates by its model and marks the sum an estimate.
test('activityStats sums the request points inside the window, prices the costless ones and marks the estimate; statsText prints the part', () => {
  const point = (at: number, fresh: number, cacheWrite: number, cacheRead: number, output: number, usd: number | null, model = 'Opus 5'): ActivityRequest => ({ at: at * MIN, fresh, cacheWrite, cacheRead, output, usd, model });
  const a: ActivitySession = { ...session('a', [[0, 10]]), requests: [point(1, 4000, 8000, 12000, 700, 0.25), point(8, 1000, 2000, 30000, 250, 0.2)] };
  const b: ActivitySession = { ...session('b', [[5, 15]]), requests: [point(6, 1000, 3000, 40000, 300, 0.2), point(70, 5, 5, 5, 5, 9)] };
  const sh: ActivitySession = { ...session('sh', [[0, 50]], true), requests: [point(2, 1, 1, 1, 1, 1)] };
  const stats = activityStats([a, b, sh], 0, 60 * MIN);
  assert.equal(stats.requests, 3, 'the point outside the window and the lifetime row\'s are not summed');
  assert.deepEqual([stats.up, stats.fresh, stats.cacheWrite, stats.cached, stats.down], [101000, 6000, 13000, 82000, 1250]);
  assert.equal(stats.usd.toFixed(2), '0.65');
  assert.equal(stats.estimated, false);
  assert.deepEqual(tokensStats(stats), { up: '101k', down: '1.3k', usd: '$0.65' });
  assert.equal(statsText({ ...stats, running: 2 }), '20m agent time in 15m · 1.3× parallel · peak 2 · ↑101k ↓1.3k · $0.65 · 2 running now');
  assert.equal(tokensStatsTitle(stats), '↑101k sent: 6k fresh · 13k cache write · 82k cache read (81% cached)\n↓1.3k received\n$0.65, Claude Code\'s own figure summed over 3 requests');
  // A costless Opus 5 point: 100 fresh at $5/M, 200 cache write at
  // $6.25/M, 50k cache read at $0.5/M and 1k out at $25/M is $0.05175.
  const c: ActivitySession = { ...session('c', [[20, 22]]), requests: [point(21, 100, 200, 50000, 1000, null)] };
  const est = activityStats([a, b, c], 0, 60 * MIN);
  assert.equal(est.estimated, true);
  assert.equal(est.usd.toFixed(5), '0.70175');
  assert.equal(tokensStats(est)?.usd, '~$0.70');
  assert.ok(tokensStatsTitle(est)?.endsWith('~$0.70 over 4 requests, priced from the rates where Claude Code gave no figure'));
  // A model the table does not know prices at nothing and still marks the sum.
  const d: ActivitySession = { ...session('d', [[20, 22]]), requests: [point(21, 100, 200, 50000, 1000, null, 'Mystery 9')] };
  const unknown = activityStats([a, d], 0, 60 * MIN);
  assert.equal(unknown.usd.toFixed(2), '0.45');
  assert.equal(unknown.estimated, true);
  // No points: no tokens part on the line, as before.
  assert.equal(tokensStats(activityStats([session('a', [[0, 10]])], 0, 60 * MIN)), null);
});

// M9 fix 207: the count running at this instant is the drawn rows in the
// working set, null without one (a past window, the CLI), and the line
// carries it as ` · N running now`, `0` included once they stop.
test('activityStats counts the rows the working set names, and statsText prints it', () => {
  const a = session('a', [[0, 10]]);
  const b = session('b', [[5, 15]]);
  const agent: ActivitySession = { ...session('a', [[6, 9]]), kind: 'agent', parentId: 'a', agentId: 'ag1', agentType: 'fork' };
  const sh = session('sh', [[0, 50]], true);
  const list = [a, b, agent, sh];
  assert.equal(activityStats(list, 0, 60 * MIN, new Set(['a', 'b', 'a/ag1'])).running, 3);
  assert.equal(activityStats(list, 0, 60 * MIN, new Set(['b'])).running, 1);
  // The shell's lifetime row is not a drawn row, and an unknown id counts for nothing.
  assert.equal(activityStats(list, 0, 60 * MIN, new Set(['sh', 'zz'])).running, 0);
  assert.equal(activityStats(list, 0, 60 * MIN).running, null);
  const base = { agentMs: 372 * MIN, wallMs: 220 * MIN, parallel: 372 / 220, peak: 4 };
  assert.equal(statsText({ ...base, running: 3 }), '6h 12m agent time in 3h 40m · 1.7× parallel · peak 4 · 3 running now');
  assert.equal(statsText({ ...base, running: 0 }), '6h 12m agent time in 3h 40m · 1.7× parallel · peak 4 · 0 running now');
  assert.equal(statsText({ ...base, running: null }), '6h 12m agent time in 3h 40m · 1.7× parallel · peak 4');
  assert.equal(statsText({ agentMs: 0, wallMs: 0, parallel: 0, peak: 0, running: 2 }), 'nothing yet');
});

// M9 fix 297: with days picked, the week's line prices the pick alone,
// one activityStats call per picked day merged rather than one call
// over the whole week.
test('mergeStats sums the picked parts, maxes their peaks and debt fields sum, parallel is recomputed and running is the last part\'s', () => {
  const day = (over: Partial<ActivityStats>): ActivityStats => ({
    agentMs: 0, wallMs: 0, parallel: 0, peak: 0, running: null,
    up: 0, fresh: 0, cacheWrite: 0, cached: 0, down: 0, usd: 0, estimated: false, requests: 0,
    commits: 0, merges: 0, committers: [],
    debtMs: 0, askedMs: 0, unreadMs: 0, waits: 0, debtWallMs: 0, debtPeak: 0, awayMs: 0, cappedMs: 0,
    ...over,
  });
  const mon = day({ agentMs: 10 * MIN, wallMs: 8 * MIN, peak: 2, up: 100, fresh: 40, cacheWrite: 10, cached: 20, down: 30, usd: 0.5, requests: 2, commits: 3, merges: 1, committers: [{ name: 'a', commits: 2 }, { name: 'b', commits: 1 }], debtMs: 60_000, askedMs: 60_000, waits: 1, debtWallMs: 60_000, debtPeak: 1, running: 2 });
  const tue = day({ agentMs: 4 * MIN, wallMs: 4 * MIN, peak: 1, up: 50, fresh: 10, cacheWrite: 5, cached: 5, down: 30, usd: 0.2, estimated: true, requests: 1, commits: 1, merges: 0, committers: [{ name: 'a', commits: 1 }], debtPeak: 2, awayMs: 5000, cappedMs: 1000, running: 0 });
  const merged = mergeStats([mon, tue]);
  assert.equal(merged.agentMs, 14 * MIN, 'agentMs summed');
  assert.equal(merged.wallMs, 12 * MIN, 'wallMs summed');
  assert.equal(merged.parallel.toFixed(2), (14 / 12).toFixed(2), 'recomputed off the summed agentMs and wallMs');
  assert.equal(merged.peak, 2, 'the largest part\'s peak, not the sum of the two');
  assert.equal(merged.running, 0, 'the last part\'s, not summed');
  assert.deepEqual([merged.up, merged.fresh, merged.cacheWrite, merged.cached, merged.down], [150, 50, 15, 25, 60]);
  assert.equal(merged.usd.toFixed(2), '0.70');
  assert.equal(merged.estimated, true, 'true once any part is');
  assert.equal(merged.requests, 3);
  assert.equal(merged.commits, 4);
  assert.equal(merged.merges, 1);
  assert.deepEqual(merged.committers, [{ name: 'a', commits: 3 }, { name: 'b', commits: 1 }], 'the committers merged by name and re-sorted');
  assert.equal(merged.debtMs, 60_000);
  assert.equal(merged.askedMs, 60_000);
  assert.equal(merged.waits, 1);
  assert.equal(merged.debtWallMs, 60_000);
  assert.equal(merged.debtPeak, 3, 'summed like the other debt fields, not maxed like peak');
  assert.equal(merged.awayMs, 5000);
  assert.equal(merged.cappedMs, 1000);
  assert.equal(mergeStats([mon]).peak, mon.peak, 'one part alone is unchanged');
  assert.equal(mergeStats([]).wallMs, 0);
  assert.equal(mergeStats([]).parallel, 0, 'wallMs 0 does not divide by it');
  assert.equal(mergeStats([]).running, null, 'no last part to read');
});

// M9 fix 228: a working session's last span reaches now, so the band,
// the stats line and the strip read one end.
test('liveSpans extends a working session\'s last span to now and nothing else', () => {
  const a = session('a', [[0, 10], [20, 25]]);
  const idle = session('b', [[0, 12]]);
  const sh = session('sh', [[0, 50]], true);
  const out = liveSpans([a, idle, sh], new Set(['a', 'sh']), 30 * MIN);
  assert.deepEqual(out[0]!.spans.map((s) => [s.from / MIN, s.to / MIN]), [[0, 10], [20, 30]]);
  assert.equal(out[0]!.spans[1]!.prompt, null);
  assert.equal(out[1], idle);
  assert.equal(out[2], sh);
  // A span already at or past now is left as it is, and a session with
  // no spans has nothing to extend.
  assert.equal(liveSpans([a], new Set(['a']), 22 * MIN)[0], a);
  assert.equal(liveSpans([session('e', [])], new Set(['e']), 22 * MIN)[0]!.spans.length, 0);
  // An agent's row is keyed as the strip keys it.
  const agent: ActivitySession = { ...session('p', [[0, 5]]), agentId: 'x', kind: 'agent' };
  assert.equal(liveSpans([agent], new Set(['p/x']), 9 * MIN)[0]!.spans[0]!.to, 9 * MIN);
  assert.equal(liveSpans([agent], new Set(['p']), 9 * MIN)[0], agent);
});

// M9 fix 191: a shell's lifetime row is not drawn, so it takes no track.
test('drawnSessions drops the lifetime rows and packTracks gives them no track', () => {
  const sh = session('sh', [[0, 50]], true);
  assert.deepEqual(drawnSessions([sh, session('a', [[0, 10]])]).map((s) => s.sessionId), ['a']);
  assert.deepEqual(packTracks([sh, session('a', [[0, 10]]), session('b', [[5, 15]])]).map((t) => t.map((s) => s.sessionId)), [['a'], ['b']]);
  assert.deepEqual(packTracks([sh]), []);
});

test('packTracks puts sessions that do not overlap on one track, in start order', () => {
  const tracks = packTracks([session('c', [[20, 25]]), session('a', [[0, 10]]), session('b', [[5, 15]]), session('d', [[12, 18]]), session('empty', [])]);
  assert.deepEqual(
    tracks.map((t) => t.map((s) => s.sessionId)),
    [
      ['a', 'd', 'c'],
      ['b'],
    ],
  );
});

test('statsText and formatSpanLength read as the card shows them', () => {
  assert.equal(formatSpanLength(0), '0s');
  assert.equal(formatSpanLength(12_400), '12s');
  assert.equal(formatSpanLength(40 * MIN), '40m');
  assert.equal(formatSpanLength(372 * MIN), '6h 12m');
  assert.equal(formatSpanLength(120 * MIN), '2h');
  assert.equal(statsText({ agentMs: 372 * MIN, wallMs: 220 * MIN, parallel: 372 / 220, peak: 4, running: null }), '6h 12m agent time in 3h 40m · 1.7× parallel · peak 4');
  assert.equal(statsText({ agentMs: 0, wallMs: 0, parallel: 0, peak: 0, running: null }), 'nothing yet');
});

test('dayKey and dayBounds round-trip a local day and refuse a bad one', () => {
  const noon = new Date(2026, 8, 13, 12, 0, 0).getTime();
  assert.equal(dayKey(noon), '2026-09-13');
  const bounds = dayBounds('2026-09-13');
  assert.ok(bounds);
  assert.equal(bounds.from, new Date(2026, 8, 13).getTime());
  assert.equal(bounds.to, new Date(2026, 8, 14).getTime());
  assert.equal(dayBounds('2026-13-40'), null);
  assert.equal(dayBounds('today'), null);
  assert.equal(clockTime(new Date(2026, 8, 13, 9, 5).getTime()), '09:05');
});

test('a window key names its unit by its form, and its bounds are one whole unit', () => {
  const at = new Date(2026, 8, 13, 14, 7, 30).getTime();
  assert.equal(unitKey('day', at), '2026-09-13');
  assert.equal(unitKey('hour', at), '2026-09-13T14');
  assert.equal(unitKey('minute', at), '2026-09-13T14:07');
  const day = unitBounds('2026-09-13');
  assert.ok(day);
  assert.equal(day.unit, 'day');
  assert.equal(day.to - day.from, 24 * 3_600_000);
  const hour = unitBounds('2026-09-13T14');
  assert.ok(hour);
  assert.equal(hour.unit, 'hour');
  assert.equal(hour.from, new Date(2026, 8, 13, 14).getTime());
  assert.equal(hour.to, hour.from + 3_600_000);
  const minute = unitBounds('2026-09-13T14:07');
  assert.ok(minute);
  assert.equal(minute.unit, 'minute');
  assert.equal(minute.from, new Date(2026, 8, 13, 14, 7).getTime());
  assert.equal(minute.to, minute.from + 60_000);
  assert.equal(unitBounds('2026-09-13T24'), null);
  assert.equal(unitBounds('2026-09-13T14:60'), null);
  assert.equal(unitBounds('2026-09-13T14:07:00'), null);
  assert.equal(unitBounds('2026-13-40T01'), null);
});

test('a window steps by its own unit and names itself for a title', () => {
  const hour = unitBounds('2026-09-13T14');
  const minute = unitBounds('2026-09-13T14:07');
  const day = unitBounds('2026-09-13');
  assert.ok(hour && minute && day);
  assert.equal(stepWindow(hour, 1), '2026-09-13T15');
  assert.equal(stepWindow(hour, -15), '2026-09-12T23');
  assert.equal(stepWindow(minute, -8), '2026-09-13T13:59');
  assert.equal(stepWindow(day, 1), '2026-09-14');
  assert.equal(stepWindow(day, -1), '2026-09-12');
  assert.equal(windowName(day), '2026-09-13');
  assert.equal(windowName(hour), '14:00 to 15:00');
  assert.equal(windowName(minute), '14:07');
});

// M9 fix 607: how far back the history goes, the year only when it is not now's.
test('the history line names its month and day, and the year when it is another year', () => {
  assert.equal(historyFromText(new Date(2026, 8, 21, 9).getTime(), new Date(2026, 9, 1, 12).getTime()), 'history from Sep 21');
  assert.equal(historyFromText(new Date(2026, 9, 1, 0, 5).getTime(), new Date(2026, 9, 1, 12).getTime()), 'history from Oct 1');
  assert.equal(historyFromText(new Date(2025, 11, 30, 23).getTime(), new Date(2026, 0, 2, 12).getTime()), 'history from Dec 30, 2025');
});

// M9 fix 321: the five-hour unit, the account's current usage window.
test('a five-hour window is keyed by its start minute with an f, five hours long, never named from an instant, and does not step', () => {
  // The reading's reset carries seconds; the key drops them.
  const from = new Date(2026, 8, 19, 13, 40, 27).getTime();
  assert.equal(fiveHourKey(from), '2026-09-19T13:40f');
  const win = unitBounds('2026-09-19T13:40f');
  assert.ok(win);
  assert.equal(win.unit, 'five-hour');
  assert.equal(win.from, new Date(2026, 8, 19, 13, 40).getTime());
  assert.equal(win.to, win.from + 5 * 3_600_000);
  assert.equal(windowName(win), '13:40 to 18:40');
  assert.equal(stepWindow(win, 1), win.key);
  assert.equal(stepWindow(win, -1), win.key);
  assert.throws(() => unitKey('five-hour', from), /fiveHourKey/);
  // An f belongs on a minute key alone, and a bad minute is still no window.
  assert.equal(unitBounds('2026-09-19T13f'), null);
  assert.equal(unitBounds('2026-09-19f'), null);
  assert.equal(unitBounds('2026-09-19T13:60f'), null);
  assert.equal(unitBounds('2026-09-19T13:40ff'), null);
  assert.equal(unitLabel('five-hour'), '5h');
  assert.equal(unitLabel('hour'), 'hour');
  assert.equal(unitWord('five-hour'), 'five-hour window');
  assert.equal(unitWord('day'), 'day');
});

// M9 fix 230: the week unit.
test('a week is keyed by its Monday, bounded Monday to Monday, and refuses a key on any other day', () => {
  // 2026-09-13 is a Sunday; its week began on Monday the 7th.
  const sunday = new Date(2026, 8, 13, 14, 7, 30).getTime();
  assert.equal(unitKey('week', sunday), '2026-09-07w');
  assert.equal(unitKey('week', new Date(2026, 8, 14, 0, 0, 1).getTime()), '2026-09-14w');
  const week = unitBounds('2026-09-14w');
  assert.ok(week);
  assert.equal(week.unit, 'week');
  assert.equal(week.from, new Date(2026, 8, 14).getTime());
  assert.equal(week.to, new Date(2026, 8, 21).getTime());
  assert.equal(unitBounds('2026-09-13w'), null);
  assert.equal(unitBounds('2026-09-14ww'), null);
  assert.equal(unitBounds('2026-09-14Tw'), null);
  const days = weekDays(week.from);
  assert.deepEqual(days.map((d) => d.key), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
  assert.equal(days[6]!.to, week.to);
});

test('a week steps by seven days across a clock change and names itself for a title', () => {
  const week = unitBounds('2026-09-14w');
  assert.ok(week);
  assert.equal(stepWindow(week, 1), '2026-09-21w');
  assert.equal(stepWindow(week, -1), '2026-09-07w');
  assert.equal(windowName(week), 'week of Mon 14 Sep');
  // Across the autumn clock change (the last Sunday of October in Europe,
  // the first of November in the US), a step lands on the next Monday's
  // key whatever the local zone does to the week's length.
  const october = unitBounds('2026-10-26w');
  assert.ok(october);
  assert.equal(stepWindow(october, 1), '2026-11-02w');
  assert.equal(stepWindow(october, -1), '2026-10-19w');
  const stepped = unitBounds(stepWindow(october, 1));
  assert.ok(stepped);
  assert.equal(stepped.from, october.to);
});

// M9 fix 518: Node 24 reads a runtime TZ assignment, so the zone is
// switched here and put back in the finally, no child process needed.
test('the hour and minute units step through the autumn clock change and over the spring one', () => {
  const was = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const step = (key: string, delta: number) => {
      const w = unitBounds(key);
      assert.ok(w, key);
      return stepWindow(w, delta);
    };
    // Hours forward and back through the repeated 01:00.
    assert.equal(step('2026-11-01T00', 1), '2026-11-01T01');
    assert.equal(step('2026-11-01T01', 1), '2026-11-01T01b');
    assert.equal(step('2026-11-01T01b', 1), '2026-11-01T02');
    assert.equal(step('2026-11-01T02', -1), '2026-11-01T01b');
    assert.equal(step('2026-11-01T01b', -1), '2026-11-01T01');
    assert.equal(unitBounds('2026-11-01T01b')!.from, Date.UTC(2026, 10, 1, 7));
    assert.equal(unitKey('hour', Date.UTC(2026, 10, 1, 7, 30)), '2026-11-01T01b');
    // Minutes.
    assert.equal(step('2026-11-01T01:59', 1), '2026-11-01T01:00b');
    assert.equal(step('2026-11-01T01:00b', -1), '2026-11-01T01:59');
    assert.equal(step('2026-11-01T01:59b', 1), '2026-11-01T02:00');
    // No repeat the next night.
    assert.equal(unitBounds('2026-11-02T01b'), null);
    // The five-hour key of a start in the repeated hour.
    const five = fiveHourKey(Date.UTC(2026, 10, 1, 7, 40));
    assert.equal(five, '2026-11-01T01:40bf');
    const fiveWindow = unitBounds(five);
    assert.ok(fiveWindow);
    assert.equal(fiveWindow.unit, 'five-hour');
    assert.equal(fiveWindow.from, Date.UTC(2026, 10, 1, 7, 40));
    // The spring gap is stepped over.
    assert.equal(step('2026-03-08T01', 1), '2026-03-08T03');
    // Names and order.
    assert.equal(windowName(unitBounds('2026-11-01T01b')!), '01:00 to 02:00 (repeated)');
    assert.equal(windowName(unitBounds('2026-11-01T01:30b')!), '01:30 (repeated)');
    assert.ok(compareKeys('2026-11-01T01:45', '2026-11-01T01:05b') < 0);
    assert.ok(compareKeys('2026-11-01T02', '2026-11-01T01b') > 0);
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

// M9 fix 231: attention debt. The window's figure is the sum over the
// sessions, the union goes in the tooltip, and the part is absent at
// zero; a live asked stretch grows to now like a working span.
test('activityStats sums the waiting stretches per session, unions them for the tooltip, and statsText prints the part after the peak only when there is any (M9 fix 231)', () => {
  const debt = (id: string, spans: Array<[number, number]>, stretches: Array<[number, number, 'asked' | 'unread']>): ActivitySession => ({ ...session(id, spans), debt: stretches.map(([from, to, kind]) => ({ from: from * MIN, to: to * MIN, kind })) });
  // Three asking over one overlapping hour (the board's 1c): the sum is
  // 60 + 50 + 50 = 160m, the union 14:00 to 15:10 = 70m, three deep
  // between 14:20 and 15:00; b also sat unread for 20m in the morning.
  const a = debt('a', [[0, 600]], [[840, 900, 'asked']]);
  const b = debt('b', [[0, 600]], [[100, 120, 'unread'], [850, 900, 'asked']]);
  const c = debt('c', [[0, 600]], [[860, 910, 'asked']]);
  const stats = activityStats([a, b, c, session('sh', [[0, 900]], true)], 0, 24 * 60 * MIN);
  assert.equal(stats.debtMs, 180 * MIN);
  assert.equal(stats.askedMs, 160 * MIN);
  assert.equal(stats.unreadMs, 20 * MIN);
  assert.equal(stats.waits, 3);
  assert.equal(stats.debtWallMs, 90 * MIN);
  assert.equal(stats.debtPeak, 3);
  assert.equal(debtStats(stats), '3h waiting on you');
  assert.equal(debtStatsTitle(stats), "2h 40m asked over 3 waits, 20m unread past the minute's grace\n1h 30m of the window had someone waiting on you\n10% of 30h agent time");
  assert.equal(statsText({ ...stats, running: null }), '30h agent time in 10h · 3.0× parallel · peak 3 · 3h waiting on you');
  // Clipped to the window like the working spans.
  assert.equal(activityStats([a, b, c], 0, 870 * MIN).debtMs, (30 + 20 + 20 + 10) * MIN);
  // Nothing owed: no part, no tooltip, and a stats literal from before
  // the field the same.
  const none = activityStats([session('a', [[0, 10]])], 0, 60 * MIN);
  assert.equal(none.debtMs, 0);
  assert.equal(debtStats(none), null);
  assert.equal(debtStatsTitle(none), null);
  assert.equal(statsText({ ...none, running: 1 }), '10m agent time in 10m · 1.0× parallel · peak 1 · 1 running now');
  assert.equal(statsText({ agentMs: 372 * MIN, wallMs: 220 * MIN, parallel: 372 / 220, peak: 4, running: null } as ActivityStats), '6h 12m agent time in 3h 40m · 1.7× parallel · peak 4');
  // Per session, for the card and the gutter: a zero is a zero here.
  assert.deepEqual(sessionDebt(b, 0, 24 * 60 * MIN), { debtMs: 70 * MIN, askedMs: 50 * MIN, unreadMs: 20 * MIN, waits: 1 });
  assert.deepEqual(sessionDebt(session('x', [[0, 1]]), 0, MIN), { debtMs: 0, askedMs: 0, unreadMs: 0, waits: 0 });
  // A lifetime row's stretches never count, even if a daemon sent some.
  assert.equal(activityStats([{ ...session('sh', [[0, 900]], true), debt: [{ from: 0, to: MIN, kind: 'asked' }] }], 0, 60 * MIN).debtMs, 0);
});

// M9 fix 285: the capped part is the bands' union cut to the window,
// absent at zero; its tooltip names each band by its window; and the
// docked figure rides the debt tooltip after the away line.
test('cappedStats prints the bands\' union after the waiting part and the tooltip names each window (M9 fix 285)', () => {
  const bands = [
    { from: 600 * MIN, to: 660 * MIN, window: 'five_hour', resetsAt: 700 * MIN },
    // Two windows spent at once, overlapping the first: one stretch.
    { from: 630 * MIN, to: 690 * MIN, window: 'seven_day', resetsAt: 690 * MIN },
    { from: 900 * MIN, to: 930 * MIN, window: 'five_hour', resetsAt: 960 * MIN },
  ];
  assert.equal(cappedWallMs(bands, 0, 24 * 60 * MIN), 120 * MIN);
  assert.equal(cappedStats(bands, 0, 24 * 60 * MIN), '2h capped');
  // Cut to the window.
  assert.equal(cappedStats(bands, 645 * MIN, 915 * MIN), '1h capped');
  assert.equal(cappedStats(bands, 0, 600 * MIN), null);
  assert.equal(cappedStats([], 0, 24 * 60 * MIN), null);
  const name = (w: string) => (w === 'five_hour' ? '5 hour window' : '7 day window');
  assert.equal(cappedStatsTitle(bands, 0, 24 * 60 * MIN, name), `5 hour window spent ${clockTime(600 * MIN)} to ${clockTime(660 * MIN)}, reset ${clockTime(700 * MIN)}\n7 day window spent ${clockTime(630 * MIN)} to ${clockTime(690 * MIN)}, reset ${clockTime(690 * MIN)}\n5 hour window spent ${clockTime(900 * MIN)} to ${clockTime(930 * MIN)}, reset ${clockTime(960 * MIN)}`);
  assert.equal(cappedStatsTitle(bands, 0, 600 * MIN, name), null);
  // The docked figure on the rows sums into the debt tooltip's last line.
  const owed: ActivitySession = { ...session('a', [[0, 600]]), debt: [{ from: 700 * MIN, to: 760 * MIN, kind: 'asked' }], awayMs: 5 * MIN, cappedMs: 30 * MIN };
  const stats = activityStats([owed], 0, 24 * 60 * MIN);
  assert.equal(stats.cappedMs, 30 * MIN);
  assert.ok(debtStatsTitle(stats)!.endsWith('5m away not counted\n30m capped not counted'));
});

test('liveSpans draws an owed session\'s last stretch to now in the state the store lists it in (M9 fix 231)', () => {
  const now = 100 * MIN;
  const a: ActivitySession = { ...session('a', [[0, 60]]), debt: [{ from: 10 * MIN, to: 20 * MIN, kind: 'asked' }, { from: 50 * MIN, to: 80 * MIN, kind: 'asked' }] };
  const b: ActivitySession = { ...session('b', [[0, 60]]), debt: [{ from: 61 * MIN, to: 80 * MIN, kind: 'unread' }] };
  const live = liveSpans([a, b], new Set(['a']), now, new Map([['a', 'asked'], ['b', 'unread']]));
  assert.deepEqual(live[0]?.debt, [{ from: 10 * MIN, to: 20 * MIN, kind: 'asked' }, { from: 50 * MIN, to: now, kind: 'asked' }]);
  assert.equal(live[0]?.spans[0]?.to, now);
  assert.deepEqual(live[1]?.debt, [{ from: 61 * MIN, to: now, kind: 'unread' }]);
  // The kind must match: a session the store lists as done grows no
  // asked stretch, and one it lists in neither grows nothing.
  assert.deepEqual(liveSpans([a], new Set(), now, new Map([['a', 'unread']]))[0]?.debt, a.debt);
  assert.deepEqual(liveSpans([a], new Set(), now)[0], a);
});

test('monthKey and monthBounds name a local month and its bounds, and activityTotals starts its months at the log\'s first line (M9 fix 836)', () => {
  assert.equal(monthKey(new Date(2026, 9, 31, 23, 59).getTime()), '2026-10');
  assert.equal(monthKey(new Date(2026, 0, 1).getTime()), '2026-01');
  assert.deepEqual(monthBounds('2026-10'), { from: new Date(2026, 9, 1).getTime(), to: new Date(2026, 10, 1).getTime() });
  assert.deepEqual(monthBounds('2026-12'), { from: new Date(2026, 11, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
  assert.equal(monthBounds('2026-13'), null);
  assert.equal(monthBounds('2026-1'), null);
  const t = activityTotals([], 'C:/x', 0, new Date(2026, 9, 3).getTime(), new Date(2026, 8, 30).getTime());
  assert.deepEqual(t.months.map((m) => m.month), ['2026-09', '2026-10']);
  assert.equal(t.months[0]!.from, new Date(2026, 8, 1).getTime(), 'a window from 0 runs its first month from the 1st');
  assert.equal(t.total.requests, 0);
  assert.equal(t.firstAt, null);
});
