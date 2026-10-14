import type { ActivitySession, ActivityUnit } from '@emerald/shared';

// The geometry of the activity strip (M54), pure: which stretch of the day
// the strip covers and where each hour falls, for the card and the tab.
// Since M67 the tab can show an hour or a minute instead (`unit`): then
// the axis is the whole window, ticks every five minutes or every ten
// seconds, since the point of the finer units is the window itself.

const HOUR = 3_600_000;
const MINUTE = 60_000;

// The tick step per unit, and how many ticks a label sits on. The
// five-hour window (M9 fix 321) ticks on its hours from its own start,
// each labelled, as the pace bar under it ticks.
const TICK: Record<Exclude<ActivityUnit, 'day'>, number> = { week: 24 * HOUR, 'five-hour': HOUR, hour: 5 * MINUTE, minute: 10_000 };

export interface StripAxis {
  from: number;
  to: number;
  // Every hour mark inside the axis, with the ones that carry a label.
  ticks: Array<{ at: number; label: string | null }>;
}

// The axis runs from the hour before the day's first span (or the hour
// before now, when nothing has run yet) to the hour after the last span
// or now, never outside the day, so the card spends its width on the
// hours that had work in them rather than on the night. Labels sit on
// every hour up to eight of them, every second hour up to sixteen, else
// every fourth, so they never crowd at any width the sidebar takes.
export function stripAxis(sessions: readonly ActivitySession[], day: { from: number; to: number }, now: number, unit: ActivityUnit = 'day'): StripAxis {
  if (unit !== 'day') return unitAxis(day, unit);
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const s of sessions) {
    for (const span of s.spans) {
      if (span.from < first) first = span.from;
      if (span.to > last) last = span.to;
    }
  }
  const live = now >= day.from && now < day.to;
  if (!Number.isFinite(first)) first = live ? now - HOUR : day.from;
  if (!Number.isFinite(last)) last = live ? now : day.from + HOUR;
  if (live && now > last) last = now;
  const from = Math.max(day.from, floorHour(Math.min(first, live ? now - HOUR : first), day.from));
  // A live day keeps an hour of headroom past now, so the growing end of
  // a span is never pinned to the edge.
  const to = Math.min(day.to, ceilHour(live ? last + 1 : last, day.from));
  const hours = Math.max(1, Math.round((to - from) / HOUR));
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : 4;
  const ticks: StripAxis['ticks'] = [];
  for (let at = from; at <= to; at += HOUR) {
    const hour = Math.round((at - day.from) / HOUR);
    ticks.push({ at, label: hour % step === 0 ? `${String(hour % 24).padStart(2, '0')}` : null });
  }
  return { from, to: Math.max(to, from + HOUR), ticks };
}

// An hour or a minute window whole: a tick every five minutes labelled
// `14:05` on every other one, or every ten seconds labelled `:10` on each.
// A week (M9 fix 230) ticks on its days, labelled by the weekday; the
// tab and the card draw the week as ridges and never ask, but the axis
// is whole for anything that does.
function unitAxis(window: { from: number; to: number }, unit: Exclude<ActivityUnit, 'day'>): StripAxis {
  const step = TICK[unit];
  const ticks: StripAxis['ticks'] = [];
  for (let at = window.from, i = 0; at <= window.to; at += step, i += 1) {
    const d = new Date(at);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const label = unit === 'week' ? WEEKDAYS[d.getDay()]! : unit === 'five-hour' ? hm : unit === 'hour' ? (i % 2 === 0 ? hm : null) : `:${String(d.getSeconds()).padStart(2, '0')}`;
    ticks.push({ at, label });
  }
  return { from: window.from, to: window.to, ticks };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function floorHour(at: number, dayFrom: number): number {
  return dayFrom + Math.floor((at - dayFrom) / HOUR) * HOUR;
}

function ceilHour(at: number, dayFrom: number): number {
  return dayFrom + Math.ceil((at - dayFrom) / HOUR) * HOUR;
}

// Where an instant sits on the axis, as a percentage of its width.
export function percentAt(axis: StripAxis, at: number): number {
  const p = ((at - axis.from) / (axis.to - axis.from)) * 100;
  return Math.max(0, Math.min(100, p));
}

// The card's band follows its tracks (M9 fix 167): a one-track hour had
// a 16px band over a 5px strip, three times the thing it profiles, where
// the mock's card draws the band under a strip of several tracks. The
// floor of 10 is where the outline still reads as steps; the cap is the
// mock's, 16 for the rail card and 22 for the wide condensed strip.
export function bandHeight(tracks: number, trackHeight: number, cap: number): number {
  return Math.min(cap, Math.max(10, tracks * trackHeight));
}
