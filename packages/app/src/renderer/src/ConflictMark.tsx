import type { SessionInfo } from '@emerald/shared';
import { conflictLines, conflictPeers, conflictWords } from './conflict-model.ts';
import { LaneCard } from './LaneCard.tsx';
import { PopoverAnchor } from './Popover.tsx';
import { useStore } from './store.ts';

// The forecast mark on the sidebar row's agent line (M9 fix 320,
// docs/design/conflict-forecast.md section 8): the tie's own chevrons,
// shrunk to a 13 by 9 box, then how many other lanes this session is
// tangled with, both in --error, after the load figure. A row in no
// pair draws nothing at all, and the mark rides the agent line, so a
// row showing its comment or a prompt box has none, as the load mark
// has none. The count is pairs, not files: a row is one session and
// its question is how many lanes it is tangled with; the card names
// them and their files. The tooltip is the card's own words, and a
// click opens the lane card the graph opens, anchored here, with no
// log beside it (its commits line is the graph's alone).

// The chevrons as an SVG rather than a character, so the row draws the
// same shape the graph does and never a font's idea of it.
export function ConflictChevrons({ className }: { className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 13 9" width="13" height="9" aria-hidden="true">
      <path d="M1 1l2.5 3.5L1 8M5 1l2.5 3.5L5 8M9 1l2.5 3.5L9 8" fill="none" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ConflictMark({ session, now }: { session: SessionInfo; now: number }) {
  const { conflicts, sessions } = useStore('conflicts', 'sessions');
  if (session.state === 'exited') return null;
  const lines = conflictLines(session.id, conflicts.conflicts, conflictPeers(sessions));
  if (lines.length === 0) return null;
  const id = `${session.id} conflicts`;
  return (
    <PopoverAnchor id={id} className="sidebar-row-conflict" title={lines.map(conflictWords).join('\n')} data={{ 'data-pairs': String(lines.length) }} card={(props) => <LaneCard session={session} shown={null} now={now} anchorId={id} {...props} />}>
      <ConflictChevrons className="sidebar-row-conflict-mark" />
      <span className="sidebar-row-conflict-count">{lines.length}</span>
    </PopoverAnchor>
  );
}
