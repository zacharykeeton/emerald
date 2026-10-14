import type { ReactNode } from 'react';
import type { GitCommit, HistoryTranscript } from '../../preload/api.ts';
import { resumeTranscript } from './actions.ts';
import { historyCardModel, historyCommitsLine } from './lane-card-model.ts';
import { LayoutAction, LinesActions } from './LaneCard.tsx';
import type { CardLayout, CardLines } from './LaneCard.tsx';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { openTranscriptTab } from './ui.ts';

// The card on a history lane of the Commits graph (M70): the lane stands
// for a conversation found on this machine that emerald did not host (a
// click-through run in an external terminal, a session from a home whose
// records were cleared), so the card says which conversation, where it
// ran and when, and what of it is in the shown log. Same frame and
// manners as the lane card (M60). Resume starts the conversation again
// in a pane beside the focused one with `claude --resume`, after which
// the daemon's new record carries the transcript's id and the lane
// becomes that session's; Transcript opens the file read-only. A
// history block draws as one line unless Graph on this card opens it up
// (M71).

interface Props extends CardProps {
  transcript: HistoryTranscript;
  // The lane's commits in the shown log.
  mine: readonly GitCommit[];
  color: string | null;
  now: number;
  anchorId: string;
  layout?: CardLayout | null | undefined;
  lines?: CardLines | null | undefined;
}

export function HistoryCard({ transcript, mine, color, now, anchorId, layout, lines, anchor, onClose, onEnter, onLeave }: Props): ReactNode {
  const model = historyCardModel(transcript, mine, now);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  const resume = () => {
    onClose();
    void resumeTranscript(transcript.cwd, transcript.id, true).catch(warn('resume'));
  };
  const open = () => {
    onClose();
    openTranscriptTab(transcript.path, 'raw');
  };
  return (
    <PopoverCard id={anchorId} className="lane-popover history-popover" data={{ 'data-transcript-id': transcript.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="lane-card-heading">
        <span className="history-card-dot" style={color === null ? undefined : { background: color }} />
        <span className="lane-card-name">{model.title}</span>
      </div>
      <div className="history-card-kind">a Claude Code conversation emerald did not host</div>
      <div className="lane-card-where" data-kind="folder" title={transcript.cwd}>
        {model.folder}
      </div>
      {model.when !== null && <div className="history-card-when">{model.when}</div>}
      <div className="lane-card-commits">{historyCommitsLine(model)}</div>
      <div className="lane-card-actions">
        <button className="lane-card-action" data-action="resume" disabled={!model.actions.resume} title={model.actions.resume ? 'Start the conversation again in a pane beside the focused one; its commits then belong to that session' : `Its folder is gone: ${transcript.cwd}`} onClick={resume}>
          Resume in a new pane
        </button>
        <button className="lane-card-action" data-action="transcript" title="The transcript file, read-only in a tab" onClick={open}>
          Transcript
        </button>
        <LayoutAction layout={layout} onClose={onClose} />
        <LinesActions lines={lines} onClose={onClose} />
      </div>
    </PopoverCard>
  );
}
