import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionInfo } from '@emerald/shared';
import { ackIfDone, typeInto } from './actions.ts';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { answerOptions, askQuestion, promptExcerpt } from './screen-prompt-model.ts';
import type { AnswerOption, AskOption } from './screen-prompt-model.ts';
import { askHeading } from './chat-model.ts';
import { acknowledgeAttention } from './ui.ts';

// M55: the badge of a needs-input row opens a card with what the session
// is asking, read off its screen, and the answers as buttons, so a person
// answers without focusing the pane. A click opens it (no hover: the
// badge is small and the card acts, so nothing should open by accident);
// the screen is read again every second while it is open, since the
// dialog changes after an answer, and the card goes when the session
// leaves needs-input.

// How often the screen is read while the card is open.
const REFRESH_MS = 1000;

interface BadgeProps {
  session: SessionInfo;
  className: string;
  title?: string | undefined;
  children: ReactNode;
}

// The badge itself, wrapped as the card's anchor while the session needs
// input; any other time the caller renders the badge as it was.
export function AnswerBadge({ session, className, title, children }: BadgeProps) {
  return (
    <PopoverAnchor id={`answer:${session.id}`} className={className} title={title} hover={false} card={(props) => <AnswerPopover session={session} {...props} />}>
      {children}
    </PopoverAnchor>
  );
}

interface Screen {
  rows: string[];
  cursor: { x: number; y: number };
}

export function AnswerPopover({ session, anchor, onClose, onEnter, onLeave }: CardProps & { session: SessionInfo }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      window.emerald
        .request('pty.screen', { sessionId: session.id })
        .then((res) => {
          if (live) setScreen({ rows: res.rows, cursor: res.cursor });
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

  // M9 fix 777: an AskUserQuestion drawn as the terminal draws it, as the
  // chat view's card draws it, with no box.
  const ask = screen === null ? null : askQuestion(screen.rows);
  const excerpt = screen === null ? [] : promptExcerpt(screen.rows, screen.cursor);
  const options: (AnswerOption | AskOption)[] = ask?.options ?? (screen === null ? [] : answerOptions(screen.rows));
  const send = (data: string) => {
    typeInto(session.id, data);
    // An answer is a look at the row, as a click in the pane would be.
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
  };
  const askText = ask === null && (session.needsInputReason === 'question' || session.needsInputReason === 'elicitation' || options.length === 0);
  // A question wants words, so the box takes the keyboard as the card
  // opens; a permission keeps it in the terminal, the buttons need none.
  useEffect(() => {
    if (askText) inputRef.current?.focus();
  }, [askText]);
  return (
    <PopoverCard id={`answer:${session.id}`} className="answer-popover" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="answer-popover-heading">{askHeading(session.needsInputReason, screen?.rows)}</div>
      {ask !== null ? (
        <>
          {ask.tabs.length > 0 && (
            <div className="answer-popover-tabs">
              {ask.tabs
                .filter((t) => t.state !== 'submit')
                .map((t, i) => (
                  <span key={i} className="answer-popover-tab" data-state={t.state} data-current={t.current ? 'true' : undefined}>
                    {t.state === 'answered' && <span className="answer-popover-tab-mark">✓</span>}
                    {t.name}
                  </span>
                ))}
            </div>
          )}
          <div className="answer-popover-question">{ask.question}</div>
        </>
      ) : (
        <pre className="answer-popover-screen" data-rows={excerpt.length}>
          {screen === null ? 'Reading the screen…' : excerpt.length === 0 ? '(nothing drawn at the cursor)' : excerpt.join('\n')}
        </pre>
      )}
      <div className="answer-popover-options">
        {options.map((o) => (
          <button key={o.key} type="button" className="answer-popover-option" data-key={o.key} data-pointer={'pointer' in o && o.pointer ? 'true' : undefined} title={`Sends ${o.key} to the session`} onClick={() => send(o.key)}>
            <span className="answer-popover-key">{o.key}</span>
            <span className="answer-popover-text">
              <span className="answer-popover-label">{o.label}</span>
              {'description' in o && o.description !== '' && <span className="answer-popover-desc">{o.description}</span>}
            </span>
          </button>
        ))}
        <button type="button" className="answer-popover-option answer-popover-esc" data-key="esc" title="Sends Escape to the session" onClick={() => send('\x1b')}>
          <span className="answer-popover-key">Esc</span>
          <span className="answer-popover-label">Cancel</span>
        </button>
      </div>
      {askText && (
        <div className="answer-popover-form">
          <input
            ref={inputRef}
            className="answer-popover-input"
            placeholder="Type an answer and press Enter"
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            // The card's own press handler keeps the terminal's focus;
            // the box needs it to take typing.
            onMouseDown={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') onClose();
              // Enter on the key itself rather than a form's submit, which
              // a synthetic key event without its text never triggers.
              if (ev.key === 'Enter' && text.trim() !== '') {
                send(`${text}\r`);
                setText('');
              }
              ev.stopPropagation();
            }}
          />
        </div>
      )}
    </PopoverCard>
  );
}
