import type { ActivitySession } from './activity.ts';
import { clockTime, debtSpans, shortDayName, weekDays, workingSpans } from './activity-model.ts';

// The load band (M74): how many sessions were working at each instant of
// the window, as a step function the activity view draws above its lanes.
// The same sweep over the same spans as activityStats, so the band's
// peak is the stats line's peak; here every change of the open count is
// kept as a breakpoint rather than folded into a sum.

export interface LoadStep {
  at: number;
  open: number;
}

export interface LoadProfile {
  // Breakpoints in time order: `open` holds from `at` until the next
  // step's `at`. The first is `{ from, 0 }` and the last `{ to, 0 }`, so
  // a path drawn through them closes on the baseline at both ends.
  steps: LoadStep[];
  // The most open at one instant, 0 when nothing worked.
  peak: number;
  // The open count in force for the middle of the busy time: the
  // time-weighted median over the stretches where the count is above
  // zero, so one long solo stretch outweighs six short fan-outs. 0 when
  // nothing worked.
  median: number;
}

export function activityLoad(sessions: readonly ActivitySession[], from: number, to: number): LoadProfile {
  return profileOf(workingSpans(sessions), from, to);
}

// The mirror under the band (M9 fix 231): how many sessions were waiting
// on the person at each instant, the same sweep over the waiting
// stretches, twice: every stretch, and the asked ones alone, so the two
// fills overlap darker where someone was asking and lighter where a
// turn merely sat unread. The view draws them downwards from the band's
// zero line on their own peak, the all-debt profile's.
export interface DebtProfiles {
  all: LoadProfile;
  asked: LoadProfile;
}

export function debtLoad(sessions: readonly ActivitySession[], from: number, to: number): DebtProfiles {
  return { all: profileOf(debtSpans(sessions), from, to), asked: profileOf(debtSpans(sessions, 'asked'), from, to) };
}

function profileOf(all: ReadonlyArray<{ from: number; to: number }>, from: number, to: number): LoadProfile {
  const spans = all
    .map((s) => ({ from: Math.max(s.from, from), to: Math.min(s.to, to) }))
    .filter((s) => s.to > s.from);
  // An end sorts before a start at the same instant, as in activityStats,
  // so two spans that touch never count as two open.
  const edges: Array<{ at: number; delta: number }> = [];
  for (const s of spans) edges.push({ at: s.from, delta: 1 }, { at: s.to, delta: -1 });
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  const steps: LoadStep[] = [{ at: from, open: 0 }];
  let open = 0;
  let peak = 0;
  for (let i = 0; i < edges.length; i++) {
    const at = edges[i]!.at;
    // Every edge at one instant lands in one step, so a start and an end
    // that coincide leave the count where it was rather than a zero-width
    // dip or spike.
    while (i < edges.length && edges[i]!.at === at) {
      open += edges[i]!.delta;
      i++;
    }
    i--;
    const last = steps[steps.length - 1]!;
    if (last.at === at) last.open = open;
    else if (last.open !== open) steps.push({ at, open });
    if (open > peak) peak = open;
  }
  const end = steps[steps.length - 1]!;
  if (end.at === to) end.open = 0;
  else steps.push({ at: to, open: 0 });
  return { steps, peak, median: busyMedian(steps) };
}

// The level at the halfway point of the busy time: the stretches with
// the count above zero, sorted by level, walked until half their summed
// length has passed.
function busyMedian(steps: LoadStep[]): number {
  const stretches: Array<{ level: number; ms: number }> = [];
  let total = 0;
  for (let i = 0; i + 1 < steps.length; i++) {
    const s = steps[i]!;
    if (s.open === 0) continue;
    const ms = steps[i + 1]!.at - s.at;
    stretches.push({ level: s.open, ms });
    total += ms;
  }
  if (total === 0) return 0;
  stretches.sort((a, b) => a.level - b.level);
  let seen = 0;
  for (const s of stretches) {
    seen += s.ms;
    if (seen * 2 >= total) return s.level;
  }
  return stretches[stretches.length - 1]!.level;
}

// The open count at an instant, by a binary search of the steps: the
// last step at or before `at`, or 0 before the first.
export function loadAt(profile: LoadProfile, at: number): number {
  const steps = profile.steps;
  let lo = 0;
  let hi = steps.length - 1;
  if (hi < 0 || at < steps[0]!.at) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (steps[mid]!.at <= at) lo = mid;
    else hi = mid - 1;
  }
  return steps[lo]!.open;
}

// The week unit (M9 fix 230): one load profile per day of the week, on
// the day's own bounds, so the ridges the activity view stacks are the
// day band seven times over, aligned on the hour of the day. A span that
// crosses midnight lands on both days, clipped, since activityLoad clips
// to its window; a day past `now` is an empty baseline, today's profile
// ends at `now`. One shared peak, the week's, so a five on Thursday
// stands as tall as a five on Sunday.

export interface WeekRow {
  key: string;
  // `Thu 10`.
  name: string;
  from: number;
  to: number;
  profile: LoadProfile;
  // The day's agent time, the area under its profile.
  agentMs: number;
  // The day's wall time (M9 fix 274): the sum of its stretches with the
  // count above zero, for a per-day parallelism figure on the label's
  // tooltip.
  wallMs: number;
  // Where the day stands against the clock.
  when: 'past' | 'today' | 'future';
}

export interface WeekProfiles {
  rows: WeekRow[];
  peak: number;
}

// M9 fix 280: picking days to compare. `on` names the rows to keep, in
// the week's own order; the peak is recomputed over them alone so a
// quiet pair is not flattened by a busier day left out of the pick.
// `on` empty is the caller's mistake (the view never lets the last row
// go), answered as no pick at all rather than an empty week.
export function pickRows(week: WeekProfiles, on: ReadonlySet<string>): WeekProfiles {
  const rows = week.rows.filter((r) => on.has(r.key));
  if (rows.length === 0) return week;
  let peak = 0;
  for (const row of rows) if (row.profile.peak > peak) peak = row.profile.peak;
  return { rows, peak };
}

// The stats line's head while a pick is on: `2 of 7 days`, empty while
// nothing is picked or the pick covers every row (the click that clears
// it is the caller's, over this text). Exported for the tests.
export function pickHead(total: number, picked: number): string {
  return picked === 0 || picked === total ? '' : `${picked} of ${total} days`;
}

// M9 fix 281: the condensed form's stats line, weekStatsText's own
// output with the busiest-hour clause cut, since a short pane has no
// room for it; the full text is the caller's to keep as a tooltip.
export function weekStatsHead(text: string): string {
  const cut = text.indexOf(' · busiest hour ');
  return cut === -1 ? text : text.slice(0, cut);
}

export function weekProfiles(sessions: readonly ActivitySession[], mondayFrom: number, now: number): WeekProfiles {
  const rows: WeekRow[] = [];
  let peak = 0;
  for (const day of weekDays(mondayFrom)) {
    const when = now < day.from ? 'future' : now < day.to ? 'today' : 'past';
    const profile = when === 'future' ? { steps: [{ at: day.from, open: 0 }, { at: day.to, open: 0 }], peak: 0, median: 0 } : activityLoad(sessions, day.from, Math.min(day.to, now));
    if (profile.peak > peak) peak = profile.peak;
    rows.push({ key: day.key, name: shortDayName(day.from), from: day.from, to: day.to, profile, agentMs: areaUnder(profile), wallMs: wallUnder(profile), when });
  }
  return { rows, peak };
}

function areaUnder(profile: LoadProfile): number {
  let ms = 0;
  for (let i = 0; i + 1 < profile.steps.length; i++) ms += profile.steps[i]!.open * (profile.steps[i + 1]!.at - profile.steps[i]!.at);
  return ms;
}

// The stretch length with the count above zero, in one pass over the
// same steps areaUnder reads.
function wallUnder(profile: LoadProfile): number {
  let ms = 0;
  for (let i = 0; i + 1 < profile.steps.length; i++) if (profile.steps[i]!.open > 0) ms += profile.steps[i + 1]!.at - profile.steps[i]!.at;
  return ms;
}

// The week's figures for its stats line: the peak and where it stood
// (the first instant it was reached), the hour of the day with the most
// agent time summed over the seven days, and the agent time whole. M9
// fix 274: the wall time and the parallelism it implies, as the day's
// stats carry (statsFigures in activity-model.ts), so the week's line
// says how much of the wall time was actually spent working rather than
// the agent time alone.
export interface WeekStats {
  peak: number;
  peakDay: string | null;
  peakAt: number | null;
  // 0 to 23, null when nothing ran.
  busiestHour: number | null;
  agentMs: number;
  // The sum of the seven days' own wall time; the days do not overlap,
  // so this is already the week's union.
  wallMs: number;
  // agentMs over wallMs, 0 when nothing ran.
  parallel: number;
}

export function weekStats(week: WeekProfiles): WeekStats {
  let peak = 0;
  let peakDay: string | null = null;
  let peakAt: number | null = null;
  let agentMs = 0;
  let wallMs = 0;
  const byHour = new Array<number>(24).fill(0);
  for (const row of week.rows) {
    agentMs += row.agentMs;
    wallMs += row.wallMs;
    const steps = row.profile.steps;
    for (let i = 0; i + 1 < steps.length; i++) {
      const s = steps[i]!;
      if (s.open > peak) {
        peak = s.open;
        peakDay = row.name;
        peakAt = s.at;
      }
      if (s.open === 0) continue;
      // The stretch spread over the hours it touches, so a turn across
      // 13:50 to 14:10 credits ten minutes to each.
      let at = s.at;
      const end = steps[i + 1]!.at;
      while (at < end) {
        const d = new Date(at);
        const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
        const stop = Math.min(end, hourEnd);
        byHour[d.getHours()] = byHour[d.getHours()]! + s.open * (stop - at);
        at = stop;
      }
    }
  }
  let busiestHour: number | null = null;
  for (let h = 0; h < 24; h++) if (byHour[h]! > 0 && (busiestHour === null || byHour[h]! > byHour[busiestHour]!)) busiestHour = h;
  const parallel = wallMs === 0 ? 0 : agentMs / wallMs;
  return { peak, peakDay, peakAt, busiestHour, agentMs, wallMs, parallel };
}

// `38.2 agent-hours in 21.4 · 1.8× parallel · peak 7 Tue 15 00:00 ·
// busiest hour 14:00 across the week`, the day's order (the figures
// first, the peak after, M9 fix 274), and `nothing yet` before any
// session has worked; the count running now is the caller's to add, as
// on the day.
export function weekStatsText(stats: WeekStats): string {
  if (stats.agentMs === 0 || stats.peakAt === null) return 'nothing yet';
  const hours = (stats.agentMs / 3_600_000).toFixed(1);
  const wallHours = (stats.wallMs / 3_600_000).toFixed(1);
  const busiest = stats.busiestHour === null ? '' : ` · busiest hour ${String(stats.busiestHour).padStart(2, '0')}:00 across the week`;
  return `${hours} agent-hours in ${wallHours} · ${stats.parallel.toFixed(1)}× parallel · peak ${stats.peak} ${stats.peakDay} ${clockTime(stats.peakAt)}${busiest}`;
}
