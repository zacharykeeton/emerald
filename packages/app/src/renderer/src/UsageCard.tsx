import type { CSSProperties } from 'react';
import type { UsageWindow } from '../../preload/api.ts';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { CARD_BAR_PX, HIGH_PERCENT, breakFor, breakText, dialStyle, paceBar, resetWhen, runwayText, windowName } from './usage-model.ts';
import type { PaceBar } from './usage-model.ts';

// M73 task 2: the usage card. Each window's segment on the strip carried
// a tooltip with the window's name, the percent and the reset time twice
// over; a hover on a segment opens this card instead, on the popover the
// roster and the context dial open (fix 67 and 89): one row per window,
// the hovered one marked, with its name and percent, its pace bar (M9
// fix 308, docs/design/pace-bars.md: the window's whole span filled with
// the percent, ticked at its unit, and crossed by a mark at the elapsed
// share, the hovered row's labelled `now`), the clock time of the reset
// with the countdown, and at the right of that line where the average
// pace lands (M9 fix 295) when there is enough of the window to say;
// then a line saying where the numbers come from and when they were last
// asked for, and (M9 fix 163) a line saying the reading is stale, what
// the last ask met and when the next goes, while the strip keeps a
// reading through an unavailable answer. A window of unknown length has
// no span to draw, so its row keeps the dial the card had before the bar.

interface AnchorProps {
  windows: readonly UsageWindow[];
  current: UsageWindow;
  now: number;
  fetchedAt: number | null;
  stale: string | null;
  className: string;
  children: React.ReactNode;
}

export function UsageWindowAnchor({ windows, current, now, fetchedAt, stale, className, children }: AnchorProps) {
  return (
    <PopoverAnchor id={`usage ${current.key}`} className={className} data={{ 'data-key': current.key }} card={(props) => <UsageCard windows={windows} current={current.key} now={now} fetchedAt={fetchedAt} stale={stale} {...props} />}>
      {children}
    </PopoverAnchor>
  );
}

// The bar itself, on the strip (44 by 6 px, or wider in the column form
// since M9 fix 440), on the card (the row's width by 10 px) and under
// the activity view's five-hour axis (M9 fix 321, the axis's width by 6
// px): the fill, the ticks drawn over it in the background
// colour, and the mark a pixel taller than the bar at each end so it is
// told from a tick; M9 fix 347: a second mark in the error colour where
// the pace hits 100, when that lands before the reset, in every form.
// The model gives every number; the tick step goes to the CSS as
// --tick, a percentage of the bar. `tall` is the strip's column form
// past STRIP_BAR_TALL_PX (UsageStrip.tsx), where the grown bar goes 8px
// tall (style.css); every other caller leaves it unset.
export function UsageBar({ bar, form, tall }: { bar: PaceBar; form: 'strip' | 'card' | 'axis'; tall?: boolean }) {
  const style = bar.tick === null ? undefined : ({ '--tick': `${(bar.tick * 100).toFixed(4)}%` } as CSSProperties);
  return (
    <span className="usage-bar" data-form={form} data-tone={bar.tone} data-ticks={bar.ticks} data-tall={tall || undefined} style={style}>
      <span className="usage-bar-fill" style={{ width: `${(bar.fill * 100).toFixed(2)}%` }} />
      {bar.tick !== null && <span className="usage-bar-ticks" />}
      <span className="usage-bar-mark" style={{ left: `${(bar.mark * 100).toFixed(2)}%` }} />
      {bar.ceiling !== null && <span className="usage-bar-ceiling" style={{ left: `${(bar.ceiling * 100).toFixed(2)}%` }} />}
    </span>
  );
}

export function UsageCard({ windows, current, now, fetchedAt, stale, anchor, onClose, onEnter, onLeave }: CardProps & { windows: readonly UsageWindow[]; current: string; now: number; fetchedAt: number | null; stale: string | null }) {
  return (
    <PopoverCard id={`usage ${current}`} className="usage-popover" data={{ 'data-key': current, ...(stale === null ? {} : { 'data-stale': '' }) }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="usage-card-heading">Claude usage</div>
      {windows.map((w) => {
        const bar = paceBar(w, now, CARD_BAR_PX);
        return (
          <div key={w.key} className="usage-card-row" data-key={w.key} data-current={w.key === current || undefined}>
            <div className="usage-card-line">
              <span className="usage-card-name">{windowName(w)}</span>
              {bar === null && <span className="usage-meter" style={dialStyle(w.percent)} data-high={w.percent >= HIGH_PERCENT || undefined} />}
              <span className="usage-card-percent">{w.percent}% used</span>
            </div>
            {bar !== null && w.key === current && (
              // The label sits over the mark, kept inside the bar's ends.
              <div className="usage-bar-nowline">
                <span className="usage-bar-now" style={{ left: `clamp(10px, ${(bar.mark * 100).toFixed(2)}%, calc(100% - 10px))` }}>
                  now
                </span>
              </div>
            )}
            {bar !== null && <UsageBar bar={bar} form="card" />}
            <div className="usage-card-line">
              <span className="usage-card-when">{resetWhen(w, now)}</span>
              {bar !== null && bar.runway !== null && (
                <span className="usage-card-pace" data-short={bar.runway.short || undefined}>
                  {runwayText(bar.runway, now)}
                </span>
              )}
            </div>
            {bar !== null &&
              (() => {
                const pause = breakFor(w, now);
                return pause === null ? null : <div className="usage-card-advice">{breakText(pause)}</div>;
              })()}
          </div>
        );
      })}
      <div className="usage-card-note">
        {`From the usage endpoint Claude Code's /usage reads, with the token in ~/.claude/.credentials.json; ${fetchedAt === null ? 'not asked yet' : `asked at ${new Date(fetchedAt).toLocaleTimeString()}`}, again every five minutes and on the button.`}
      </div>
      {stale !== null && <div className="usage-card-note usage-card-stale">{stale}</div>}
    </PopoverCard>
  );
}
