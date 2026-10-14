import type { ReactNode } from 'react';
import type { GitCommit } from '../../preload/api.ts';
import type { CardBar } from './lane-card-model.ts';
import { fetchedLine, historyLine, outsideCardModel, outsideLine } from './lane-card-model.ts';
import { BarLines, LinesActions } from './LaneCard.tsx';
import type { CardLines } from './LaneCard.tsx';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';

// The card on the outside block of the Commits graph (M68): the block
// holds the commits no session here made, and since every dot is filled
// now nothing on the picture says why they are grey, so the card does.
// Same frame and manners as the lane card (M60): hover opens after the
// delay, a click pins, Escape or a press outside closes. No session
// actions, since there is no session to show or resume; the lines
// actions (M72) are the same as on every block's card, and so are the
// bar lines (M9 fix 152): a merge nobody here made of a branch some
// session did make ends its side lane under a bar at that commit's
// row, and the card says so. The text is lane-card-model.ts's.

interface Props extends CardProps {
  // The commits of the outside block in the shown log.
  outside: readonly GitCommit[];
  // How many commits of the log sit on history lanes instead (M70).
  history?: number | undefined;
  anchorId: string;
  lines?: CardLines | null | undefined;
  bars?: readonly CardBar[] | undefined;
  // The fetch line (M9 fix 286), while the remote branches are on the
  // graph: the mtime of FETCH_HEAD and the clock, or undefined when the
  // chip is off and the line is not shown.
  fetched?: { at: number | null; now: number } | undefined;
}

export function OutsideCard({ outside, history = 0, anchorId, lines, bars, fetched, anchor, onClose, onEnter, onLeave }: Props): ReactNode {
  const model = outsideCardModel(outside, history);
  return (
    <PopoverCard id={anchorId} className="lane-popover outside-popover" data={{ 'data-trailer': String(model.trailer), 'data-bare': String(model.bare), 'data-history': String(model.history) }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="lane-card-heading">
        <span className="outside-card-dot" />
        <span className="lane-card-name">outside emerald</span>
      </div>
      <div className="lane-card-commits">{outsideLine(model)}</div>
      {model.trailer > 0 && (
        <div className="outside-card-kind" data-kind="trailer">
          {model.trailer} with a Claude-Session trailer naming a conversation this daemon never held
          <div className="outside-card-note">another machine, a private daemon, or a record cleared</div>
        </div>
      )}
      {model.bare > 0 && (
        <div className="outside-card-kind" data-kind="bare">
          {model.bare} with no trailer
          <div className="outside-card-note">made by hand, or by something that is not Claude Code</div>
        </div>
      )}
      {model.history > 0 && (
        <div className="outside-card-kind" data-kind="history">
          {historyLine(model)}
          <div className="outside-card-note">conversations found on this machine that emerald did not host, each on a lane of its own</div>
        </div>
      )}
      {fetched !== undefined && (
        <div className="outside-card-fetched" data-fetched={fetched.at ?? 'never'}>
          {fetchedLine(fetched.at, fetched.now)}
        </div>
      )}
      <BarLines bars={bars} />
      <div className="lane-card-actions">
        <LinesActions lines={lines} onClose={onClose} />
      </div>
    </PopoverCard>
  );
}
