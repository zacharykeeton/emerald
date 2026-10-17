import { useEffect, useRef, useState } from 'react';
import type { SessionInfo, TrustDialog } from '@emerald/shared';
import { trustDialog, trustKeys } from '@emerald/shared';
import { ackIfDone, typeInto } from './actions.ts';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { askHeading } from './chat-model.ts';
import { acknowledgeAttention } from './ui.ts';

// M9 fix 808: Claude Code's folder trust dialog as a card, in the chat view
// and under the sidebar's badge. Its options carry no digits, so an answer
// is the arrow keys from the pointer's row to the picked one and Enter
// (trustKeys). Kept apart from AskCard and AnswerPopover, whose digit keys
// and free-answer box mean nothing here.

interface TrustScreen {
  rows: string[];
  sentAt: number;
}

const OPTION_TITLE = 'Sends the arrow keys and Enter to the session';

function useTrustSend(session: SessionInfo, screen: TrustScreen | null) {
  const dialog: TrustDialog | null = screen === null ? null : trustDialog(screen.rows);
  // One press per screen read: a second click before the dialog is read
  // again would send its arrows from a pointer that has already moved.
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  const waiting = pressedAt !== null && (screen === null || screen.sentAt <= pressedAt);
  const press = (pick: 'yes' | 'no') => {
    if (dialog === null || waiting) return;
    const keys = trustKeys(dialog, pick);
    if (keys === null) return;
    setPressedAt(Date.now());
    typeInto(session.id, keys);
    // An answer is a look at the row, as a click in the pane would be.
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
  };
  const disabled = (pick: 'yes' | 'no') => dialog === null || waiting || trustKeys(dialog, pick) === null;
  return { dialog, press, disabled };
}

export function TrustCard({ session, screen, rootRef }: { session: SessionInfo; screen: TrustScreen | null; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const { dialog, press, disabled } = useTrustSend(session, screen);
  return (
    <div
      className="chat-step chat-ask-step"
      data-kind="trust"
      ref={rootRef}
      tabIndex={-1}
      // An Escape here would exit Claude Code, and the view's own Escape
      // would send it; No, exit is that answer in words.
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        ev.stopPropagation();
      }}
    >
      <span className="chat-dot" data-tone="blocked" />
      <div className="chat-ask">
        <div className="chat-ask-heading">{askHeading('trust')}</div>
        <pre className="chat-ask-screen" data-rows={dialog?.lines.length ?? 0}>
          {screen === null ? 'Reading the screen…' : dialog === null ? '(the dialog is not drawn yet)' : dialog.lines.join('\n')}
        </pre>
        <div className="chat-ask-options">
          {(dialog?.options ?? []).map((o) => (
            <button key={o.pick} type="button" className="chat-ask-option" data-pick={o.pick} data-pointer={o.pointer ? 'true' : undefined} title={OPTION_TITLE} disabled={disabled(o.pick)} onClick={() => press(o.pick)}>
              <span className="chat-ask-text">
                <span className="chat-ask-label">{o.label}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// How often the sidebar card reads the screen while it is open, as the
// answer card does.
const REFRESH_MS = 1000;

export function TrustPopover({ session, anchor, onClose, onEnter, onLeave }: CardProps & { session: SessionInfo }) {
  const [screen, setScreen] = useState<TrustScreen | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      const sentAt = Date.now();
      window.emerald
        .request('pty.screen', { sessionId: session.id })
        .then((res) => {
          if (live) setScreen({ rows: res.rows, sentAt });
        })
        .catch((err: unknown) => console.warn('[emerald] screen read failed', err));
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session.id]);
  // Answered from here or from the pane: nothing left to ask.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (session.state !== 'needs-input') onCloseRef.current();
  }, [session.state]);
  const { dialog, press, disabled } = useTrustSend(session, screen);
  return (
    <PopoverCard id={`answer:${session.id}`} className="answer-popover answer-popover-trust" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="answer-popover-heading">{askHeading('trust')}</div>
      <pre className="answer-popover-screen" data-rows={dialog?.lines.length ?? 0}>
        {screen === null ? 'Reading the screen…' : dialog === null ? '(the dialog is not drawn yet)' : dialog.lines.join('\n')}
      </pre>
      <div className="answer-popover-options">
        {(dialog?.options ?? []).map((o) => (
          <button key={o.pick} type="button" className="answer-popover-option" data-pick={o.pick} data-pointer={o.pointer ? 'true' : undefined} title={OPTION_TITLE} disabled={disabled(o.pick)} onClick={() => press(o.pick)}>
            <span className="answer-popover-text">
              <span className="answer-popover-label">{o.label}</span>
            </span>
          </button>
        ))}
      </div>
    </PopoverCard>
  );
}
