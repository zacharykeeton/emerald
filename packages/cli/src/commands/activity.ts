import { activityStats, clockTime, dayBounds, dayKey, formatSpanLength, historyFromText, sessionDebt, statsText, unitBounds, unitKey, weekProfiles, weekStats, weekStatsText, windowName } from '@emerald/shared';
import type { ActivitySession, WeekProfiles } from '@emerald/shared';
import { parse, positionals } from '../args.ts';
import { CliError, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';

const options = {
  // The local day, YYYY-MM-DD; today when left out.
  day: { type: 'string' },
  // M9 fix 230: the week holding the day instead, Monday to Monday, as
  // one load profile per day.
  week: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
} as const;

// The activity card's numbers and lines (M54), for a terminal: the day's
// agent time against its wall time with the parallelism figure, then one
// line per session with its spans as clock times, and under a session
// the agents it sent out (M62), indented, named by their description with
// the type after it. --json gives the daemon's answer with the stats
// beside it, so a script never re-derives them. The last line says how
// far back the daemon's history reaches (M9 fix 607).
export function renderActivity(day: string, sessions: ActivitySession[], stats: ReturnType<typeof activityStats>, today: boolean): string[] {
  const lines = [`${day}${today ? ' (today)' : ''} · ${statsText(stats)}`];
  for (const s of sessions) {
    const spans = s.spans.map((span) => `${clockTime(span.from)} to ${clockTime(span.to)}`).join(', ');
    const total = formatSpanLength(s.spans.reduce((sum, span) => sum + (span.to - span.from), 0));
    if (s.agentId !== null && s.agentId !== undefined) {
      const type = s.agentType !== null && s.agentType !== undefined && s.agentType !== s.name ? ` (${s.agentType})` : '';
      lines.push(`    ${shortId(s.agentId)}  agent  ${total.padStart(7)}  ${s.name ?? 'agent'}${type}  ${spans}`);
      continue;
    }
    // A track outside emerald (M9 fix 233) says so after its name.
    const name = (s.name ?? (s.outside === true ? 'outside emerald' : 'no longer listed')) + (s.outside === true && s.name !== null ? ' (outside emerald)' : '');
    // M9 fix 231: what the session owed over the window, after its
    // spans; nothing when nothing, as on the stats line.
    const owed = sessionDebt(s, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    const debt = owed.debtMs === 0 ? '' : `  waiting on you ${formatSpanLength(owed.debtMs)}`;
    lines.push(`  ${shortId(s.sessionId)}  ${s.lifetime ? 'shell ' : 'agent '} ${total.padStart(7)}  ${name}  ${spans}${debt}`);
  }
  return lines;
}

// The week (M9 fix 230), the tab's seven ridges as text: the week's line,
// then one line per day with its peak, its agent time and its profile as
// the level at each change, `09:12 2 → 10:40 1 → 11:05 0`.
export function renderWeek(name: string, week: WeekProfiles, current: boolean): string[] {
  const lines = [`${name}${current ? ' (this week)' : ''} · ${weekStatsText(weekStats(week))}`];
  for (const row of week.rows) {
    const steps = row.profile.steps.slice(1, -1).map((s) => `${clockTime(s.at)} ${s.open}`).join(' → ');
    const tag = row.when === 'today' ? ' (today)' : row.when === 'future' ? ' (not yet)' : '';
    lines.push(`  ${row.key}  ${row.name.padEnd(6)}  peak ${String(row.profile.peak).padStart(2)}  ${formatSpanLength(row.agentMs).padStart(7)}${tag}${steps === '' ? '' : `  ${steps}`}`);
  }
  return lines;
}

const command: Command = {
  name: 'activity',
  summary: "the day's activity: each session's working spans and how much ran in parallel",
  usage: 'emmer activity [--day YYYY-MM-DD] [--week] [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    positionals(parsed, []);
    const now = Date.now();
    const day = parsed.values.day ?? dayKey(now);
    const bounds = dayBounds(day);
    if (bounds === null) throw usageError(`--day wants YYYY-MM-DD, got ${day}`);
    if (parsed.values.week) {
      // The week holding the day: the Monday's key, whatever day was named.
      const key = unitKey('week', bounds.from);
      const week = unitBounds(key)!;
      if (week.from > now) throw new CliError(`the ${windowName(week)} has not started yet`);
      const to = Math.min(week.to, now);
      const { sessions, capped, historyFrom } = await withDaemon((client) => client.request('activity.spans', { from: week.from, to }));
      const profiles = weekProfiles(sessions, week.from, now);
      const current = key === unitKey('week', now);
      if (parsed.values.json) {
        printJson({ week: key, from: week.from, to, stats: weekStats(profiles), peak: profiles.peak, days: profiles.rows, sessions, capped: capped ?? [], historyFrom: historyFrom ?? null });
        return;
      }
      for (const line of renderWeek(windowName(week), profiles, current)) println(line);
      if (historyFrom !== null && historyFrom !== undefined) println(historyFromText(historyFrom, now));
      return;
    }
    const to = Math.min(bounds.to, now);
    if (to < bounds.from) throw new CliError(`${day} has not started yet`);
    const { sessions, capped, historyFrom } = await withDaemon((client) => client.request('activity.spans', { from: bounds.from, to }));
    const stats = activityStats(sessions, bounds.from, to);
    // The capped bands (M9 fix 285) ride the JSON form; the text form is
    // the sessions' as before.
    if (parsed.values.json) {
      printJson({ day, from: bounds.from, to, stats, sessions, capped: capped ?? [], historyFrom: historyFrom ?? null });
      return;
    }
    for (const line of renderActivity(day, sessions, stats, day === dayKey(now))) println(line);
    if (historyFrom !== null && historyFrom !== undefined) println(historyFromText(historyFrom, now));
  },
};

export default command;
