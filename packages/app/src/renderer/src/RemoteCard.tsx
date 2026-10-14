import type { ReactNode } from 'react';
import type { GitCommit } from '../../preload/api.ts';
import type { CardBar } from './lane-card-model.ts';
import { remoteCardModel, remoteLine } from './lane-card-model.ts';
import { BarLines, LayoutAction, LinesActions } from './LaneCard.tsx';
import type { CardLayout, CardLines } from './LaneCard.tsx';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';

// The card on a remote block of the Commits graph (M9 fix 286): the
// block holds the own author's commits on a branch that lives only on
// the remote (the remotes chip on), so the card names the branch, the
// count, and how old the remote refs are, since emerald never fetches.
// Grey like the outside block, the same frame and manners as the lane
// card (M60), no session actions.

interface Props extends CardProps {
  branch: string;
  // The block's commits in the shown log.
  mine: readonly GitCommit[];
  fetchedAt: number | null;
  now: number;
  anchorId: string;
  layout?: CardLayout | null | undefined;
  lines?: CardLines | null | undefined;
  bars?: readonly CardBar[] | undefined;
}

export function RemoteCard({ branch, mine, fetchedAt, now, anchorId, layout, lines, bars, anchor, onClose, onEnter, onLeave }: Props): ReactNode {
  const model = remoteCardModel(branch, mine, fetchedAt, now);
  return (
    <PopoverCard id={anchorId} className="lane-popover remote-popover" data={{ 'data-remote': branch }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="lane-card-heading">
        <span className="outside-card-dot" />
        <span className="lane-card-name">{branch}</span>
      </div>
      <div className="history-card-kind">a branch only on the remote, no local branch holds these</div>
      <div className="lane-card-commits">{remoteLine(model)}</div>
      <div className="outside-card-fetched" data-fetched={fetchedAt ?? 'never'}>
        {model.fetched}
      </div>
      <BarLines bars={bars} />
      <div className="lane-card-actions">
        <LayoutAction layout={layout} onClose={onClose} />
        <LinesActions lines={lines} onClose={onClose} />
      </div>
    </PopoverCard>
  );
}
