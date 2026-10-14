import { activityRowKey, clockTime } from '@emerald/shared';
import type { ActivitySession, CappedSpan, DebtKind } from '@emerald/shared';
import { cappedTitle, debtTitle, spanTitle } from './activity-titles.ts';
import { crossCard, crossCardSize, crossLane, readoutHasRoom, trackAt } from './activity-cross-model.ts';
import type { CrossCardPlace } from './activity-cross-model.ts';
import { percentAt } from './activity-strip.ts';
import type { StripAxis } from './activity-strip.ts';

// The strip the activity card and the activity tab draw (M54): one row
// per track, a line per span placed by percentage along the axis, the
// hour ticks along the bottom and a mark at now. Percentages rather than
// an SVG viewBox, so the lines stay 2px at any width and the sidebar's
// resize costs nothing. A span's colour is the session's (M24), the
// folder colour for a session with none; a shell's lifetime row is not
// drawn at all (M9 fix 191, the rows come filtered). Turned vertical (the tab's ⇅),
// the tracks become columns and time runs downwards; the same elements,
// placed on the other axis by the CSS.
//
// M9 fix 231: a session's waiting stretches ride its row beside its
// spans, on the same centre line, carried by weight rather than
// texture: an asked stretch is 2px of solid teal against the 4px
// working bar, an unread one a 1px teal rule, so a lane reads as one
// line that thins when the agent stops and the person owes. A stretch
// still open reaches now through liveSpans like a working span, with
// no pulse: its end at the now line is the live signal.

export type StripOrientation = 'horizontal' | 'vertical';

interface Props {
  rows: ActivitySession[][];
  axis: StripAxis;
  now: number;
  // The pixel size of a track across the time axis: the card packs them
  // tight, the tab gives each session a named row.
  rowHeight: number;
  // The sessions the store lists as working now, for the `data-live`
  // mark on their last span. The span itself already reaches now: the
  // rows come through liveSpans (M9 fix 228), the one end the band and
  // the stats line read too, so this no longer extends anything.
  working: ReadonlySet<string>;
  orientation?: StripOrientation | undefined;
  // The length of the time axis in pixels when vertical; horizontal
  // takes the container's width.
  length?: number | undefined;
  // The crosshair (M74): a percent along the axis while the pointer is
  // over the tab's band or lanes, with the readout the tick row shows
  // at it; the view owns the pointer, the strip only draws. Horizontal
  // only. `sub` is a second line under the readout (M9 fix 231), the
  // sessions waiting at that instant, where the caller has room for it.
  // `y` (M9 fix 251) is the pointer's height inside the strip's box, off
  // the tracks when negative or past them: the floating card sits at
  // it, with the lane under it as a third line; `width` the box's width
  // as the view measured it on the move, so the card is clamped inside;
  // `at` the crossed instant the lane line reads the tracks at.
  cross?: { percent: number; y: number; width: number; at: number; text: string; sub?: string | null } | null | undefined;
  // The sessions the store lists as owed (M9 fix 231), for the
  // `data-live` mark on a growing stretch; nothing is extended here.
  owed?: ReadonlyMap<string, DebtKind> | undefined;
  // The account's capped bands (M9 fix 285), drawn behind the lanes
  // across every track, since a spent window stopped every session.
  capped?: readonly CappedSpan[] | undefined;
}

// The room the tick labels take, along the time axis.
const TICKS_SIZE = 12;

export function ActivityStrip({ rows, axis, now, rowHeight, working, orientation = 'horizontal', length, cross = null, owed, capped = [] }: Props) {
  const vertical = orientation === 'vertical';
  // The parents' names, for an agent's hover.
  const parentNames = new Map<string, string | null>();
  for (const row of rows) for (const s of row) if (s.agentId === null || s.agentId === undefined) parentNames.set(s.sessionId, s.name);
  const nowAt = now >= axis.from && now <= axis.to ? percentAt(axis, now) : null;
  const across = rows.length * rowHeight + TICKS_SIZE;
  const style = vertical ? { width: across, height: length ?? 600 } : { height: across };
  const place = (from: number, size: number) => (vertical ? { top: `${from}%`, height: `${size}%` } : { left: `${from}%`, width: `${size}%` });
  const at = (p: number) => (vertical ? { top: `${p}%` } : { left: `${p}%` });
  const track = (i: number) => (vertical ? { left: i * rowHeight, width: rowHeight } : { top: i * rowHeight, height: rowHeight });
  // The floating readout (M9 fix 251): the axis readout's lines and the
  // lane under the pointer, placed beside the line at the pointer's y by
  // the model against the box the view measured on the move, kept off
  // the tick row (M9 fix 262); on a strip too short for it, no card,
  // and the lane's words ride the axis readout when there is room.
  const floating = cross === null || vertical ? null : floatingCard(cross, rows, rowHeight, across, parentNames);
  const card = floating?.card ?? null;
  const readoutLane = floating?.readoutLane ?? null;
  return (
    <div className="activity-strip" data-orientation={orientation} style={style}>
      {capped.map((c, i) => {
        const start = percentAt(axis, c.from);
        const size = Math.max(0, percentAt(axis, c.to) - start);
        const span = rows.length * rowHeight;
        return <span key={`capped:${i}`} className="activity-capped-span" data-window={c.window} style={{ ...place(start, size), ...(vertical ? { left: 0, width: span } : { top: 0, height: span }) }} title={cappedTitle(c)} />;
      })}
      {rows.map((row, i) => (
        <div key={i} className="activity-track" style={track(i)}>
          {row.map((s) =>
            (s.debt ?? []).map((d, j) => {
              const key = activityRowKey(s);
              const last = j === (s.debt ?? []).length - 1;
              const live = last && owed?.get(key) === d.kind;
              const start = percentAt(axis, d.from);
              const size = Math.max(0, percentAt(axis, d.to) - start);
              return <span key={`${key}:debt:${j}`} className="activity-debt-span" data-kind={d.kind} data-session-id={s.sessionId} data-live={live ? '' : undefined} style={place(start, size)} title={debtTitle(s, d)} />;
            }),
          )}
          {row.map((s) =>
            s.spans.map((span, j) => {
              const last = j === s.spans.length - 1;
              const key = activityRowKey(s);
              const live = last && working.has(key);
              const to = span.to;
              const start = percentAt(axis, span.from);
              // The true width; the CSS gives it a 2px floor on screen.
              const size = Math.max(0, percentAt(axis, to) - start);
              return (
                <span
                  key={`${key}:${j}`}
                  className="activity-span"
                  data-session-id={s.sessionId}
                  data-agent-id={s.agentId ?? undefined}
                  data-agent={s.agentId === null || s.agentId === undefined ? undefined : ''}
                  data-live={live ? '' : undefined}
                  data-outside={s.outside === true ? '' : undefined}
                  style={{ ...place(start, size), ...(s.color === null ? {} : { color: s.color }) }}
                  title={spanTitle(s, span, to, parentNames.get(s.sessionId))}
                />
              );
            }),
          )}
        </div>
      ))}
      <div className="activity-ticks" style={vertical ? { left: rows.length * rowHeight } : { top: rows.length * rowHeight }}>
        {axis.ticks.map((t) => (
          <span key={t.at} className="activity-tick" data-label={t.label ?? undefined} style={at(percentAt(axis, t.at))}>
            {t.label !== null && <span className="activity-tick-label">{t.label}</span>}
          </span>
        ))}
        {cross !== null && !vertical && (
          <span className="activity-cross-readout" style={{ left: `${cross.percent}%` }}>
            {cross.text}
            {readoutLane !== null && <span className="activity-cross-readout-lane">{` · ${readoutLane}`}</span>}
            {cross.sub !== null && cross.sub !== undefined && <span className="activity-cross-readout-sub">{cross.sub}</span>}
          </span>
        )}
      </div>
      {nowAt !== null && <span className="activity-now" style={at(nowAt)} title={`now, ${clockTime(now)}`} />}
      {cross !== null && !vertical && <span className="activity-cross" style={{ left: `${cross.percent}%` }} />}
      {card !== null && (
        <span className="activity-cross-card" data-side={card.side} data-flip={card.flip} data-lane={card.lane ?? undefined} style={{ left: card.left ?? undefined, right: card.right ?? undefined, top: card.top }}>
          {card.lines.map((line, i) => (
            <span key={i} className="activity-cross-card-line">
              {line}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

// The floating card's lines and place: the readout's text, its sub line
// when there is one, and the lane line, then the model's clamp against
// the strip's box with the tracks' bottom as the floor (M9 fix 262).
// Tracks shorter than the card give no card; the lane's words then go
// on the axis readout, when the readout has room for them and the lane
// has a session (`nothing here` adds nothing to the readout).
function floatingCard(cross: NonNullable<Props['cross']>, rows: ActivitySession[][], rowHeight: number, height: number, parentNames: ReadonlyMap<string, string | null>): { card: (CrossCardPlace & { lines: string[]; lane: string | null }) | null; readoutLane: string | null } {
  const i = trackAt(cross.y, rows.length, rowHeight);
  const lane = crossLane(i === null ? null : (rows[i] ?? null), cross.at, parentNames);
  const lines = [cross.text, ...(cross.sub === null || cross.sub === undefined ? [] : [cross.sub]), lane.text];
  const x = (cross.percent / 100) * cross.width;
  const place = crossCard(x, cross.y, { width: cross.width, height, floor: rows.length * rowHeight }, crossCardSize(lines));
  if (place === null) return { card: null, readoutLane: lane.sessionId !== null && readoutHasRoom(x, cross.width, cross.text, lane.text) ? lane.text : null };
  return { card: { ...place, lines, lane: lane.sessionId }, readoutLane: null };
}

// The hover words live in activity-titles.ts (M9 fix 251); the view
// still reads them from here.
export { OUTSIDE_WORD, outsideNote, spanTitle, debtTitle } from './activity-titles.ts';
