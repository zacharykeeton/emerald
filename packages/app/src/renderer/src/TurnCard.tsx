import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { describeState, hasState, waitingOnText } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { PopoverCard, usePopoverAnchor } from './Popover.tsx';

// M73: the turn card. The sidebar row's prompt line, its turn line and
// its comment line used to carry the whole turn as a title tooltip
// (`You: ... / Claude: ...`, the checkpoint and the phase folded in front
// of it, or the terminal title while the turn ran); a tooltip that
// carries that much is a card now, on the popover the roster and the
// context dial open (fix 67 and 89): the checkpoint and the phase above
// when set, then the prompt and the reply as two labelled blocks with
// the time each landed at the right, and the terminal title as a last
// line while it says something. The reply block shows what the row's
// agent line would: what is waited on at needs-input, Claude's latest
// text or tool call while the turn runs, marked as so far, else the
// last reply.

// The three lines share one card per row, so the anchor id carries the
// line's name: a press on the turn line must not read as a press outside
// the card the prompt line opened.
export type TurnLine = 'prompt' | 'turn' | 'comment' | 'state';

interface LineProps {
  session: SessionInfo;
  line: TurnLine;
  className: string;
  children: ReactNode;
}

// A row line that opens the turn card: hover after the delay, a click
// pins it. The click is not stopped, since a click anywhere on the row
// shows the session and the line is most of the row's width; the row's
// own mousedown keeps the terminal's focus.
export function TurnLineAnchor({ session, line, className, children }: LineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const state = usePopoverAnchor();
  const id = `${session.id} ${line}`;
  // An anchor of its own inside the line (M9 fix 302: the load sparkline
  // on the agent line) takes the hover while the pointer is over it, so
  // one card opens at a time: over the nested anchor the line reads as
  // left, back on the line's own text as entered again. mouseover
  // bubbles where mouseenter does not, which is what tells the two apart.
  const onOver = (ev: ReactMouseEvent<HTMLDivElement>) => {
    const nested = (ev.target as Element).closest('[data-popover-for]') !== ev.currentTarget;
    if (nested) state.handlers.onMouseLeave();
    else state.handlers.onMouseEnter();
  };
  return (
    <>
      <div ref={ref} className={className} data-popover-for={id} data-popover-open={state.open} data-turn-line={line} onClick={() => state.pin()} onMouseEnter={state.handlers.onMouseEnter} onMouseOver={onOver} onMouseLeave={state.handlers.onMouseLeave}>
        {children}
      </div>
      {state.card(ref.current, (props) => (
        <PopoverCard id={id} className="turn-popover" data={{ 'data-session-id': session.id }} {...props}>
          <TurnCardBody session={session} />
        </PopoverCard>
      ))}
    </>
  );
}

// The pane title's state word (M73 task 4): the same card off a span,
// with the state's own sentence as its first line, which the word's
// tooltip used to carry beside the terminal title. A click pins; the
// title's own press goes on to focus the pane.
export function TurnStateAnchor({ session, className, data, children }: { session: SessionInfo; className: string; data?: Record<string, string | undefined> | undefined; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = usePopoverAnchor();
  const id = `${session.id} state`;
  return (
    <>
      <span ref={ref} className={className} {...data} data-popover-for={id} data-popover-open={state.open} data-turn-line="state" onClick={() => state.pin()} onMouseEnter={state.handlers.onMouseEnter} onMouseLeave={state.handlers.onMouseLeave}>
        {children}
      </span>
      {state.card(ref.current, (props) => (
        <PopoverCard id={id} className="turn-popover" data={{ 'data-session-id': session.id }} {...props}>
          <TurnCardBody session={session} />
        </PopoverCard>
      ))}
    </>
  );
}

// What the reply block says while the turn is not over: the same rule as
// the agent line (agentLineText), named so the card can mark it as not
// the reply yet.
function liveText(session: SessionInfo): { text: string; kind: 'asked' | 'so far' } | null {
  const asked = waitingOnText(session);
  if (asked !== null) return { text: asked, kind: 'asked' };
  if (session.state !== 'working') return null;
  const text = session.liveReply ?? session.liveTool;
  return text === null ? null : { text, kind: 'so far' };
}

function clock(at: number | null | undefined): string | null {
  return typeof at === 'number' && at > 0 ? new Date(at).toLocaleTimeString() : null;
}

export function TurnCardBody({ session }: { session: SessionInfo }) {
  const live = liveText(session);
  // The terminal title as written, glyph and all, while the turn runs:
  // what the old tooltip said, since the title is Claude's own word on
  // what it is doing and the agent line shows only its text.
  const title = session.state === 'working' ? session.title : null;
  // The state's own sentence, when the word does not say it all.
  const label = hasState(session) ? describeState(session) : null;
  return (
    <>
      {label !== null && (
        <div className="turn-card-note" data-part="state">
          <span className="turn-card-label">{label.text}</span>
          {label.detail !== null && <span className="turn-card-text">{label.detail}</span>}
        </div>
      )}
      {session.comment !== null && (
        <div className="turn-card-note" data-part="checkpoint">
          <span className="turn-card-label">Checkpoint</span>
          <span className="turn-card-text">{session.comment}</span>
        </div>
      )}
      {session.phase !== null && (
        <div className="turn-card-note" data-part="phase">
          <span className="turn-card-label">Phase</span>
          <span className="turn-card-text">{session.phase}</span>
        </div>
      )}
      {session.lastPrompt !== null && (
        <div className="turn-card-block" data-part="prompt">
          <div className="turn-card-head">
            <span className="turn-card-label">You</span>
            {clock(session.lastPromptAt) !== null && <span className="turn-card-time">{clock(session.lastPromptAt)}</span>}
          </div>
          <div className="turn-card-text">{session.lastPrompt}</div>
        </div>
      )}
      {live !== null ? (
        <div className="turn-card-block" data-part="reply" data-live={live.kind}>
          <div className="turn-card-head">
            <span className="turn-card-label">{live.kind === 'asked' ? 'Claude asks' : 'Claude, so far'}</span>
          </div>
          <div className="turn-card-text">{live.text}</div>
        </div>
      ) : (
        session.lastReply !== null && (
          <div className="turn-card-block" data-part="reply">
            <div className="turn-card-head">
              <span className="turn-card-label">Claude</span>
              {clock(session.lastReplyAt) !== null && <span className="turn-card-time">{clock(session.lastReplyAt)}</span>}
            </div>
            <div className="turn-card-text">{session.lastReply}</div>
          </div>
        )
      )}
      {title !== null && (
        <div className="turn-card-note" data-part="title">
          <span className="turn-card-label">Terminal title</span>
          <span className="turn-card-text">{title}</span>
        </div>
      )}
    </>
  );
}
