import { useMemo } from 'react';
import { clockTime } from '@emerald/shared';
import type { LoadProfile } from '@emerald/shared';
import { percentAt } from './activity-strip.ts';
import type { StripAxis } from './activity-strip.ts';

// The load band (M74): the day's concurrency as a stepped profile above
// the activity lanes, on the very axis the sibling strip is handed, so
// the two never disagree by a pixel. Height is how many sessions were
// working at that instant, the top of the band the window's peak (a
// dashed level line marked it until M9 fix 177; the top of the band is
// the peak by construction, so the line said nothing the shape did not);
// the area is amber at a low opacity with a 1px outline. Two paths built by string concatenation in a `0 0 100 peak`
// viewBox squashed to the box, x in axis percent and y inverted, square
// steps and no interpolation; the stroke does not scale with the box,
// so it stays 1px at 64px tall and at 16px. Nothing is drawn when the
// peak is 0: a `peak` of 0 is a degenerate scale, and the stats line
// already reads `nothing yet`.

interface Props {
  axis: StripAxis;
  load: LoadProfile;
  now: number;
  // The count running at this instant (M9 fix 207), printed at the head
  // of the now line as `7×`; null or absent on a window off the clock,
  // where the line is absent too.
  running?: number | null | undefined;
  height: number;
  // The fill's opacity: the band reads heavier as it gets shorter, so the
  // condensed forms pass more than the tab's .15.
  fillOpacity?: number | undefined;
  // The crosshair's position (task 4), as a percent of the axis, while
  // the pointer is over the band or the lanes; null otherwise.
  crossPercent?: number | null | undefined;
  // The furniture (M9 fixes 165 and 167): the two grey rules at the top
  // and the middle with the border under the band. The tab's 64px form
  // has it; the mock's condensed strip and its sidebar card draw the
  // fill and the outline bare, since a 10px band under lines is all
  // lines.
  rules?: boolean | undefined;
}

export function ActivityLoad({ axis, load, now, running = null, height, fillOpacity = 0.15, crossPercent = null, rules = true }: Props) {
  const nowAt = now >= axis.from && now <= axis.to ? percentAt(axis, now) : null;
  // The paths depend on the axis bounds and the steps alone, not on the
  // clock, so the 5 s tick that moves the now line does not rebuild them;
  // the steps are keyed by their values, since the view computes a new
  // profile object on every render.
  const signature = load.steps.map((s) => `${s.at}:${s.open}`).join(' ');
  const paths = useMemo(() => loadPaths(axis, load), [axis.from, axis.to, signature]);
  if (load.peak === 0) return null;
  return (
    <div className="activity-load" style={{ height }} data-peak={load.peak} data-rules={rules ? 'on' : 'off'}>
      {rules && <span className="activity-load-rule" style={{ top: 0 }} />}
      {rules && <span className="activity-load-rule" style={{ top: '50%' }} />}
      <svg className="activity-load-svg" viewBox={`0 0 100 ${load.peak}`} preserveAspectRatio="none" aria-hidden="true">
        <path className="activity-load-fill" d={paths.fill} fillOpacity={fillOpacity} />
        <path className="activity-load-line" d={paths.line} vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
      </svg>
      {nowAt !== null && <span className="activity-now" style={{ left: `${nowAt}%` }} title={`now, ${clockTime(now)}`} />}
      {nowAt !== null && running !== null && (
        // To the line's right until the line nears the end of the axis,
        // then to its left, so the figure never leaves the band.
        <span className="activity-now-count" style={{ left: `${nowAt}%` }} data-flip={nowAt > 96 ? '' : undefined} title={`${running} running now`}>
          {running}×
        </span>
      )}
      {crossPercent !== null && <span className="activity-cross" style={{ left: `${crossPercent}%` }} />}
    </div>
  );
}

// The two path strings: a vertical move at each breakpoint then a
// horizontal run to the next, so the steps are square; the fill is the
// same points opened and closed on the baseline. Exported for the tests.
export function loadPaths(axis: StripAxis, load: LoadProfile): { line: string; fill: string } {
  const peak = load.peak;
  let line = '';
  let prevY = peak;
  for (let i = 0; i < load.steps.length; i++) {
    const step = load.steps[i]!;
    const x = round(percentAt(axis, step.at));
    const y = peak - step.open;
    line += `${i === 0 ? 'M' : ' L'}${x},${prevY} L${x},${y}`;
    prevY = y;
  }
  return { line, fill: `M0,${peak} L${line.slice(1)} L100,${peak} Z` };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
