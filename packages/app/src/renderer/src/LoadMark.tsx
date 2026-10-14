import { LOAD_SPAN_MS, hasLoad, loadFigure, loadInk, loadPeak, loadWindow, memText, sparkPath } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';

// The per-session load mark on the sidebar row's agent line (M9 fix
// 302, docs/design/per-agent-load.md section 8): the last five minutes
// of the session's process tree's cpu as a one-pixel unfilled polyline
// on a scale every row shares, then the current figure. Amber, line and
// figure both, from 200% of one core, and nothing else on the row moves
// with it. Under three samples in the span there is no load at all: a
// dash where the line would be and no figure element, never a zero
// line, since idle and unmeasured are not the same claim. The card,
// anchored on the line, carries what the surface does not: memory, the
// peak and the tree's process names.

// The box the points are computed in; the CSS widens it to 56 in a wide
// sidebar and the viewBox stretches the line with it, the stroke staying
// a pixel.
export const SPARK_WIDTH = 44;
export const SPARK_HEIGHT = 11;

export function LoadMark({ session, now, ceiling }: { session: SessionInfo; now: number; ceiling: number }) {
  // A dead tree has no load to be unmeasured: not a dash, nothing at all
  // (M9 fix 314). The daemon keeps the samples, so a card stays possible
  // later; only the row's mark goes.
  if (session.state === 'exited') return null;
  const samples = session.load ?? null;
  // The count in the span rides on the mark for the verify script, which
  // reads the dash and the count in one go.
  const inSpan = loadWindow(samples, now);
  // The muted word before the spark (M9 fix 315): it says what the line
  // is a measure of, on every row including the dash's, so "cpu —" reads
  // as not measured rather than as a blank.
  const word = <span className="sidebar-row-load-word">cpu</span>;
  if (!hasLoad(samples, now)) {
    return (
      <>
        {word}
        <span className="sidebar-row-load-spark" data-load="none" data-samples={inSpan.length} aria-label="cpu, no load samples yet">
          —
        </span>
      </>
    );
  }
  const latest = inSpan[inSpan.length - 1]!;
  const ink = loadInk(latest.cpu);
  const peak = loadPeak(samples, LOAD_SPAN_MS, now);
  // Above the shared ceiling the line clips at a dashed rule and the
  // spark carries the peak for the card and the script; the row has no
  // room to print it beside an 11px line.
  const clipped = peak > ceiling;
  return (
    <>
      {word}
      <PopoverAnchor
        id={`${session.id} load`}
        className="sidebar-row-load-spark"
        data={{
          'data-load': 'line',
          'data-samples': String(inSpan.length),
          'data-ink': ink,
          'data-ceiling': String(ceiling),
          'data-peak': loadFigure(peak),
          'data-clipped': clipped ? 'true' : undefined,
          // Fix 328: the dash form says "cpu, no load samples yet" on
          // its aria-label; the line form carried none, its svg
          // aria-hidden, so a screen reader skipped it whole.
          'aria-label': `cpu ${loadFigure(latest.cpu)} of one core, peak ${loadFigure(peak)} over 5 min`,
        }}
        card={(props) => <LoadPopover session={session} now={now} {...props} />}
      >
        <svg viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="sidebar-row-load-base" x1={0} y1={SPARK_HEIGHT - 0.5} x2={SPARK_WIDTH} y2={SPARK_HEIGHT - 0.5} />
          {clipped && <line className="sidebar-row-load-clip" x1={0} y1={0.5} x2={SPARK_WIDTH} y2={0.5} />}
          <polyline className="sidebar-row-load-line" points={sparkPath(samples, { width: SPARK_WIDTH, height: SPARK_HEIGHT, ceiling, now })} />
        </svg>
      </PopoverAnchor>
      <span className="sidebar-row-load-figure" data-ink={ink}>
        {loadFigure(latest.cpu)}
      </span>
    </>
  );
}

// The card: the cpu figure and what it is a percent of, the memory, the
// peak over the span, a rule, then the tree's process names, at most
// four. Placed and closed as the context popover is.
function LoadPopover({ session, now, anchor, onClose, onEnter, onLeave }: CardProps & { session: SessionInfo; now: number }) {
  const inSpan = loadWindow(session.load, now);
  const latest = inSpan[inSpan.length - 1] ?? null;
  const peak = loadPeak(session.load, LOAD_SPAN_MS, now);
  const names = (session.loadNames ?? []).slice(0, 4);
  return (
    <PopoverCard id={`${session.id} load`} className="load-popover" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      {latest !== null && (
        <>
          <div className="load-popover-cpu" data-ink={loadInk(latest.cpu)}>
            <span className="load-popover-word">cpu</span> <span className="load-popover-figure">{loadFigure(latest.cpu)}</span> of one core
          </div>
          <div className="load-popover-mem">
            <span className="load-popover-word">memory</span> {memText(latest.rss)}
          </div>
        </>
      )}
      <div className="load-popover-peak">
        peak {loadFigure(peak)} <span className="load-popover-word">cpu</span> · 5 min
      </div>
      {names.length > 0 && (
        <>
          <div className="load-popover-rule" />
          <div className="load-popover-names">
            {names.map((name) => (
              <div key={name} className="load-popover-name">
                {name}
              </div>
            ))}
          </div>
        </>
      )}
    </PopoverCard>
  );
}
