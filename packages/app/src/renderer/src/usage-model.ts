import type { CSSProperties } from 'react';
import type { UsageResult, UsageWindow } from '../../preload/api.ts';

// The pure part of the usage strip: the reply from the usage endpoint
// turned into windows, and the countdown text for a reset time. The main
// process runs the parse so the renderer only ever sees numbers, and the
// renderer runs the countdown once a minute without a fetch.

// The two windows every account has, in the order the strip shows them;
// any other key is a per-model window and follows, sorted by key.
const FIXED: readonly string[] = ['five_hour', 'seven_day'];

// Labels for the keys seen so far. An unknown key is still shown, with
// a label made from the key, since a new model window is better shown
// under a rough name than hidden.
const LABELS: Record<string, string> = {
  five_hour: '5 hour',
  seven_day: '7 day',
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
  seven_day_haiku: 'Haiku',
  seven_day_fable: 'Fable',
};

// M9 fix 61: the short label that leads a segment's text. A time window
// is named by its length, since "5 hour" and "7 day" are long for a strip
// that also carries a percent and a reset; a model window keeps its name,
// which is short already, and an unknown key its derived one.
const SHORT: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  one_day: '1d',
};

export function shortLabelFor(key: string): string {
  return SHORT[key] ?? labelFor(key);
}

export function labelFor(key: string): string {
  const known = LABELS[key];
  if (known !== undefined) return known;
  // M9 fix 294: a scoped limit's key is its prefix and the model's name.
  const rest = key.replace(/^(seven_day|five_hour|one_day|weekly_scoped)_?/, '').replace(/_/g, ' ').trim();
  const word = rest.length > 0 ? rest : key.replace(/_/g, ' ');
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// null when the reply is not an object at all, so the caller can say
// "unavailable" rather than show nothing. A window without a usable
// utilization or resets_at is skipped, never shown as zero.
export function parseUsageReply(body: unknown): UsageWindow[] | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const ordered = [...FIXED.filter((k) => keys.includes(k)), ...keys.filter((k) => !FIXED.includes(k)).sort()];
  const out: UsageWindow[] = [];
  for (const key of ordered) {
    const win = parseWindow(key, record[key]);
    if (win !== null) out.push(win);
  }
  // M9 fix 294: the live reply carries every per-model key as null and a
  // `limits` list instead, whose weekly_scoped entries name a model; that
  // is where the Fable window is. A top-level key for the same model wins,
  // so nothing shows twice.
  if (Array.isArray(record.limits)) {
    for (const entry of record.limits) {
      const win = parseScopedLimit(entry);
      if (win === null) continue;
      if (out.some((w) => w.key === `seven_day_${win.key.slice(SCOPED_PREFIX.length)}`)) continue;
      out.push(win);
    }
  }
  return out;
}

// M9 fix 739: a hosted session's mod measures the account's rate limits on
// every whole-point move, and the daemon pushes them as usage.limits. Laid
// over the endpoint's windows while the push is the newer reading: a window
// whose key is a limit's kind takes its percent (whole, as the endpoint's
// are) and its reset when that parses; no window is added, an unknown kind
// (spend_limit) matches nothing, and the same array comes back when nothing
// moved. An endpoint answer newer than the push wins.
export interface LimitsOverlay {
  at: number;
  limits: ReadonlyArray<{ kind: string; percentUsed: number; resetsAt: string | null }>;
}

export function overlayLimits(windows: readonly UsageWindow[] | null, overlay: LimitsOverlay | null, fetchedAt: number | null): UsageWindow[] | null {
  if (windows === null) return null;
  if (overlay === null || (fetchedAt !== null && overlay.at <= fetchedAt)) return windows as UsageWindow[];
  let changed = false;
  const out = windows.map((w) => {
    const limit = overlay.limits.find((l) => l.kind === w.key);
    if (limit === undefined || !Number.isFinite(limit.percentUsed)) return w;
    const percent = Math.min(100, Math.max(0, Math.round(limit.percentUsed)));
    const at = limit.resetsAt === null ? null : parseTime(limit.resetsAt);
    const resetsAt = at ?? w.resetsAt;
    if (percent === w.percent && resetsAt === w.resetsAt) return w;
    changed = true;
    return { ...w, percent, resetsAt };
  });
  return changed ? out : (windows as UsageWindow[]);
}

const SCOPED_PREFIX = 'weekly_scoped_';

function parseScopedLimit(value: unknown): UsageWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, percent, resets_at: resetsAt, scope } = value as Record<string, unknown>;
  if (kind !== 'weekly_scoped') return null;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  const at = parseTime(resetsAt);
  if (at === null) return null;
  if (typeof scope !== 'object' || scope === null) return null;
  const model = (scope as Record<string, unknown>).model;
  if (typeof model !== 'object' || model === null) return null;
  const name = (model as Record<string, unknown>).display_name;
  if (typeof name !== 'string' || name.length === 0) return null;
  return {
    key: SCOPED_PREFIX + name.toLowerCase(),
    label: name,
    kind: 'model',
    percent: Math.min(100, Math.max(0, Math.round(percent))),
    resetsAt: at,
  };
}

function parseWindow(key: string, value: unknown): UsageWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { utilization, resets_at: resetsAt } = value as Record<string, unknown>;
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null;
  const at = parseTime(resetsAt);
  if (at === null) return null;
  return {
    key,
    label: labelFor(key),
    kind: FIXED.includes(key) ? 'time' : 'model',
    percent: Math.min(100, Math.max(0, Math.round(utilization))),
    resetsAt: at,
  };
}

// resets_at as an ISO string, or seconds or milliseconds since the epoch.
function parseTime(value: unknown): number | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  return null;
}

// "41m", "2h 5m", "6d 16h", or "now" once the reset has passed. Minutes
// round up so a window that resets in 40 minutes and 50 seconds says 41m,
// as a clock would, and never shows 0m while time is left.
export function resetText(resetsAt: number, now: number): string {
  const left = resetsAt - now;
  if (left <= 0) return 'now';
  const minutes = Math.ceil(left / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// The text of one segment in two parts, the window's name and the rest,
// so the strip can put the dial between them (M9 fix 66: "5h ◔ 17%,
// resets 41m", the dial right before the number it pictures). The window
// comes first so the strip says which number is which, and the reset
// carries its word so "41m" does not read as time used (M9 fix 61;
// Orca's "17% used 41m" left both to the tooltip). A model window leads
// with its name. segmentText is the join, for the tests.
export function segmentLabel(win: UsageWindow): string {
  return shortLabelFor(win.key);
}

// M9 fix 308: a window with a pace bar (one whose length is known)
// drops the percent, since the bar's fill is the percent; the text keeps
// the one thing the bar cannot say, when it resets, with its word. A
// window of unknown length keeps the dial and the full text.
export function segmentRest(win: UsageWindow, now: number): string {
  if (windowLengthMs(win.key) !== null) return `resets ${resetText(win.resetsAt, now)}`;
  return `${win.percent}%, resets ${resetText(win.resetsAt, now)}`;
}

export function segmentText(win: UsageWindow, now: number): string {
  return `${segmentLabel(win)} ${segmentRest(win, now)}`;
}

// The usage card (M73 task 2, UsageCard.tsx) says which window a row is
// and when it resets, in full: what the segment's tooltip said until the
// card took its place.
export function windowName(win: UsageWindow): string {
  return win.kind === 'model' ? `${win.label} 7 day window` : `${win.label} window`;
}

// The same name off the key alone (M9 fix 285), for a capped band, which
// carries the window's key and nothing else of the reading.
export function usageWindowName(key: string): string {
  return windowName({ key, label: labelFor(key), kind: FIXED.includes(key) ? 'time' : 'model', percent: 0, resetsAt: 0 });
}

// M9 fix 308: clock time first, countdown second, so the reset line and
// the runway at its right read outward from the middle.
export function resetWhen(win: UsageWindow, now: number): string {
  const when = new Date(win.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  // "resets in now" read wrong once the reset had passed (M9 fix 68).
  const left = resetText(win.resetsAt, now);
  return `resets ${when}, ${left === 'now' ? 'now' : `in ${left}`}`;
}

// How long a window is, by its key: the five hour and the seven day
// windows and the per-model seven day ones; null for a key the strip
// does not know the length of, whose row draws no bar.
export function windowLengthMs(key: string): number | null {
  if (key === 'five_hour') return 5 * 60 * 60_000;
  if (key === 'one_day') return 24 * 60 * 60_000;
  if (key.startsWith('seven_day')) return 7 * 24 * 60 * 60_000;
  // M9 fix 294: a scoped limit off the `limits` list is a weekly one.
  if (key.startsWith(SCOPED_PREFIX)) return 7 * 24 * 60 * 60_000;
  return null;
}

// How far through its window a reset is, 0 at the window's start and 1
// at the reset, for the card's bar; null for an unknown window length.
export function windowElapsed(win: UsageWindow, now: number): number | null {
  const length = windowLengthMs(win.key);
  if (length === null) return null;
  const left = win.resetsAt - now;
  return Math.max(0, Math.min(1, 1 - left / length));
}

// M9 fix 295: runway, when the window runs out at its average pace. The
// windows are fixed spans that fill from their start, so the percent
// over the part elapsed is the pace, and the ceiling lands where that
// pace reaches 100. null for a window of unknown length, one under five
// percent (nothing to pace), or one in its first tenth (a first request's
// percent over a few minutes projects nonsense). `short` says the ceiling
// lands before the reset; otherwise `atReset` is where the pace ends up.
export interface Runway {
  at: number;
  short: boolean;
  atReset: number | null;
}

const RUNWAY_MIN_PERCENT = 5;
const RUNWAY_MIN_ELAPSED = 0.1;

export function runway(win: UsageWindow, now: number): Runway | null {
  const length = windowLengthMs(win.key);
  if (length === null) return null;
  if (win.percent < RUNWAY_MIN_PERCENT) return null;
  const elapsed = windowElapsed(win, now);
  if (elapsed === null || elapsed < RUNWAY_MIN_ELAPSED) return null;
  const start = win.resetsAt - length;
  const at = start + ((now - start) * 100) / win.percent;
  const short = at < win.resetsAt;
  return { at, short, atReset: short ? null : Math.min(100, Math.round(win.percent / elapsed)) };
}

// The card's words for it, at the right of the reset line (M9 fix 308:
// the preamble went with the bar, which is the projection's picture);
// the duration off resetText so a weekly window reads in days as its
// reset does. A window pinned at 100 has its ceiling at now, and "100%
// in now" is no sentence.
export function runwayText(r: Runway, now: number): string {
  if (r.short && r.at <= now) return 'spent until the reset';
  if (r.short) return `100% in ${resetText(r.at, now)}`;
  return `about ${r.atReset}% at the reset`;
}

// M9 fix 361: how long a break has to be, taken now, to be back at the
// window's average pace by the reset (the ceiling landing on the reset
// rather than before it). A pause leaves the percent where it is while
// time keeps passing, which is the same shift the runway's projection
// takes from a lower average pace; the length of the pause that undoes
// exactly the runway's shortfall is null outside a short runway (nothing
// to catch up from) and null again if the pause would have to be zero or
// negative (the window is short only because of the last few requests, a
// break too short to say).
export function breakFor(win: UsageWindow, now: number): number | null {
  if (runway(win, now)?.short !== true) return null;
  const length = windowLengthMs(win.key);
  if (length === null) return null;
  const elapsed = windowElapsed(win, now);
  if (elapsed === null) return null;
  const start = win.resetsAt - length;
  // Rounded to the millisecond: the formula's divisions land a float on
  // the wrong side of a minute boundary by a fraction of one, and
  // resetText's ceiling then reads a minute high on an otherwise exact
  // reading (a fixed NOW, not a live clock: the fixture caught it, not load).
  const ms = Math.round(length * (1 - ((100 - win.percent) * elapsed) / win.percent) - (now - start));
  return ms > 0 ? ms : null;
}

// The words for it, the duration in resetText's units so a weekly break
// reads in days as its reset does.
export function breakText(ms: number): string {
  return `back on pace after a ${resetText(ms, 0)} break`;
}

// M9 fix 308: the pace bar (docs/design/pace-bars.md). One bar per
// window of known length: the window's whole span, filled from the left
// with the percent used, ticked at the window's unit, and crossed by a
// mark at the elapsed share, where the fill would end at an even pace.
// The gap between the fill's end and the mark is the reading. Everything
// the markup needs comes from here; the components compute nothing.
export interface PaceBar {
  // 0..1, the percent used.
  fill: number;
  // 0..1, the elapsed share.
  mark: number;
  // The tick step as a fraction of the span, or null for no ticks.
  tick: number | null;
  // The interior ticks the step draws (the one at the end lands on the
  // bar's edge), for the script.
  ticks: number;
  tone: 'working' | 'error';
  // As runway() gives it, for the words; null when there is nothing to say.
  runway: Runway | null;
  // M9 fix 347: 0..1, where the pace hits 100 on the span, a mark in the
  // error colour; null unless the runway is short (past the reset the
  // words say it, and the bar's end is the reset).
  ceiling: number | null;
}

// The bar's drawn widths, which the tick unit depends on: 44 px on the
// strip (the floor is the tick spacing, not the bar's length: 32 loses
// the mark among the ticks and 56 moves the stacking breakpoint), and
// the card's 258 px of content.
export const STRIP_BAR_PX = 44;
export const CARD_BAR_PX = 258;

// M9 fix 440: in the column form the bar's track grows into the
// sidebar's spare width (style.css); past this it goes 8px tall rather
// than 6, the mark's overhang still inside the 15px line box.
export const STRIP_BAR_TALL_PX = 88;

// The narrowest a tick gap may be before the ticks read as texture and
// the mark stops being the tallest thing on the bar.
const TICK_MIN_PX = 8;

// The window's natural unit as a fraction of its span: an hour on the
// five hour window, six hours on a day, a day on any week.
function tickUnit(key: string, lengthMs: number): number {
  if (key === 'five_hour') return HOUR_MS / lengthMs;
  if (key === 'one_day') return (6 * HOUR_MS) / lengthMs;
  return DAY_MS / lengthMs;
}

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export function paceBar(win: UsageWindow, now: number, widthPx: number): PaceBar | null {
  const length = windowLengthMs(win.key);
  if (length === null) return null;
  const fill = Math.max(0, Math.min(1, win.percent / 100));
  const mark = windowElapsed(win, now) ?? 0;
  const pace = runway(win, now);
  const tone = win.percent >= HIGH_PERCENT || pace?.short === true ? 'error' : 'working';
  // The unit is coarsened, never refined, until the ticks are far enough
  // apart; a step of the whole span is no tick at all.
  let step = tickUnit(win.key, length);
  while (widthPx * step < TICK_MIN_PX && step < 1) step *= 2;
  const tick = step >= 1 ? null : step;
  const ticks = tick === null ? 0 : Math.ceil(1 / tick - 1e-9) - 1;
  const ceiling = pace !== null && pace.short ? Math.max(0, Math.min(1, (pace.at - (win.resetsAt - length)) / length)) : null;
  return { fill, mark, tick, ticks, tone, runway: pace, ceiling };
}

// M9 fix 44: the meters are dials, a wedge that sweeps from 12 o'clock.
// The percent goes to the CSS as --pct; a wedge of one or two percent is
// thinner than a pixel at 10px, so the display floors at three while the
// text beside it stays exact, and a wedge at ninety or more goes red.
export const HIGH_PERCENT = 90;
const DIAL_FLOOR = 3;

export function dialPercent(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return clamped > 0 && clamped < DIAL_FLOOR ? DIAL_FLOOR : clamped;
}

// M42: a dial that knows where its budget ends early (the pane title's
// context dial, whose wedge triggers a compaction 33k tokens before the
// window is full) draws a band from that point to 100% in --compact; a
// dial without the number leaves the variable at its CSS default of 100%,
// a band of nothing.
export function dialStyle(percent: number, compactAt?: number): CSSProperties {
  const style: Record<string, string> = { '--pct': `${dialPercent(percent)}%` };
  if (compactAt !== undefined) style['--compact'] = `${Math.max(0, Math.min(100, compactAt)).toFixed(1)}%`;
  return style as CSSProperties;
}

// M9 fix 99: a 429's retry-after, seconds or an HTTP date, as ms from
// now; null when the header is missing or unreadable. M9 fix 163: null
// too for `0` and for a date already past, which the endpoint sends on
// nearly every 429 in a run of them; read as a zero hold it put the next
// request at the floor, straight back into the same limit, five minutes
// apart all night. No hint means the back-off decides.
export function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  const text = header.trim();
  let ms: number;
  if (/^\d+$/.test(text)) ms = Number(text) * 1000;
  else {
    const at = Date.parse(text);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return ms > 0 ? ms : null;
}

// M9 fix 163: the strip keeps its last windows through an answer that is
// not a reading (a 429, a dropped connection, a 5xx), since a percent
// moves about once an hour and a note in their place took the numbers
// off the screen on every 429; the card's note then says what the last
// ask met and when the strip asks again. Signed out is not kept through:
// the token is gone and the sign-in line is the truth.
export function staleText(result: Extract<UsageResult, { error: 'unavailable' }>, askedAt: number, allowedAt: number, now: number): string {
  const at = new Date(askedAt).toLocaleTimeString();
  const again = allowedAt > now ? `asks again in ${holdText(allowedAt - now)}` : 'asks again on the next refresh';
  switch (result.reason.kind) {
    case 'rate-limited':
      return `Stale: the ask at ${at} was rate limited; ${again}.`;
    case 'offline':
      return `Stale: the ask at ${at} found no connection; ${again}.`;
    case 'server':
      return `Stale: the ask at ${at} was answered ${result.reason.status}; ${again}.`;
    case 'bad-reply':
      return `Stale: the ask at ${at} got an unreadable reply; ${again}.`;
  }
}

// The note in place of the windows (M9 fix 99): the reason, in a few
// words, where "Usage unavailable" said nothing. A rate limit says when
// the strip may ask again, off the schedule (fix 100) so the note and
// the button agree.
export function errorText(result: Exclude<UsageResult, { windows: unknown }>, allowedAt: number, now: number): string {
  if (result.error !== 'unavailable') return 'Sign in to Claude Code for usage';
  switch (result.reason.kind) {
    case 'rate-limited':
      return allowedAt > now ? `Usage rate limited, retry in ${resetText(allowedAt, now)}` : 'Usage rate limited';
    case 'offline':
      return 'Usage: no connection';
    case 'server':
      return `Usage endpoint answered ${result.reason.status}`;
    case 'bad-reply':
      return 'Usage reply unreadable';
  }
}

// The refresh button's tooltip (M9 fix 99): what a person can do about
// the state the note names, and, while the strip is holding off (fix
// 100), how long the hold has left.
export function refreshTitle(result: UsageResult | null, allowedAt: number, now: number): string {
  const held = allowedAt > now ? ` Retry in ${holdText(allowedAt - now)}.` : '';
  return `${refreshAction(result)}${held}`;
}

function refreshAction(result: UsageResult | null): string {
  if (result === null || 'windows' in result) return 'Refresh usage.';
  if (result.error !== 'unavailable') return 'No valid Claude Code token. Run claude once in any terminal so it refreshes the token, then refresh.';
  switch (result.reason.kind) {
    case 'rate-limited':
      return 'The usage endpoint is rate limiting this account. Wait; the strip asks again on its own once the hold has passed.';
    case 'offline':
      return 'Could not reach the usage endpoint. Check the network, then refresh.';
    case 'server':
      return `The usage endpoint answered ${result.reason.status}; that is on its side, and a later refresh may clear it.`;
    case 'bad-reply':
      return "The usage endpoint's reply could not be read; that is on its side, and a later refresh may clear it.";
  }
}

// "20s", "1m 59s": the hold's remaining time to the second, since a hold
// is short enough to watch.
export function holdText(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// M9 fix 100: the strip respects the endpoint's limit. One request in
// flight, and a floor between requests, the button included; after a
// 429 the floor rises to the retry-after, or five minutes without one,
// doubling on a repeat up to an hour, and falls back to the floor on the
// next answer that is not a 429. The schedule is what the strip and the
// button read: allowedAt is when the next request may go, holdMs the
// back-off a repeat doubles. A signed-out result made no request, but a
// floor after it costs nothing and keeps the rule one rule.
export const USAGE_FLOOR_MS = 30_000;
const HOLD_MS = 5 * 60_000;
const HOLD_MAX_MS = 60 * 60_000;

export interface UsageSchedule {
  allowedAt: number;
  holdMs: number;
}

export const NO_SCHEDULE: UsageSchedule = { allowedAt: 0, holdMs: 0 };

export function nextSchedule(prev: UsageSchedule, result: UsageResult, now: number, floorMs = USAGE_FLOOR_MS): UsageSchedule {
  if ('error' in result && result.error === 'unavailable' && result.reason.kind === 'rate-limited') {
    const hold = result.reason.retryAfterMs ?? (prev.holdMs === 0 ? HOLD_MS : Math.min(HOLD_MAX_MS, prev.holdMs * 2));
    return { allowedAt: now + Math.max(hold, floorMs), holdMs: hold };
  }
  return { allowedAt: now + floorMs, holdMs: 0 };
}

// Whether a poll goes out: the timer's skips a hidden window (nobody is
// looking, and a machine back from sleep reads the same way), and the
// window's focus asks only when the last reading is older than the
// interval, so an open-all-day window costs one request per interval it
// is looked at. The schedule's floor is checked by the fetch itself.
export function shouldPoll(kind: 'timer' | 'focus', hidden: boolean, lastAt: number | null, now: number, intervalMs: number): boolean {
  if (kind === 'timer') return !hidden;
  return lastAt === null || now - lastAt >= intervalMs;
}

// M9 fix 324: the strip's text in the bar's tone, with the runway. The
// bar's tone (paceBar: error at HIGH_PERCENT or when the pace runs
// short) was on the bar alone, the words beside it always muted; the
// text takes the tone now, and in the error tone the runway joins it
// after a dot, so the strip says what the card would ("resets 5d 18h ·
// 100% in 4d 5h"). stripRunway is the runway's words alone, for the
// markup, since the strip's column form puts them on a line of their
// own under the reset; stripText is the join the text reads whole. A
// bar in the error tone with no runway (100 percent in the window's
// first tenth, where no pace is read) has nothing to add.
export function stripRunway(bar: PaceBar | null, now: number): string | null {
  if (bar === null || bar.tone !== 'error' || bar.runway === null) return null;
  return runwayText(bar.runway, now);
}

export function stripText(win: UsageWindow, bar: PaceBar | null, now: number): string {
  const runway = stripRunway(bar, now);
  return runway === null ? segmentRest(win, now) : `${segmentRest(win, now)} · ${runway}`;
}

// M9 fix 347: the strip's form is measured, not a breakpoint. Every
// earlier fit was a container query at a width read off the box on one
// day (fix 29, 62, 68, 324), and each rendering change (a reboot, font
// smoothing off) moved the text a few pixels and broke it. Now the
// strip measures what its texts take (a hidden copy of them in the row
// form, UsageStrip.tsx) and picks the first of four forms that fits the
// windows' box: the row with each window's runway inline, the row with
// each runway on a line of its own under its reset, the column (one
// window per line, the label, the bar and the text in three grid
// columns) with the runways inline, and the column with the runways
// stacked under their resets. A strip with no runway has the same need
// in the first two forms and in the last two, so it lands on the row or
// the column as before. The needs are the pixels the CSS lays out: the
// gap between a window's parts and between windows (STRIP_GAP_PX, the
// 4px of .usage-window and .usage-windows), a dot's own width and its
// margin (STRIP_DOT_MARGIN_PX) before every window but the first in a
// row, the bar's 44px or the dial's 10px, and the text spans, each
// white-space: nowrap so its width is its own in any form.
export type StripForm = '' | 'runway' | 'column' | 'column-runway';
export const STRIP_FORMS: readonly StripForm[] = ['', 'runway', 'column', 'column-runway'];
export const STRIP_GAP_PX = 4;
export const STRIP_DOT_MARGIN_PX = 2;
export const STRIP_METER_PX = 10;

export interface StripWindowNeed {
  label: number;
  bar: number;
  rest: number;
  // The join and the runway are null on a window whose text is one
  // piece (no runway to carry).
  join: number | null;
  runway: number | null;
}

export interface StripNeeds {
  windows: readonly StripWindowNeed[];
  dot: number;
}

const inlineText = (w: StripWindowNeed): number => w.rest + (w.join ?? 0) + (w.runway ?? 0);
const stackedText = (w: StripWindowNeed): number => Math.max(w.rest, w.runway ?? 0);

function rowNeed(needs: StripNeeds, text: (w: StripWindowNeed) => number): number {
  let total = 0;
  needs.windows.forEach((w, i) => {
    if (i > 0) total += STRIP_GAP_PX + needs.dot + STRIP_DOT_MARGIN_PX + STRIP_GAP_PX;
    total += w.label + STRIP_GAP_PX + w.bar + STRIP_GAP_PX + text(w);
  });
  return total;
}

function columnNeed(needs: StripNeeds, text: (w: StripWindowNeed) => number): number {
  if (needs.windows.length === 0) return 0;
  const widest = (f: (w: StripWindowNeed) => number) => Math.max(...needs.windows.map(f));
  return widest((w) => w.label) + STRIP_GAP_PX + widest((w) => w.bar) + STRIP_GAP_PX + widest(text);
}

export function stripNeeds(needs: StripNeeds): Record<StripForm, number> {
  return {
    '': rowNeed(needs, inlineText),
    runway: rowNeed(needs, stackedText),
    column: columnNeed(needs, inlineText),
    'column-runway': columnNeed(needs, stackedText),
  };
}

// The first form whose need fits the box; the last when none does, and
// the box clips it.
export function fitForm(needs: StripNeeds, width: number): StripForm {
  const need = stripNeeds(needs);
  return STRIP_FORMS.find((form) => need[form] <= width) ?? 'column-runway';
}
