import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_SCHEDULE, STRIP_BAR_PX, USAGE_FLOOR_MS, breakFor, breakText, dialPercent, dialStyle, errorText, fitForm, holdText, labelFor, nextSchedule, overlayLimits, paceBar, parseRetryAfter, parseUsageReply, refreshTitle, resetText, resetWhen, runway, runwayText, segmentLabel, segmentRest, segmentText, shortLabelFor, shouldPoll, staleText, stripNeeds, stripRunway, stripText, windowElapsed, windowLengthMs, windowName } from './usage-model.ts';
import type { StripWindowNeed } from './usage-model.ts';

const NOW = Date.parse('2026-09-11T12:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('parseUsageReply keeps the fixed windows first and the model windows after, by key', () => {
  const windows = parseUsageReply({
    seven_day_opus: { utilization: 8.4, resets_at: at(3 * DAY) },
    seven_day: { utilization: 5, resets_at: at(6 * DAY + 16 * HOUR) },
    five_hour: { utilization: 17, resets_at: at(41 * MIN) },
    seven_day_fable: { utilization: 12, resets_at: at(3 * DAY) },
  });
  assert.deepEqual(
    windows!.map((w) => [w.key, w.label, w.kind, w.percent]),
    [
      ['five_hour', '5 hour', 'time', 17],
      ['seven_day', '7 day', 'time', 5],
      ['seven_day_fable', 'Fable', 'model', 12],
      ['seven_day_opus', 'Opus', 'model', 8],
    ],
  );
  assert.equal(windows![0]!.resetsAt, NOW + 41 * MIN);
});

test('parseUsageReply skips a window without a usable percent or reset, and clamps', () => {
  const windows = parseUsageReply({
    five_hour: { utilization: 'lots', resets_at: at(MIN) },
    seven_day: { utilization: 5 },
    seven_day_opus: { utilization: 130, resets_at: at(MIN) },
    seven_day_sonnet: null,
    seven_day_haiku: { utilization: -2, resets_at: 'never' },
    extra: 'string',
  });
  assert.deepEqual(
    windows!.map((w) => [w.key, w.percent]),
    [['seven_day_opus', 100]],
  );
});

test('parseUsageReply reads a reset given as seconds or milliseconds', () => {
  const windows = parseUsageReply({
    five_hour: { utilization: 1, resets_at: Math.floor((NOW + HOUR) / 1000) },
    seven_day: { utilization: 1, resets_at: NOW + DAY },
  });
  assert.equal(windows![0]!.resetsAt, Math.floor((NOW + HOUR) / 1000) * 1000);
  assert.equal(windows![1]!.resetsAt, NOW + DAY);
});

test('parseUsageReply says null for anything that is not an object', () => {
  assert.equal(parseUsageReply(null), null);
  assert.equal(parseUsageReply('nope'), null);
  assert.equal(parseUsageReply([1, 2]), null);
  assert.deepEqual(parseUsageReply({}), []);
});

// M9 fix 294: the live reply's shape, every per-model key null and a
// `limits` list with the scoped Fable window in it.
const LIVE_LIMITS = (fable: number) => [
  { kind: 'session', percent: 17, resets_at: at(41 * MIN), severity: 'ok', is_active: true },
  { kind: 'weekly_all', percent: 5, resets_at: at(6 * DAY + 16 * HOUR), severity: 'ok', is_active: true },
  { kind: 'weekly_scoped', percent: fable, resets_at: at(6 * DAY + 16 * HOUR), severity: 'ok', is_active: true, scope: { model: { display_name: 'Fable', id: 'claude-fable-5-1' } } },
];

test('parseUsageReply reads a scoped weekly limit off the limits list (M9 fix 294)', () => {
  const windows = parseUsageReply({
    five_hour: { utilization: 17, resets_at: at(41 * MIN) },
    seven_day: { utilization: 5, resets_at: at(6 * DAY + 16 * HOUR) },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_fable: null,
    limits: LIVE_LIMITS(7),
  });
  assert.deepEqual(
    windows!.map((w) => [w.key, w.label, w.kind, w.percent, w.resetsAt]),
    [
      ['five_hour', '5 hour', 'time', 17, NOW + 41 * MIN],
      ['seven_day', '7 day', 'time', 5, NOW + 6 * DAY + 16 * HOUR],
      ['weekly_scoped_fable', 'Fable', 'model', 7, NOW + 6 * DAY + 16 * HOUR],
    ],
  );
  assert.equal(windowLengthMs('weekly_scoped_fable'), 7 * DAY, 'a scoped limit is a week, so the card draws its bar');
  assert.equal(shortLabelFor('weekly_scoped_fable'), 'Fable');
});

test('a top-level key for the same model wins over the scoped limit (M9 fix 294)', () => {
  const windows = parseUsageReply({
    five_hour: { utilization: 17, resets_at: at(41 * MIN) },
    seven_day: { utilization: 5, resets_at: at(6 * DAY + 16 * HOUR) },
    seven_day_fable: { utilization: 8, resets_at: at(6 * DAY + 16 * HOUR) },
    limits: LIVE_LIMITS(7),
  });
  assert.deepEqual(windows!.map((w) => [w.key, w.percent]), [['five_hour', 17], ['seven_day', 5], ['seven_day_fable', 8]]);
});

test('a scoped limit without a name or a percent is skipped, and limits that is not a list is ignored (M9 fix 294)', () => {
  const base = { five_hour: { utilization: 17, resets_at: at(41 * MIN) } };
  const noName = parseUsageReply({ ...base, limits: [{ kind: 'weekly_scoped', percent: 7, resets_at: at(DAY), scope: { model: {} } }] });
  assert.deepEqual(noName!.map((w) => w.key), ['five_hour']);
  const nullPercent = parseUsageReply({ ...base, limits: [{ kind: 'weekly_scoped', percent: null, resets_at: at(DAY), scope: { model: { display_name: 'Fable' } } }] });
  assert.deepEqual(nullPercent!.map((w) => w.key), ['five_hour']);
  const noReset = parseUsageReply({ ...base, limits: [{ kind: 'weekly_scoped', percent: 7, scope: { model: { display_name: 'Fable' } } }] });
  assert.deepEqual(noReset!.map((w) => w.key), ['five_hour']);
  assert.deepEqual(parseUsageReply({ ...base, limits: { kind: 'weekly_scoped' } })!.map((w) => w.key), ['five_hour']);
  assert.deepEqual(parseUsageReply({ ...base, limits: 'none' })!.map((w) => w.key), ['five_hour']);
});

// M9 fix 295: runway, the window's average pace projected to its ceiling.
test('runway projects the window at its average pace, short when the ceiling lands before the reset', () => {
  const win = (key: string, percent: number, left: number) => ({ key, label: key, kind: 'time' as const, percent, resetsAt: NOW + left });
  // The stub's five-hour: 17 with 41m left, 86.3% of the window gone.
  const stub = runway(win('five_hour', 17, 41 * MIN), NOW);
  assert.ok(stub !== null && !stub.short && stub.atReset === 20 && stub.at > NOW + 41 * MIN);
  assert.equal(runwayText(stub!, NOW), 'about 20% at the reset');
  // 40 with four hours left: one hour in, so 100 lands 1h 30m from now.
  const short = runway(win('five_hour', 40, 4 * HOUR), NOW);
  assert.ok(short !== null && short.short && short.atReset === null);
  assert.equal(short!.at, NOW + 90 * MIN);
  assert.equal(runwayText(short!, NOW), '100% in 1h 30m');
  // A weekly reads its duration in days, as its reset does.
  const week = runway(win('seven_day', 50, 5 * DAY), NOW);
  assert.equal(runwayText(week!, NOW), '100% in 2d 0h');
  // M9 fix 308: pinned at 100 the ceiling is now, and the words say so.
  const pinned = runway(win('seven_day', 100, 2 * DAY + HOUR), NOW);
  assert.ok(pinned !== null && pinned.short && pinned.at === NOW);
  assert.equal(runwayText(pinned!, NOW), 'spent until the reset');
  // Five percent in the first tenth, four percent at all, an unknown key: nothing to say.
  assert.equal(runway(win('five_hour', 5, 5 * HOUR - 20 * MIN), NOW), null);
  assert.equal(runway(win('five_hour', 4, HOUR), NOW), null);
  assert.equal(runway(win('some_new_window', 50, HOUR), NOW), null);
  // At the reset itself the pace is the percent as it stands, capped at 100.
  assert.equal(runway(win('five_hour', 60, 0), NOW)!.atReset, 60);
  assert.equal(runway(win('five_hour', 99, 1000), NOW)!.atReset, 99);
});

// M9 fix 361: breakFor, the pause that would put a short window back on
// its average pace by the reset.
test('breakFor says how long a break puts a short window back on pace, and null otherwise', () => {
  const win = (key: string, percent: number, left: number) => ({ key, label: key, kind: 'time' as const, percent, resetsAt: NOW + left });
  // 40 with four hours left: one hour in, so a 2h 30m break lands the
  // average pace back on the reset.
  const short = win('five_hour', 40, 4 * HOUR);
  assert.equal(breakFor(short, NOW), 2.5 * HOUR);
  assert.equal(breakText(breakFor(short, NOW)!), 'back on pace after a 2h 30m break');
  // The stub's five-hour reading is not short: nothing to catch up from.
  const stub = win('five_hour', 17, 41 * MIN);
  assert.equal(runway(stub, NOW)!.short, false);
  assert.equal(breakFor(stub, NOW), null);
});

test('labelFor makes something readable of a key it has not seen', () => {
  assert.equal(labelFor('seven_day_fable'), 'Fable');
  assert.equal(labelFor('seven_day_new_model'), 'New model');
  assert.equal(labelFor('one_day_opus'), 'Opus');
  assert.equal(labelFor('something_else'), 'Something else');
});

test('resetText rounds minutes up and picks the two largest units', () => {
  assert.equal(resetText(NOW + 41 * MIN, NOW), '41m');
  assert.equal(resetText(NOW + 41 * MIN - 10_000, NOW), '41m');
  assert.equal(resetText(NOW + 2 * HOUR + 5 * MIN, NOW), '2h 5m');
  assert.equal(resetText(NOW + 6 * DAY + 16 * HOUR + 30 * MIN, NOW), '6d 16h');
  assert.equal(resetText(NOW + 30_000, NOW), '1m');
  assert.equal(resetText(NOW, NOW), 'now');
  assert.equal(resetText(NOW - HOUR, NOW), 'now');
});

test('segmentText leads with the window, then the reset with its word; the percent only on a window with no bar (M9 fix 308)', () => {
  const [time, week, model, unknown] = parseUsageReply({
    five_hour: { utilization: 17, resets_at: at(41 * MIN) },
    seven_day: { utilization: 5, resets_at: at(6 * DAY + 16 * HOUR) },
    seven_day_fable: { utilization: 8, resets_at: at(6 * DAY + 16 * HOUR) },
    some_new_window: { utilization: 57, resets_at: at(12 * HOUR + 5 * MIN) },
  })!;
  assert.equal(segmentText(time!, NOW), '5h resets 41m');
  assert.equal(segmentText(week!, NOW), '7d resets 6d 16h');
  assert.equal(segmentText(model!, NOW), 'Fable resets 6d 16h');
  assert.equal(segmentText({ ...time!, resetsAt: NOW - MIN }, NOW), '5h resets now');
  // A window of unknown length has no bar, so its text keeps the percent.
  assert.equal(segmentText(unknown!, NOW), 'Some new window 57%, resets 12h 5m');
  // M9 fix 66: the two halves the bar (or the dial) sits between.
  assert.equal(segmentLabel(time!), '5h');
  assert.equal(segmentRest(time!, NOW), 'resets 41m');
  assert.equal(segmentLabel(model!), 'Fable');
  assert.equal(segmentRest(model!, NOW), 'resets 6d 16h');
  assert.equal(segmentRest(unknown!, NOW), '57%, resets 12h 5m');
  assert.equal(`${segmentLabel(week!)} ${segmentRest(week!, NOW)}`, segmentText(week!, NOW), 'segmentText is the join');
});

test('shortLabelFor names a time window by its length and leaves the rest to labelFor', () => {
  assert.equal(shortLabelFor('five_hour'), '5h');
  assert.equal(shortLabelFor('seven_day'), '7d');
  assert.equal(shortLabelFor('seven_day_opus'), 'Opus');
  assert.equal(shortLabelFor('seven_day_new_model'), 'New model');
});

test('the usage card keeps the long form with the clock time (M73, once the tooltip)', () => {
  const [time, model] = parseUsageReply({
    five_hour: { utilization: 17, resets_at: at(41 * MIN) },
    seven_day_fable: { utilization: 8, resets_at: at(6 * DAY + 16 * HOUR) },
  })!;
  assert.equal(windowName(time!), '5 hour window');
  assert.equal(windowName(model!), 'Fable 7 day window');
  // M9 fix 308: the clock time first, the countdown second.
  assert.match(resetWhen(time!, NOW), /^resets \w+ \d+:\d\d [AP]M, in 41m$/);
  assert.match(resetWhen(model!, NOW), /^resets \w+ \d+:\d\d [AP]M, in 6d 16h$/);
  // M9 fix 68: once the reset has passed the card says so, not "in now".
  assert.match(resetWhen({ ...time!, resetsAt: NOW - MIN }, NOW), /^resets \w+ \d+:\d\d [AP]M, now$/);
  // The bar: how far through its window the reset is.
  assert.equal(windowLengthMs('five_hour'), 5 * HOUR);
  assert.equal(windowLengthMs('seven_day_fable'), 7 * DAY);
  assert.equal(windowLengthMs('some_new_window'), null);
  assert.ok(Math.abs(windowElapsed(time!, NOW)! - (1 - 41 / 300)) < 1e-9, 'forty-one minutes left of five hours');
  assert.equal(windowElapsed({ ...time!, resetsAt: NOW - MIN }, NOW), 1, 'a passed reset is a full bar');
  assert.equal(windowElapsed({ ...time!, resetsAt: NOW + 6 * HOUR }, NOW), 0, 'a reset further off than the window is an empty bar');
  assert.equal(windowElapsed({ ...time!, key: 'some_new_window' }, NOW), null);
});

test('dialPercent floors a sliver at three and clamps the ends', () => {
  assert.equal(dialPercent(0), 0);
  assert.equal(dialPercent(1), 3);
  assert.equal(dialPercent(2.5), 3);
  assert.equal(dialPercent(3), 3);
  assert.equal(dialPercent(42), 42);
  assert.equal(dialPercent(120), 100);
  assert.equal(dialPercent(-5), 0);
});

test('dialStyle carries the compaction point as --compact only when given', () => {
  assert.deepEqual(dialStyle(12), { '--pct': '12%' });
  assert.deepEqual(dialStyle(12, 96.7), { '--pct': '12%', '--compact': '96.7%' });
  assert.deepEqual(dialStyle(1, 83.5), { '--pct': '3%', '--compact': '83.5%' });
  assert.deepEqual(dialStyle(50, 120), { '--pct': '50%', '--compact': '100.0%' });
});

// M9 fix 99: the reason behind "unavailable", and what to do about it.
test('parseRetryAfter reads seconds or an HTTP date, and nothing else', () => {
  assert.equal(parseRetryAfter('120', NOW), 120_000);
  assert.equal(parseRetryAfter(' 5 ', NOW), 5_000);
  assert.equal(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW), 90_000);
  assert.equal(parseRetryAfter('soon', NOW), null);
  assert.equal(parseRetryAfter(null, NOW), null);
});

// M9 fix 163: a zero or a past date is no hint, so the back-off decides
// rather than the floor sending the next request into the same limit.
test('parseRetryAfter reads 0 and a past date as no hint, and the schedule backs off from it', () => {
  assert.equal(parseRetryAfter('0', NOW), null);
  assert.equal(parseRetryAfter(new Date(NOW - 90_000).toUTCString(), NOW), null);
  const limited = { error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: parseRetryAfter('0', NOW) } } as const;
  const first = nextSchedule(NO_SCHEDULE, limited, NOW);
  assert.deepEqual(first, { allowedAt: NOW + 5 * MIN, holdMs: 5 * MIN });
  assert.deepEqual(nextSchedule(first, limited, NOW + 5 * MIN), { allowedAt: NOW + 15 * MIN, holdMs: 10 * MIN });
});

// M9 fix 163: the card's stale line while a reading is kept.
test('staleText names what the ask met and when the next goes', () => {
  const at = new Date(NOW).toLocaleTimeString();
  assert.equal(staleText({ error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: null } }, NOW, NOW + 5 * MIN, NOW), `Stale: the ask at ${at} was rate limited; asks again in 5m 0s.`);
  assert.equal(staleText({ error: 'unavailable', reason: { kind: 'offline' } }, NOW, NOW, NOW), `Stale: the ask at ${at} found no connection; asks again on the next refresh.`);
  assert.equal(staleText({ error: 'unavailable', reason: { kind: 'server', status: 503 } }, NOW, 0, NOW), `Stale: the ask at ${at} was answered 503; asks again on the next refresh.`);
  assert.equal(staleText({ error: 'unavailable', reason: { kind: 'bad-reply' } }, NOW, NOW + 30_000, NOW), `Stale: the ask at ${at} got an unreadable reply; asks again in 30s.`);
});

test('errorText names the reason, and a rate limit its wait', () => {
  assert.equal(errorText({ error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: 120_000 } }, NOW + 120_000, NOW), 'Usage rate limited, retry in 2m');
  assert.equal(errorText({ error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: null } }, 0, NOW), 'Usage rate limited');
  assert.equal(errorText({ error: 'unavailable', reason: { kind: 'offline' } }, 0, NOW), 'Usage: no connection');
  assert.equal(errorText({ error: 'unavailable', reason: { kind: 'server', status: 503 } }, 0, NOW), 'Usage endpoint answered 503');
  assert.equal(errorText({ error: 'unavailable', reason: { kind: 'bad-reply' } }, 0, NOW), 'Usage reply unreadable');
  assert.equal(errorText({ error: 'signed-out' }, 0, NOW), 'Sign in to Claude Code for usage');
  assert.equal(errorText({ error: 'unauthorized' }, 0, NOW), 'Sign in to Claude Code for usage');
});

test('refreshTitle carries the action, and the hold left while held', () => {
  assert.equal(refreshTitle(null, 0, NOW), 'Refresh usage.');
  assert.equal(refreshTitle({ windows: [] }, NOW + 20_000, NOW), 'Refresh usage. Retry in 20s.');
  assert.match(refreshTitle({ error: 'unauthorized' }, 0, NOW), /Run claude once in any terminal/);
  assert.match(refreshTitle({ error: 'signed-out' }, 0, NOW), /Run claude once in any terminal/);
  assert.match(refreshTitle({ error: 'unavailable', reason: { kind: 'offline' } }, 0, NOW), /Check the network/);
  assert.match(refreshTitle({ error: 'unavailable', reason: { kind: 'server', status: 503 } }, 0, NOW), /answered 503; that is on its side/);
  assert.match(refreshTitle({ error: 'unavailable', reason: { kind: 'bad-reply' } }, 0, NOW), /could not be read/);
  const limited = refreshTitle({ error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: 119_000 } }, NOW + 119_000, NOW);
  assert.match(limited, /rate limiting this account/);
  assert.match(limited, /Retry in 1m 59s\.$/);
});

test('holdText counts to the second and never says 0s', () => {
  assert.equal(holdText(20_000), '20s');
  assert.equal(holdText(119_000), '1m 59s');
  assert.equal(holdText(60_000), '1m 0s');
  assert.equal(holdText(10), '1s');
});

// M9 fix 100: the schedule between requests.
test('nextSchedule keeps a floor after any answer, and a 429 raises it to the retry-after', () => {
  const ok = nextSchedule(NO_SCHEDULE, { windows: [] }, NOW);
  assert.deepEqual(ok, { allowedAt: NOW + USAGE_FLOOR_MS, holdMs: 0 });
  assert.deepEqual(nextSchedule(NO_SCHEDULE, { error: 'signed-out' }, NOW, 5_000), { allowedAt: NOW + 5_000, holdMs: 0 });
  assert.deepEqual(nextSchedule(NO_SCHEDULE, { error: 'unavailable', reason: { kind: 'offline' } }, NOW, 0), { allowedAt: NOW, holdMs: 0 });
  const limited = nextSchedule(ok, { error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: 120_000 } }, NOW);
  assert.deepEqual(limited, { allowedAt: NOW + 120_000, holdMs: 120_000 });
  // A retry-after under the floor still waits the floor.
  assert.equal(nextSchedule(ok, { error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: 2_000 } }, NOW).allowedAt, NOW + USAGE_FLOOR_MS);
});

test('nextSchedule without a retry-after holds five minutes, doubles on a repeat, caps at an hour, and resets on a 200', () => {
  const limited = { error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: null } } as const;
  const first = nextSchedule(NO_SCHEDULE, limited, NOW);
  assert.deepEqual(first, { allowedAt: NOW + 5 * MIN, holdMs: 5 * MIN });
  const second = nextSchedule(first, limited, NOW + 5 * MIN);
  assert.deepEqual(second, { allowedAt: NOW + 15 * MIN, holdMs: 10 * MIN });
  let s = second;
  for (let i = 0; i < 6; i += 1) s = nextSchedule(s, limited, NOW);
  assert.equal(s.holdMs, HOUR);
  assert.deepEqual(nextSchedule(s, { windows: [] }, NOW), { allowedAt: NOW + USAGE_FLOOR_MS, holdMs: 0 });
  // A retry-after in between is taken as it stands and does not double.
  assert.equal(nextSchedule(s, { error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: 90_000 } }, NOW).holdMs, 90_000);
});

test('shouldPoll: the timer skips a hidden window, the focus asks only on an old reading', () => {
  assert.equal(shouldPoll('timer', false, NOW, NOW, 5 * MIN), true);
  assert.equal(shouldPoll('timer', true, null, NOW, 5 * MIN), false);
  assert.equal(shouldPoll('focus', false, null, NOW, 5 * MIN), true);
  assert.equal(shouldPoll('focus', false, NOW - MIN, NOW, 5 * MIN), false);
  assert.equal(shouldPoll('focus', false, NOW - 5 * MIN, NOW, 5 * MIN), true);
  assert.equal(shouldPoll('focus', true, NOW - 6 * MIN, NOW, 5 * MIN), true);
});

// M9 fix 308: the pace bar, everything the markup needs off one reading
// and now (docs/design/pace-bars.md section 8).
test('paceBar fills with the percent, marks the elapsed share and tones by the runway', () => {
  const win = (key: string, percent: number, left: number) => ({ key, label: key, kind: 'time' as const, percent, resetsAt: NOW + left });
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // The board's three readings: 5h 40% used 80% elapsed (behind, amber),
  // 7d 63% used 46% elapsed (ahead, 100 before the reset, red), Opus 7d
  // 95% used 88% elapsed (red on the percent alone).
  const five = paceBar(win('five_hour', 40, HOUR), NOW, 44)!;
  assert.ok(near(five.fill, 0.4) && near(five.mark, 0.8) && five.tone === 'working' && five.runway !== null && !five.runway.short && five.runway.atReset === 50);
  // M9 fix 347: no ceiling while the pace lands at or past the reset.
  assert.equal(five.ceiling, null);
  assert.ok(near(five.tick!, 0.2) && five.ticks === 4, `hours on the five hour bar at 44px, got ${five.tick} ${five.ticks}`);
  const week = paceBar(win('seven_day', 63, 3 * DAY + 19 * HOUR), NOW, 44)!;
  assert.ok(near(week.fill, 0.63) && Math.abs(week.mark - 0.46) < 0.005 && week.tone === 'error' && week.runway !== null && week.runway.short);
  // M9 fix 347: the ceiling is where the pace hits 100 on the span, the
  // elapsed share over the fill: 0.458 / 0.63 of the week.
  assert.ok(Math.abs(week.ceiling! - 0.458 / 0.63) < 0.005);
  // Forty percent with four hours of five left is an hour in, so 100
  // lands at two and a half hours, the span's middle.
  assert.ok(Math.abs(paceBar(win('five_hour', 40, 4 * HOUR), NOW, 44)!.ceiling! - 0.5) < 1e-9);
  assert.ok(near(week.tick!, 2 / 7) && week.ticks === 3, `every other day at 44px, got ${week.tick} ${week.ticks}`);
  const opus = paceBar(win('seven_day_opus', 95, 20 * HOUR + 10 * MIN), NOW, 44)!;
  assert.ok(near(opus.fill, 0.95) && Math.abs(opus.mark - 0.88) < 0.001 && opus.tone === 'error');
  // The same at the card's width: the five hour keeps its hours (a unit
  // is never refined), the week gets every day.
  assert.ok(near(paceBar(win('five_hour', 40, HOUR), NOW, 258)!.tick!, 0.2) && paceBar(win('five_hour', 40, HOUR), NOW, 258)!.ticks === 4);
  const cardWeek = paceBar(win('seven_day', 63, 3 * DAY + 19 * HOUR), NOW, 258)!;
  assert.ok(near(cardWeek.tick!, 1 / 7) && cardWeek.ticks === 6);
  assert.ok(near(paceBar(win('seven_day_opus', 95, 20 * HOUR), NOW, 258)!.tick!, 1 / 7));
  // Pinned at 100: full and red, the mark where now is, the words spent.
  const pinned = paceBar(win('seven_day', 100, 2 * DAY + HOUR), NOW, 258)!;
  assert.ok(pinned.fill === 1 && pinned.tone === 'error' && Math.abs(pinned.mark - 0.71) < 0.005 && pinned.runway !== null);
  // Pinned at 100 the ceiling is now, the mark's own place.
  assert.ok(Math.abs(pinned.ceiling! - pinned.mark) < 1e-9);
  assert.equal(runwayText(pinned.runway!, NOW), 'spent until the reset');
  // 3% in the first tenth: the mark is there, the runway is not, amber.
  const early = paceBar(win('seven_day', 3, 7 * DAY - 10 * HOUR), NOW, 44)!;
  assert.ok(near(early.fill, 0.03) && Math.abs(early.mark - 10 / 168) < 1e-9 && early.runway === null && early.tone === 'working' && early.ceiling === null);
  // An unknown key has no bar.
  assert.equal(paceBar(win('some_new_window', 57, 12 * HOUR), NOW, 44), null);
  // A reset already past: the mark clamps to 1 and the text says now.
  const past = paceBar(win('five_hour', 25, -MIN), NOW, 44)!;
  assert.ok(past.mark === 1 && near(past.fill, 0.25));
  assert.equal(resetText(NOW - MIN, NOW), 'now');
});

test('paceBar coarsens the tick unit until the ticks are eight pixels apart, and drops them at the whole span', () => {
  const win = (key: string) => ({ key, label: key, kind: 'time' as const, percent: 50, resetsAt: NOW + DAY });
  const at = (key: string, px: number) => paceBar(win(key), NOW, px)!;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // The week: every other day under 56px, every day from there.
  assert.ok(near(at('seven_day', 28).tick!, 2 / 7) && at('seven_day', 28).ticks === 3);
  assert.ok(near(at('seven_day', 32).tick!, 2 / 7));
  assert.ok(near(at('seven_day', 44).tick!, 2 / 7));
  assert.ok(near(at('seven_day', 56).tick!, 1 / 7) && at('seven_day', 56).ticks === 6);
  assert.ok(near(at('seven_day', 258).tick!, 1 / 7));
  // The five hours: every other hour under 40px, every hour from there.
  assert.ok(near(at('five_hour', 28).tick!, 0.4) && at('five_hour', 28).ticks === 2);
  assert.ok(near(at('five_hour', 32).tick!, 0.4));
  assert.ok(near(at('five_hour', 44).tick!, 0.2) && at('five_hour', 44).ticks === 4);
  assert.ok(near(at('five_hour', 56).tick!, 0.2));
  assert.ok(near(at('five_hour', 258).tick!, 0.2));
  // A day's unit is six hours; at 10px the five hour bar keeps one tick
  // (a step of 0.8), and at 5px the step doubles past the span, so none.
  assert.ok(near(at('one_day', 258).tick!, 0.25) && at('one_day', 258).ticks === 3);
  assert.ok(near(at('five_hour', 10).tick!, 0.8) && at('five_hour', 10).ticks === 1);
  assert.equal(at('five_hour', 5).tick, null);
  assert.equal(at('five_hour', 5).ticks, 0);
  // M9 fix 440: the column form's bar can grow past the model's 44px
  // need; at 132px a week's natural unit (1/7) is already 8px apart
  // (132/7 is about 18.9), so it need not coarsen the way the 44px
  // reading does (2/7, about 12.6px there), and the wider bar reads a
  // finer, not identical, tick.
  assert.ok(near(at('seven_day', 132).tick!, 1 / 7) && at('seven_day', 132).ticks === 6);
  assert.ok(at('seven_day', 132).tick! < at('seven_day', 44).tick!);
});

// M9 fix 440: the bar's need for the column and row forms alike stays
// the model's constant even though the column form draws the bar wider
// once it is picked; stripNeeds itself takes no new input for that.
test('stripNeeds still reserves the model constant for the bar, not a drawn width', () => {
  const one: StripWindowNeed = { label: 30, bar: STRIP_BAR_PX, rest: 60, join: null, runway: null };
  const need = 30 + 4 + STRIP_BAR_PX + 4 + 60;
  assert.deepEqual(stripNeeds({ windows: [one], dot: 3 }), { '': need, runway: need, column: need, 'column-runway': need });
});

// M9 fix 324: the strip's text takes the bar's tone, and in the error
// tone the runway joins it after a dot.
test('stripText is the reset alone in the working tone, and the reset with the runway in the error tone', () => {
  const win = (key: string, percent: number, left: number) => ({ key, label: key, kind: 'time' as const, percent, resetsAt: NOW + left });
  // 7d 17% used with 5d 18h left is behind the pace: the reset alone,
  // no runway on the strip.
  const behind = win('seven_day', 17, 5 * DAY + 18 * HOUR);
  assert.equal(stripRunway(paceBar(behind, NOW, 44), NOW), null);
  assert.equal(stripText(behind, paceBar(behind, NOW, 44), NOW), 'resets 5d 18h');
  // 7d 23% used with 5d 18h left (18% elapsed) runs out in 4d 4h.
  const short = win('seven_day', 23, 5 * DAY + 18 * HOUR);
  assert.equal(paceBar(short, NOW, 44)!.tone, 'error');
  assert.equal(stripRunway(paceBar(short, NOW, 44), NOW), '100% in 4d 4h');
  assert.equal(stripText(short, paceBar(short, NOW, 44), NOW), 'resets 5d 18h · 100% in 4d 4h');
  // Pinned at 100 with an hour left: spent.
  const pinned = win('five_hour', 100, HOUR);
  assert.equal(stripText(pinned, paceBar(pinned, NOW, 44), NOW), 'resets 1h 0m · spent until the reset');
  // Ninety and over with the pace landing at the reset: the about form,
  // in the error tone by the percent alone.
  const high = win('seven_day', 90, 16 * HOUR + 47 * MIN);
  assert.equal(stripText(high, paceBar(high, NOW, 44), NOW), 'resets 16h 47m · about 100% at the reset');
  // 100 percent in the window's first tenth has a red bar and no pace,
  // so the text is the reset alone.
  const early = win('seven_day', 100, 6 * DAY + 23 * HOUR + 20 * MIN);
  assert.equal(paceBar(early, NOW, 44)!.tone, 'error');
  assert.equal(stripText(early, paceBar(early, NOW, 44), NOW), 'resets 6d 23h');
  // No bar (an unknown window length): the full text as segmentRest has it.
  const unknown = win('codex', 95, 12 * HOUR + 5 * MIN);
  assert.equal(paceBar(unknown, NOW, 44), null);
  assert.equal(stripText(unknown, null, NOW), '95%, resets 12h 5m');
});

// M9 fix 347: the measured fit. Two plain windows (13px labels, the
// 44px bar, 70px resets, a 3px dot): the row needs 13+4+44+4+70 twice
// with 4+3+2+4 between, 283; the column 13+4+44+4+70, 135; the forms
// with the runway stacked need the same, so the fit lands on the row or
// the column. With runways (a 10px join, 114px runway on each) the four
// needs are distinct and each pixel under one lands on the next form.
test('stripNeeds and fitForm: the row, the row with runways under, the column, and the column with runways under', () => {
  const plain = { windows: [{ label: 13, bar: 44, rest: 70, join: null, runway: null }, { label: 13, bar: 44, rest: 70, join: null, runway: null }], dot: 3 };
  assert.deepEqual(stripNeeds(plain), { '': 283, runway: 283, column: 135, 'column-runway': 135 });
  assert.equal(fitForm(plain, 284), '');
  assert.equal(fitForm(plain, 283), '');
  assert.equal(fitForm(plain, 282), 'column');
  assert.equal(fitForm(plain, 135), 'column');
  assert.equal(fitForm(plain, 100), 'column-runway');
  const long = { windows: [{ label: 13, bar: 44, rest: 70, join: 10, runway: 114 }, { label: 13, bar: 44, rest: 70, join: 10, runway: 114 }], dot: 3 };
  assert.deepEqual(stripNeeds(long), { '': 531, runway: 371, column: 259, 'column-runway': 179 });
  assert.equal(fitForm(long, 531), '');
  assert.equal(fitForm(long, 530), 'runway');
  assert.equal(fitForm(long, 371), 'runway');
  assert.equal(fitForm(long, 370), 'column');
  assert.equal(fitForm(long, 259), 'column');
  assert.equal(fitForm(long, 258), 'column-runway');
  assert.equal(fitForm(long, 100), 'column-runway');
  // One long window beside a plain one: the stacked forms read the
  // wider of the reset and the runway per window, the plain window's
  // reset alone. A dial (10px) in place of a bar counts its own width;
  // the column's bar track is the widest.
  const mixed = { windows: [{ label: 13, bar: 44, rest: 70, join: 10, runway: 114 }, { label: 30, bar: 10, rest: 90, join: null, runway: null }], dot: 3 };
  assert.deepEqual(stripNeeds(mixed), { '': 13 + 4 + 44 + 4 + 194 + 13 + 30 + 4 + 10 + 4 + 90, runway: 13 + 4 + 44 + 4 + 114 + 13 + 30 + 4 + 10 + 4 + 90, column: 30 + 4 + 44 + 4 + 194, 'column-runway': 30 + 4 + 44 + 4 + 114 });
  // No windows: nothing needed, the row.
  assert.deepEqual(stripNeeds({ windows: [], dot: 3 }), { '': 0, runway: 0, column: 0, 'column-runway': 0 });
  assert.equal(fitForm({ windows: [], dot: 3 }, 0), '');
});

test('overlayLimits lays a newer mod reading over the matching windows only (M9 fix 739)', () => {
  const windows = [
    { key: 'five_hour', label: '5 hour', kind: 'time' as const, percent: 20, resetsAt: NOW + HOUR },
    { key: 'seven_day', label: '7 day', kind: 'time' as const, percent: 60, resetsAt: NOW + DAY },
  ];
  const later = { at: NOW + 1000, limits: [{ kind: 'five_hour', percentUsed: 37.5, resetsAt: at(2 * HOUR) }, { kind: 'spend_limit', percentUsed: 90, resetsAt: null }] };
  const laid = overlayLimits(windows, later, NOW)!;
  assert.equal(laid.length, 2, 'no window added for an unknown kind');
  assert.equal(laid[0]!.percent, 38, '37.5 rounds to 38');
  assert.equal(laid[0]!.resetsAt, NOW + 2 * HOUR);
  assert.equal(laid[1], windows[1], 'the other window is the same object');
  assert.equal(overlayLimits(windows, { ...later, at: NOW - 1 }, NOW), windows, 'an older reading is ignored');
  assert.equal(overlayLimits(windows, { at: NOW + 1, limits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: null }] }, NOW), windows, 'nothing moved: the same array');
  assert.equal(overlayLimits(windows, null, NOW), windows);
  assert.equal(overlayLimits(null, later, NOW), null);
});
