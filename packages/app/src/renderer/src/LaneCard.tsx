import type { ReactNode } from 'react';
import { formatSpanLength, markKind, paneShowingIn, workingMotion } from '@emerald/shared';
import type { GitCommit } from '../../preload/api.ts';
import { resumeSessionBeside, resumeTranscript, showSession, showSessionAuto } from './actions.ts';
import { useSessionDebt } from './activity-data.ts';
import { barLines, commitsLine, laneCardModel } from './lane-card-model.ts';
import type { CardBar, LaneCardAgent, LaneCardSession } from './lane-card-model.ts';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { colorSwatches } from './session-color.ts';
import { SessionMark } from './session-mark.tsx';
import { getState, useStore } from './store.ts';
import { conflictPeers } from './conflict-model.ts';
import { Swatches } from './Swatches.tsx';
import { revealConversation } from './ui.ts';

// The card on a session's lane in the Commits tab (M60): a hover on a
// lane, a pill on the graph or a row's owner dot used to give the
// session's name in a tooltip and nothing else. The card, on
// Popover.tsx's manners (hover opens after the delay, a click pins,
// Escape or a press outside closes), says who the session is, its
// state, where it worked and what of its own is in the shown log, and
// then the ways to it: Show for a live session, Resume in a new pane
// for an exited or removed one, Transcript for the conversation in the
// rail's Sessions tab. The text is lane-card-model.ts's.
// The mark is the sidebar row's (`markKind`, M9 fix 112): a shell that
// ran claude is a Claude session there, so it is one here. Graph or
// Line (M71) folds the block to one straight line or opens it up to its
// little graph, whatever the switch says for the rest. The Colour row
// (M9 fix 134) is the row menu's and the pane menu's, so a colour that
// reads wrong on the graph is changed where it is seen; a removed
// session has none, since session.set on it answers not-found. The
// bars on the block's lanes (M9 fix 152) get a line each under the
// commits line, since a bar has no words on the picture and hovering
// one opens this card. The two debt lines (M9 fix 231) are the
// session's attention debt today, the time it spent waiting on the
// person: the total in the waiting tone, and under it the asked share
// with the count of waits. The card is a reading, so this is the one
// place a zero prints (`waiting on you 0m`, muted); the split line
// goes when there is nothing to split. Read once as the card opens.

// The block's layout and the way to the other one, for the toggle on a
// card (M71); the history and outside cards take the same.
export interface CardLayout {
  current: 'graph' | 'line';
  toggle: () => void;
}

// The way to one block's lines (M72): whether they draw, Show only this,
// and the hide or show toggle. The rows never change under either.
export interface CardLines {
  drawn: boolean;
  solo: () => void;
  toggle: () => void;
}

interface Props extends CardProps {
  session: LaneCardSession;
  // The shown log, for the session's own commits in it; null from an
  // anchor with no log beside it (the sidebar row's conflict mark, M9
  // fix 320), when the commits lines are left off.
  shown: readonly GitCommit[] | null;
  now: number;
  // The anchor's id, for the outside-press check.
  anchorId: string;
  // M61: a subagent's lane opens the parent's card with the agent named.
  agent?: LaneCardAgent | null | undefined;
  layout?: CardLayout | null | undefined;
  lines?: CardLines | null | undefined;
  // The bars on the block's lanes (M9 fix 152), newest row first.
  bars?: readonly CardBar[] | undefined;
}

// The bar lines (M9 fix 152), on every block's card that has a bar. The
// two fork lines (M9 fix 399) draw landings first, then endings, each
// its own line when both kinds of fork bar are on the block.
export function BarLines({ bars }: { bars: readonly CardBar[] | undefined }): ReactNode {
  const lines = barLines(bars ?? []);
  return (
    <>
      {lines.start !== null && (
        <div className="lane-card-bars" data-kind="start">
          {lines.start}
        </div>
      )}
      {lines.landing !== null && (
        <div className="lane-card-bars" data-kind="fork">
          {lines.landing}
        </div>
      )}
      {lines.ending !== null && (
        <div className="lane-card-bars" data-kind="fork">
          {lines.ending}
        </div>
      )}
    </>
  );
}

// Show only this and Hide its lines (M72), on every block's card: the
// first draws this block's lanes alone, the second takes them away or
// brings them back; the rows stay whole either way.
export function LinesActions({ lines, onClose }: { lines: CardLines | null | undefined; onClose: () => void }): ReactNode {
  if (lines === null || lines === undefined) return null;
  return (
    <>
      <button
        className="lane-card-action"
        data-action="solo"
        title="Lanes for this block alone; the rows stay whole, and the header's chip brings every block back"
        onClick={() => {
          onClose();
          lines.solo();
        }}
      >
        Show only this
      </button>
      <button
        className="lane-card-action"
        data-action="lines"
        data-drawn={lines.drawn ? '' : undefined}
        title={lines.drawn ? 'No lanes for this block; its rows stay, and a click on one of their hashes brings the lanes back' : 'Lanes for this block again'}
        onClick={() => {
          onClose();
          lines.toggle();
        }}
      >
        {lines.drawn ? 'Hide its lines' : 'Show its lines'}
      </button>
    </>
  );
}

// The Graph or Line button (M71): named after what a click gives.
export function LayoutAction({ layout, onClose }: { layout: CardLayout | null | undefined; onClose: () => void }): ReactNode {
  if (layout === null || layout === undefined) return null;
  const toGraph = layout.current === 'line';
  return (
    <button
      className="lane-card-action"
      data-action="layout"
      data-current={layout.current}
      title={toGraph ? 'Open this block up to its own graph, a lane per branch inside it' : 'Fold this block to one straight line'}
      onClick={() => {
        onClose();
        layout.toggle();
      }}
    >
      {toGraph ? 'Graph' : 'Line'}
    </button>
  );
}

export function LaneCard({ session, shown, now, anchorId, agent, layout, lines, bars, anchor, onClose, onEnter, onLeave }: Props): ReactNode {
  // The forecast (M9 fix 320) off the store, so the graph's card and
  // the row's read one report.
  const { conflicts, sessions } = useStore('conflicts', 'sessions');
  const model = laneCardModel(session, shown ?? [], now, { report: conflicts, peers: conflictPeers(sessions) });
  const debt = useSessionDebt(session.id);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  // On a pane already: focus it there; else place it the way a
  // notification click does. The button's label follows the same read
  // (M9 fix 306), since under two buttons about the drawing a bare
  // `Show` read as a third.
  const onPane = (): boolean => {
    const layout = getState().layout;
    return layout !== null && paneShowingIn(layout, session.id) !== null;
  };
  const show = () => {
    onClose();
    void (onPane() ? showSession(session.id) : showSessionAuto(session.id)).catch(warn('show'));
  };
  const resume = () => {
    onClose();
    const removed = session.removedAt !== undefined && session.removedAt !== null;
    if (removed && session.conversation !== null) void resumeTranscript(session.conversation.cwd, session.conversation.id, true).catch(warn('resume'));
    else void resumeSessionBeside(session.id).catch(warn('resume'));
  };
  const transcript = () => {
    onClose();
    if (model.conversationId !== null) revealConversation(model.conversationId);
  };
  return (
    <PopoverCard id={anchorId} className="lane-popover" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      {agent !== null && agent !== undefined && <div className="lane-card-agent">agent: {agent.label}</div>}
      <div className="lane-card-heading">
        <SessionMark kind={markKind(session)} tone={model.state.tone} working={workingMotion(session) !== null} size="unit" />
        <span className="lane-card-name">{model.name}</span>
        <span className={model.state.tone === undefined ? 'lane-card-state' : `lane-card-state state-${model.state.tone}`} data-tone={model.state.tone}>
          {model.state.text}
        </span>
      </div>
      {model.where !== null && (
        <div className="lane-card-where" data-kind={model.where.kind}>
          {model.where.kind === 'branch' ? '⑂ ' : ''}
          {model.where.text}
        </div>
      )}
      {shown !== null && <div className="lane-card-commits">{commitsLine(model)}</div>}
      {shown !== null && model.newest !== null && (
        <div className="lane-card-newest" title={model.newest.hash}>
          <span className="lane-card-hash">{model.newest.hash.slice(0, 7)}</span> {model.newest.subject}
        </div>
      )}
      {/* One line per other lane (M9 fix 320, docs/design/conflict-forecast.md section 9): the word in the tone, the other lane's name in its own session colour, the files in --fg; nothing at all with no pairs. Then the base line, muted until forty behind and in the tone past it. Both wrap rather than ellipsise, since a reading cut in the middle is not a reading. */}
      {model.conflicts.map((line) => (
        <div key={line.other} className="lane-card-conflict" data-other={line.other} data-files={line.all.length}>
          <span className="lane-card-conflict-word">conflicts</span> with{' '}
          <span className="lane-card-conflict-other" style={line.color === null ? undefined : { color: line.color }}>
            {line.name}
          </span>{' '}
          on <span className="lane-card-conflict-files">{line.files}</span>
        </div>
      ))}
      {model.base !== null && (
        <div className="lane-card-base" data-stale={model.base.stale ? '' : undefined} data-behind={model.base.behind}>
          {model.base.text}
        </div>
      )}
      {debt !== null && (
        <div className="lane-card-debt" data-debt-ms={debt.debtMs} data-asked-ms={debt.askedMs} data-waits={debt.waits}>
          <div className="lane-card-debt-total" data-zero={debt.debtMs === 0 ? '' : undefined}>
            waiting on you {formatSpanLength(debt.debtMs)}
          </div>
          {debt.debtMs > 0 && (
            <div className="lane-card-debt-split">
              · of it asked {formatSpanLength(debt.askedMs)} · {debt.waits} {debt.waits === 1 ? 'wait' : 'waits'}
            </div>
          )}
        </div>
      )}
      <BarLines bars={bars} />
      {model.actions.color && (
        <div className="lane-card-colour">
          <Swatches item={colorSwatches(session, onClose)} />
        </div>
      )}
      <div className="lane-card-actions">
        {model.actions.show && (
          <button className="lane-card-action" data-action="show" title="Focus the pane showing this session, or put it on one" onClick={show}>
            {onPane() ? 'Focus its pane' : 'Show in a pane'}
          </button>
        )}
        {model.actions.resume && (
          <button className="lane-card-action" data-action="resume" title="Start the session again in a pane beside the focused one" onClick={resume}>
            Resume in a new pane
          </button>
        )}
        {model.actions.transcript && (
          <button className="lane-card-action" data-action="transcript" title="The conversation in the Sessions tab, unfolded" onClick={transcript}>
            Transcript
          </button>
        )}
        <LayoutAction layout={layout} onClose={onClose} />
        <LinesActions lines={lines} onClose={onClose} />
      </div>
    </PopoverCard>
  );
}
