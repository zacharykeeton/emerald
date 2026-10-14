import { useMemo } from 'react';
import { clockTime } from '@emerald/shared';
import type { CappedSpan, DebtProfiles, LoadProfile } from '@emerald/shared';
import { cappedTitle } from './activity-titles.ts';
import { percentAt } from './activity-strip.ts';
import type { StripAxis } from './activity-strip.ts';

// The mirror under the load band (M9 fix 231): how many sessions were
// waiting on the person at each instant, drawn downwards from the
// band's zero line in the waiting tone, so the day reads as two
// profiles on one axis, agents working above the line in amber and
// people owed below it in teal. Two step profiles on the same axis and
// the same scale, the all-debt one and the asked one alone, both filled
// with the one new token, so the overlap reads darker where someone was
// asking and lighter where a turn merely sat unread; one 1px outline on
// the all-debt profile. The strip has its own peak, not the band's
// (the legend names both), and exists only while the window has debt:
// the caller draws nothing at a peak of 0, and its arrival at the day's
// first wait is a layout move made once and never animated. The same
// path construction as ActivityLoad's, y not inverted, since the
// profile hangs from the top of the box.

interface Props {
  axis: StripAxis;
  debt: DebtProfiles;
  now: number;
  height: number;
  crossPercent?: number | null | undefined;
  // The account's capped bands (M9 fix 285), mirrored under the band so
  // the day reads the same above and below the line.
  capped?: readonly CappedSpan[] | undefined;
}

export function ActivityDebt({ axis, debt, now, height, crossPercent = null, capped = [] }: Props) {
  const nowAt = now >= axis.from && now <= axis.to ? percentAt(axis, now) : null;
  const peak = debt.all.peak;
  const signature = `${debt.all.steps.map((s) => `${s.at}:${s.open}`).join(' ')}|${debt.asked.steps.map((s) => `${s.at}:${s.open}`).join(' ')}`;
  const paths = useMemo(() => ({ all: debtPaths(axis, debt.all), asked: debtPaths(axis, debt.asked) }), [axis.from, axis.to, signature]);
  if (peak === 0) return null;
  return (
    <div className="activity-debt" style={{ height }} data-peak={peak}>
      {capped.map((c, i) => {
        const start = percentAt(axis, c.from);
        return <span key={`capped:${i}`} className="activity-capped-span" data-window={c.window} style={{ left: `${start}%`, width: `${Math.max(0, percentAt(axis, c.to) - start)}%`, top: 0, height }} title={cappedTitle(c)} />;
      })}
      <svg className="activity-debt-svg" viewBox={`0 0 100 ${peak}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="activity-debt-fill" data-profile="all" d={paths.all.fill} />
        <path className="activity-debt-fill" data-profile="asked" d={paths.asked.fill} />
        <path className="activity-debt-line" d={paths.all.line} vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
      </svg>
      {nowAt !== null && <span className="activity-now" style={{ left: `${nowAt}%` }} title={`now, ${clockTime(now)}`} />}
      {crossPercent !== null && <span className="activity-cross" style={{ left: `${crossPercent}%` }} />}
    </div>
  );
}

// The two path strings: the outline through the breakpoints, square
// steps, and the fill closed along the top edge, which is the band's
// zero line; the scale is the viewBox's, the shared peak. Exported for
// the tests.
export function debtPaths(axis: StripAxis, profile: LoadProfile): { line: string; fill: string } {
  let line = '';
  let prevY = 0;
  for (let i = 0; i < profile.steps.length; i++) {
    const step = profile.steps[i]!;
    const x = round(percentAt(axis, step.at));
    const y = step.open;
    line += `${i === 0 ? 'M' : ' L'}${x},${prevY} L${x},${y}`;
    prevY = y;
  }
  return { line, fill: `M0,0 L${line.slice(1)} L100,0 Z` };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
