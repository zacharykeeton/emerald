import type { ReactNode } from 'react';
import type { GitCommit } from '../../preload/api.ts';
import type { CardBar } from './lane-card-model.ts';
import { personCardModel, personLine } from './lane-card-model.ts';
import { BarLines, LayoutAction, LinesActions } from './LaneCard.tsx';
import type { CardLayout, CardLines } from './LaneCard.tsx';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';

// The card on a person's block of the Commits graph (M9 fix 286): the
// block holds the commits another author made on this repository, so
// the card says who and how many, and how many of those carry a
// Claude-Session trailer, which is their agent's work and theirs. Same
// frame and manners as the lane card (M60); no session actions, since
// nobody here can show or resume a person; the layout and lines actions
// are every block's.

interface Props extends CardProps {
  name: string;
  // The block's commits in the shown log.
  mine: readonly GitCommit[];
  color: string | null;
  anchorId: string;
  layout?: CardLayout | null | undefined;
  lines?: CardLines | null | undefined;
  bars?: readonly CardBar[] | undefined;
}

export function PersonCard({ name, mine, color, anchorId, layout, lines, bars, anchor, onClose, onEnter, onLeave }: Props): ReactNode {
  const model = personCardModel(name, mine);
  return (
    <PopoverCard id={anchorId} className="lane-popover person-popover" data={{ 'data-person': name, 'data-trailer': String(model.trailer) }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="lane-card-heading">
        <span className="history-card-dot" style={color === null ? undefined : { background: color }} />
        <span className="lane-card-name">{name}</span>
      </div>
      <div className="history-card-kind">a person on this repository, by the commits' author</div>
      <div className="lane-card-commits">{personLine(model)}</div>
      <BarLines bars={bars} />
      <div className="lane-card-actions">
        <LayoutAction layout={layout} onClose={onClose} />
        <LinesActions lines={lines} onClose={onClose} />
      </div>
    </PopoverCard>
  );
}
