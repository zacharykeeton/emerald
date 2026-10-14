import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clockTime, loadAt } from '@emerald/shared';
import type { LoadProfile } from '@emerald/shared';

// The week unit's drawing (M9 fix 230): the load band once per row,
// stacked with a fixed gap and an overlap so the rows read as ridges,
// the oldest at the back (the top) and the newest in front, every row
// on the same hour-of-day axis and the same vertical scale, so a five on
// Thursday stands as tall as a five on Sunday and the eye reads which
// hours the agents run across the days. The component takes rows and a
// shared peak and knows nothing of what a row is, so a month of weeks or
// a year of months is the same drawing over other sub-windows.
//
// Geometry: the mock's 52px row gap and 62px amplitude on a 900px stage,
// scaled by the ridge area's width (a ResizeObserver, 1 until the first
// measurement, so nothing here waits on a frame). Each row is a div at
// its baseline holding its own SVG (a `0 0 100 h` viewBox squashed to
// the box, x in percent of the day, y in pixels, so the strokes and the
// heights never distort), its label in the gutter, and today's now line;
// the rows come in time order so the front one paints last. The fills
// are opaque, mixed from the session amber toward the page's ground so
// older rows sink toward it, and the front row hides what it stands
// before; the readout gives the number for anything a ridge hides.
//
// The crosshair reads the hour across the days: the pointer's x is the
// hour, the nearest baseline the row, and one line through every band
// with a dot at each row's level, with the hovered row's figure first
// and the seven figures and their median under the axis. Hover state
// alone, a percent, nothing stored.
//
// M9 fix 280: picking days to compare. A click on a row's label toggles
// it in or out of the picked set (the view's own state, passed in as
// `onToggleDay`; nothing here is stored), a double-click solos it; the
// picked rows are `rows`, already filtered and rescaled by the caller
// (`pickRows`), and the rest are handed in as `offRows`, drawn as a
// dimmed list of names under the stack rather than interleaved with it,
// so the picked ridges stay adjacent. A form with no `onToggleDay` (the
// rail card) draws no click affordance and takes no `offRows`.
//
// M9 fix 281: the condensed form, on the density button. Built on the
// card's own restraint (no floor, no scale label, no legend, no textual
// readout) but interactive like the full form, at half scale rather
// than the card's third, so a pane or a tab can shrink the ridges
// without losing the pick or the crosshair's per-dot figures.

export interface RidgeRow {
  key: string;
  // `Thu 10`.
  name: string;
  from: number;
  to: number;
  profile: LoadProfile;
  agentMs: number;
  // The day's own wall time (M9 fix 274), for the label's tooltip.
  wallMs: number;
  when: 'past' | 'today' | 'future';
}

export type RidgesForm = 'full' | 'condensed' | 'card';

interface Props {
  // The picked rows to draw as ridges, already filtered and rescaled by
  // the caller (`pickRows`) when a pick is active; adjacent, in the
  // week's own order.
  rows: readonly RidgeRow[];
  peak: number;
  now: number;
  // The count running at this instant, printed at the head of the now
  // line as `7×`; null on a week off the clock.
  running?: number | null | undefined;
  // The form (M9 fix 230, M9 fix 281): `full` is the tab and the pane at
  // their own width; `condensed` is the same two but shrunk on the
  // density button, built on `card`'s restraint at a less severe scale
  // and still interactive; `card` is the rail's, a third of the scale,
  // no floor, no scale label, no legend, no readout and no picking.
  form?: RidgesForm | undefined;
  // The rows left out of the pick (M9 fix 280), drawn as a dimmed list
  // under the stack; empty or absent while nothing is picked, and never
  // drawn on the card form.
  offRows?: readonly RidgeRow[] | undefined;
  // A click on a label toggles that day in or out of the pick; a
  // double-click solos it. Absent on the card form, which takes no pick.
  onToggleDay?: ((key: string) => void) | undefined;
  onSoloDay?: ((key: string) => void) | undefined;
}

// The mock's numbers on its 732px ridge area.
const STAGE = 732;
const ROW_GAP = 52;
const AMPLITUDE = 62;
// Above and below a row's baseline, room for the stroke.
const PAD = 2;
// The tick row under the front baseline, and the readout line under it.
const AXIS = 14;
const READOUT = 16;
const GUTTER = 168;
// The short gutter of a form with no room for a row's peak and hours
// (M9 fix 230's card, M9 fix 281's condensed): the day's name alone.
const SHORT_GUTTER = 48;
const CARD_SCALE = 0.3;
// The condensed form's scale (M9 fix 281): a half, less severe than the
// card's third, so the ridges still read at a pane's width.
const CONDENSED_SCALE = 0.5;
const HOUR = 3_600_000;
// The prior-peak mark's length (M9 fix 263), in px from each end of the
// ridge; the SVG's x is a percent of the day, so the width converts it.
const MARK_PX = 10;
// The dot label's line height (M9 fix 266); a dot closer than this to
// its row's top takes the label under it, not beside it, so the label
// never lands in the row above's band.
const LABEL_H = 11;
// The height of one name in the dimmed off-day list (M9 fix 280).
const OFF_ROW_H = 14;

export function ActivityRidges({ rows, peak, now, running = null, form = 'full', offRows = [], onToggleDay, onSoloDay }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(STAGE);
  useLayoutEffect(() => {
    const el = area.current;
    if (el === null || form !== 'full') return;
    const read = () => setWidth(el.getBoundingClientRect().width || STAGE);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [form]);
  // The chrome a condensed form drops along with the card's: the floor,
  // the scale label, the legend, the prior-peak marks and the textual
  // readout, kept for the full form alone.
  const full = form === 'full';
  const scale = form === 'card' ? CARD_SCALE : form === 'condensed' ? CONDENSED_SCALE : Math.max(0.5, Math.min(1.25, width / STAGE));
  const gap = Math.round(ROW_GAP * scale);
  const amp = Math.round(AMPLITUDE * scale);
  const gutter = full ? GUTTER : SHORT_GUTTER;
  // The back row's baseline sits one amplitude down, so its peak has room.
  const top = amp + PAD + (full ? 4 : 0);
  const backBase = top;
  const frontBase = top + (rows.length - 1) * gap;
  // The dimmed off-day list (M9 fix 280) sits under the stack, before
  // the axis; empty when nothing is picked.
  const offHeight = offRows.length === 0 ? 0 : offRows.length * OFF_ROW_H + 4;
  const stackEnd = frontBase + offHeight;
  const height = stackEnd + AXIS + (full ? READOUT + 4 : 2);
  const [hover, setHover] = useState<{ percent: number; row: number } | null>(null);
  const onMove = (ev: ReactPointerEvent) => {
    const el = area.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || ev.clientX < rect.left || ev.clientX > rect.right) {
      setHover(null);
      return;
    }
    const percent = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * 100;
    // The nearest row by its baseline less a quarter of the amplitude,
    // the mock's rule, so a pointer inside a ridge picks that ridge.
    const y = ev.clientY - rect.top;
    let row = 0;
    let best = Number.POSITIVE_INFINITY;
    rows.forEach((_, i) => {
      const d = Math.abs(y - (top + i * gap - amp * 0.25));
      if (d < best) {
        best = d;
        row = i;
      }
    });
    setHover({ percent, row });
  };
  const readout = hover === null ? null : readAcross(rows, hover.percent, hover.row, now);
  const markW = round((MARK_PX / Math.max(1, width)) * 100);
  const legend = full && rows.some((_, i) => priorPeak(rows, i) !== null);
  // A label is clickable only where the caller wired the pick (never on
  // the card form, which passes neither handler).
  const picking = onToggleDay !== undefined;
  return (
    <div className={`activity-week${form === 'card' ? ' activity-week-compact' : form === 'condensed' ? ' activity-week-condensed' : ''}`} style={{ height }} data-peak={peak} data-scale={scale.toFixed(2)} data-rows={rows.length} data-hover={hover === null ? undefined : hover.row} onPointerMove={form === 'card' ? undefined : onMove} onPointerLeave={form === 'card' ? undefined : () => setHover(null)}>
      {/* The shared scale, on the back row's left. */}
      {full && peak > 0 && (
        <span className="activity-week-scale" style={{ width: gutter - 8, top: backBase - amp - 6 }}>
          {peak} at once
        </span>
      )}
      {/* What a dashed mark means (M9 fix 263), under the scale in the gutter; a form short on room has no marks and no legend. */}
      {legend && peak > 0 && (
        <span className="activity-week-legend" style={{ width: gutter - 8, top: backBase - amp + 8 }}>
          <i className="activity-week-legend-mark" />
          the day before&apos;s peak
        </span>
      )}
      <div className="activity-week-area" ref={area} style={{ left: gutter }}>
        {/* The floor: a rule every six hours from the back baseline to the front. */}
        {full && [0, 6, 12, 18, 24].map((h) => <span key={h} className="activity-week-floor" style={{ left: `${(h / 24) * 100}%`, top: backBase, height: frontBase - backBase }} />)}
      </div>
      {rows.map((row, i) => {
        const base = top + i * gap;
        const nowAt = row.when === 'today' ? percentOf(row, now) : null;
        const dot = hover === null || readout === null ? null : readout.figures[i];
        const dotTop = dot === null || dot === undefined ? null : amp + PAD - (peak === 0 ? 0 : (dot / peak) * amp);
        const prior = full ? priorPeak(rows, i) : null;
        const priorY = prior === null || peak <= 0 ? null : round(amp + PAD - (prior.peak / peak) * amp);
        const priorTitle = prior === null ? '' : `${prior.name}'s peak, ${prior.peak}`;
        const hours = (row.agentMs / HOUR).toFixed(1);
        // The tooltip (M9 fix 274): the day's own agent time over its wall
        // time as a ratio, since the gutter's label has no room for it; a
        // day that ran nothing stays a plain name, and the day before's
        // peak (M9 fix 263) still ends it when this row has one.
        const wallHours = (row.wallMs / HOUR).toFixed(1);
        const parallel = row.wallMs === 0 ? 0 : row.agentMs / row.wallMs;
        const priorSuffix = prior === null ? '' : ` · prev ${prior.peak}`;
        const title = row.when === 'future' ? `${row.name}, not yet` : row.agentMs === 0 ? `${row.name}${priorSuffix}` : `${row.name} · ${hours} agent-hours in ${wallHours} · ${parallel.toFixed(1)}×${priorSuffix}`;
        return (
          <div key={row.key} className="activity-week-row" style={{ top: base - amp - PAD, height: amp + 2 * PAD }} data-day={row.key} data-when={row.when} data-peak={row.profile.peak} data-prior-peak={prior === null ? undefined : prior.peak} data-now={nowAt === null ? undefined : nowAt.toFixed(2)} data-hot={hover !== null && hover.row === i ? '' : undefined}>
            {/* A day not yet reached is named alone; a peak of 0 would say it had run and found nothing. Picking (M9 fix 280): a click toggles the day, a double-click solos it; pointerEvents is left at auto for these only, the row itself taking none. */}
            <span
              className="activity-week-label"
              style={{ width: gutter - 8, pointerEvents: picking ? 'auto' : 'none', cursor: picking ? 'pointer' : undefined }}
              title={title}
              onClick={picking ? () => onToggleDay!(row.key) : undefined}
              onDoubleClick={picking && onSoloDay !== undefined ? () => onSoloDay(row.key) : undefined}
            >
              {!full || row.when === 'future' ? row.name : `${row.name} · peak ${row.profile.peak} · ${hours}h`}
            </span>
            <div className="activity-week-ridge" style={{ left: gutter }}>
              <svg className="activity-week-svg" viewBox={`0 0 100 ${amp + 2 * PAD}`} preserveAspectRatio="none" aria-hidden="true">
                <line className="activity-week-baseline" x1={0} y1={amp + PAD} x2={100} y2={amp + PAD} vectorEffect="non-scaling-stroke" />
                {row.profile.peak > 0 && <path className="activity-week-fill" d={`${ridgePath(row, peak, amp, PAD)} Z`} style={{ fill: fillFor(i, rows.length) }} />}
                {row.profile.peak > 0 && <path className="activity-week-line" d={ridgePath(row, peak, amp, PAD)} style={{ opacity: strokeFor(i, rows.length) }} vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />}
                {/* The previous day's peak (M9 fix 257) as a short mark at each end of the row (M9 fix 263): the rows overlap by more than the gap, so a line across the day at a height near the week's peak lay in the row above's band and read as its second line; a mark at this row's edge is this row's whatever its height. A wide transparent line under each carries the title, since a hover never lands on a 1px stroke. */}
                {priorY !== null && (
                  <>
                    <line className="activity-week-prior" x1={0} y1={priorY} x2={markW} y2={priorY} vectorEffect="non-scaling-stroke" />
                    <line className="activity-week-prior" x1={round(100 - markW)} y1={priorY} x2={100} y2={priorY} vectorEffect="non-scaling-stroke" />
                    <line className="activity-week-prior-hit" x1={0} y1={priorY} x2={markW} y2={priorY} vectorEffect="non-scaling-stroke">
                      <title>{priorTitle}</title>
                    </line>
                    <line className="activity-week-prior-hit" x1={round(100 - markW)} y1={priorY} x2={100} y2={priorY} vectorEffect="non-scaling-stroke">
                      <title>{priorTitle}</title>
                    </line>
                  </>
                )}
              </svg>
              {nowAt !== null && <span className="activity-week-now" style={{ left: `${nowAt}%` }} title={`now, ${clockTime(now)}`} />}
              {nowAt !== null && running !== null && full && (
                <span className="activity-now-count" style={{ left: `${nowAt}%` }} data-flip={nowAt > 96 ? '' : undefined} title={`${running} running now`}>
                  {running}×
                </span>
              )}
              {dotTop !== null && <span className="activity-week-dot" style={{ left: `${hover!.percent}%`, top: dotTop }} />}
              {/* The dot's own figure beside it (M9 fix 266), so a value is read off its ridge and not mapped back from the readout's seven by their order; left of the dot past 90 percent as the now count flips, under it when the dot sits within a line of the row's top. */}
              {dotTop !== null && (
                <span className="activity-week-dot-label" style={{ left: `${hover!.percent}%`, top: dotTop }} data-flip={hover!.percent > 90 ? '' : undefined} data-under={dotTop < LABEL_H ? '' : undefined}>
                  {dot}
                </span>
              )}
            </div>
          </div>
        );
      })}
      {/* The days left out of the pick (M9 fix 280): a dimmed list under
          the stack, a name each, a click bringing it back. Never on the
          card form, which is handed no offRows. */}
      {offRows.length > 0 && (
        <div className="activity-week-off" style={{ top: frontBase + PAD + 2, width: gutter - 8 }}>
          {offRows.map((row, i) => (
            <span key={row.key} className="activity-week-row activity-week-off-row" data-day={row.key} data-off="" style={{ top: i * OFF_ROW_H }} title={`${row.name}, off; click to bring it back`} onClick={() => onToggleDay?.(row.key)}>
              {row.name}
            </span>
          ))}
        </div>
      )}
      {/* The hour axis under the front row, a tick every hour and a label every third. */}
      <div className="activity-ticks activity-week-ticks" style={{ left: gutter, top: stackEnd + PAD }}>
        {Array.from({ length: 25 }, (_, h) => (
          <span key={h} className="activity-tick" data-label={h % 3 === 0 ? '' : undefined} style={{ left: `${(h / 24) * 100}%` }}>
            {h % 3 === 0 && !(!full && h % 6 !== 0) && <span className="activity-tick-label">{String(h % 24).padStart(2, '0')}</span>}
          </span>
        ))}
      </div>
      {/* The crosshair, over the rows so it reads through the front ridge; the dots are each row's own. */}
      {hover !== null && (
        <div className="activity-week-overlay" style={{ left: gutter }}>
          <span className="activity-week-cross" style={{ left: `${hover.percent}%`, top: backBase - amp, height: frontBase - backBase + amp + PAD }} />
        </div>
      )}
      {full && (
        <div className="activity-week-readout" style={{ top: stackEnd + AXIS + 4, left: gutter }} data-figures={readout === null ? undefined : readout.figures.filter((f) => f !== null).length} data-median={readout === null || readout.median === null ? undefined : readout.median}>
          {readout !== null && hover !== null && (
            <>
              <span className="activity-week-readout-lead">{readout.lead}</span>
              {' · at '}
              {readout.clock}
              {' this week '}
              <span className="activity-week-readout-row">
                {readout.figures.map((f, i) => (
                  <span key={rows[i]!.key} data-hi={i === hover.row ? '' : undefined} data-zero={f === 0 ? '' : undefined}>
                    {f === null ? '·' : f}
                  </span>
                ))}
              </span>
              {readout.median === null ? '' : ` · median ${readout.median}`}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The previous row's peak for a row's tick (M9 fix 257): a faint line at
// the day before's peak so a ridge crossing the row above's baseline is
// not read as beating it (every row is drawn on the week's shared peak
// with a fixed gap, so it never means that). Past and today's rows
// only, and only when the day before peaked above 0; the back row has
// no day before inside the window and gets none.
export function priorPeak(rows: readonly RidgeRow[], i: number): { name: string; peak: number } | null {
  const row = rows[i];
  const prev = rows[i - 1];
  if (row === undefined || prev === undefined) return null;
  if (row.when === 'future' || prev.profile.peak <= 0) return null;
  return { name: prev.name, peak: prev.profile.peak };
}

// Where an instant sits on a row's day, as a percent.
function percentOf(row: { from: number; to: number }, at: number): number {
  return Math.max(0, Math.min(100, ((at - row.from) / (row.to - row.from)) * 100));
}

// The ridge's path in the row's own box: square steps from the profile,
// x in percent of the day, y from the baseline up by the level over the
// shared peak, starting and ending on the baseline (the profile's own
// first and last steps are 0); the fill closes it, the line stays open
// so the baseline carries no amber. Exported for the tests.
export function ridgePath(row: { from: number; to: number; profile: LoadProfile }, peak: number, amp: number, pad: number): string {
  const base = amp + pad;
  const y = (open: number) => round(base - (peak === 0 ? 0 : (open / peak) * amp));
  let d = '';
  let prevY = base;
  for (let i = 0; i < row.profile.steps.length; i++) {
    const step = row.profile.steps[i]!;
    const x = round(percentOf(row, step.at));
    d += `${i === 0 ? 'M' : ' L'}${x},${prevY} L${x},${y(step.open)}`;
    prevY = y(step.open);
  }
  return d;
}

// The hour under the pointer read across the rows (exported for the
// tests): the hovered row's figure in words, then each row's level at
// that hour of its day (null where the day has not reached it) and the
// median of the ones there are.
export function readAcross(rows: readonly RidgeRow[], percent: number, hovered: number, now: number): { lead: string; clock: string; figures: Array<number | null>; median: number | null } {
  const figures = rows.map((row) => {
    const at = row.from + (percent / 100) * (row.to - row.from);
    if (row.when === 'future' || (row.when === 'today' && at > now)) return null;
    return loadAt(row.profile, at);
  });
  const row = rows[hovered]!;
  const at = row.from + (percent / 100) * (row.to - row.from);
  const clock = clockTime(at);
  const here = figures[hovered];
  const lead = `${row.name} · ${clock} · ${here === null || here === undefined ? 'not yet' : `${here} running`}`;
  const there = figures.filter((f): f is number => f !== null).sort((a, b) => a - b);
  const median = there.length === 0 ? null : there.length % 2 === 1 ? there[(there.length - 1) / 2]! : (there[there.length / 2 - 1]! + there[there.length / 2]!) / 2;
  return { lead, clock, figures, median };
}

// Older rows sink toward the ground: the fill is the amber mixed into
// the page's background, a tenth for the oldest row up to a third for
// the newest; opaque, so the front row hides what it stands before.
function fillFor(i: number, n: number): string {
  const t = n <= 1 ? 1 : i / (n - 1);
  const share = Math.round(10 + 24 * t);
  return `color-mix(in srgb, var(--working) ${share}%, var(--bg))`;
}

function strokeFor(i: number, n: number): number {
  const t = n <= 1 ? 1 : i / (n - 1);
  return Math.round((0.45 + 0.55 * t) * 100) / 100;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
