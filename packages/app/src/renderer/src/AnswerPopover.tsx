import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionInfo } from '@emerald/shared';
import { ackIfDone, sendAskSubmit, sendFreeAnswer, typeInto } from './actions.ts';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { answerOptions, askQuestion, askReview, dialogKey, freeOption, freeText, optionKeys, pressOver, promptExcerpt } from './screen-prompt-model.ts';
import type { AnswerOption, AskOption, AskPress } from './screen-prompt-model.ts';
import { tabMoves, visitAfter, visitAnswered, visitedTabs } from './screen-prompt-model.ts';
import type { AskTab, AskVisit } from './screen-prompt-model.ts';
import { AskTabs } from './AskTabs.tsx';
import { answeredElsewhere, askBoxShown, askHeading } from './chat-model.ts';
import { acknowledgeAttention } from './ui.ts';
import { TrustPopover } from './TrustCard.tsx';

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
    <PopoverAnchor id={`answer:${session.id}`} className={className} title={title} hover={false} card={(props) => (session.needsInputReason === 'trust' ? <TrustPopover session={session} {...props} /> : <AnswerPopover session={session} {...props} />)}>
      {children}
    </PopoverAnchor>
  );
}

interface Screen {
  rows: string[];
  cursor: { x: number; y: number };
  // When the read was asked for (M9 fix 801), so a press ends only on a
  // read sent after it.
  sentAt: number;
}

export function AnswerPopover({ session, anchor, onClose, onEnter, onLeave }: CardProps & { session: SessionInfo }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      const sentAt = Date.now();
      window.emerald
        .request('pty.screen', { sessionId: session.id })
        .then((res) => {
          if (live) setScreen({ rows: res.rows, cursor: res.cursor, sentAt });
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
  // chat view's card draws it, with no box; since fix 803 its Type
  // something row is an input that sends a free answer.
  // M9 fix 801: one press per dialog, as the chat view's card takes it; a
  // sent card draws what it answered until the press is over.
  // M9 fix 880: an ask answered elsewhere (the terminal face, the chat
  // view's card) dims the card on what was asked, as its own press would.
  const [pressed, setPressed] = useState<(AskPress & { screen: Screen | null }) | null>(null);
  const shown = pressed !== null ? pressed.screen : screen;
  useEffect(() => {
    if (pressed !== null && screen !== null && pressOver(pressed, screen)) setPressed(null);
  }, [screen, pressed]);
  const lastDialog = useRef<{ spell: number; key: string; screen: Screen } | null>(null);
  useEffect(() => {
    if (screen === null) return;
    const key = dialogKey(screen.rows, screen.cursor);
    if (key !== null) {
      lastDialog.current = { spell: session.stateSince, key, screen };
      return;
    }
    const last = lastDialog.current;
    if (last !== null && answeredElsewhere({ key, pressed: pressed !== null, spell: session.stateSince, dialogSpell: last.spell })) {
      setPressed({ at: screen.sentAt, key: last.key, screen: last.screen });
    }
  }, [screen, pressed, session.stateSince]);
  // M9 fix 879: the Review your answers tab, as the chat view's card draws it.
  const review = shown === null ? null : askReview(shown.rows);
  const ask = shown === null || review !== null ? null : askQuestion(shown.rows);
  // M9 fix 922: the tab a click moved the dialog to, as the chat view's
  // card keeps it (AskTabs.tsx, screen-prompt-model.ts).
  const [visit, setVisit] = useState<AskVisit | null>(null);
  const liveVisit = visit === null || screen === null ? visit : visitAfter(visit, { question: askQuestion(screen.rows)?.question ?? null, dialog: dialogKey(screen.rows, screen.cursor) !== null, pressing: pressed !== null });
  useEffect(() => {
    if (liveVisit !== visit) setVisit(liveVisit);
  }, [liveVisit, visit]);
  const askTabs = ask === null ? [] : visitedTabs(ask.tabs, liveVisit);
  const excerpt = shown === null ? [] : promptExcerpt(shown.rows, shown.cursor);
  const options: (AnswerOption | AskOption)[] = review?.options ?? ask?.options ?? (shown === null ? [] : answerOptions(shown.rows));
  // A dialog with a Cancel of its own draws no second one (fix 879).
  const escShown = !options.some((o) => o.label === 'Cancel');
  const send = (data: string) => {
    typeInto(session.id, data);
    // An answer is a look at the row, as a click in the pane would be.
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
  };
  const press = (data: string) => {
    if (pressed !== null) return;
    send(data);
    setPressed({ at: Date.now(), key: shown === null ? null : dialogKey(shown.rows, shown.cursor), screen: shown });
  };
  const sentMark = pressed !== null ? 'true' : undefined;
  // M9 fix 803: the Type something row as an input, as the chat view's
  // card draws it, its free answer a press.
  const freeOpt = ask === null ? null : freeOption(ask);
  const shownKey = shown === null ? null : dialogKey(shown.rows, shown.cursor);
  const [free, setFree] = useState('');
  const freeRef = useRef<HTMLInputElement>(null);
  const seededKey = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seededKey.current === shownKey) return;
    seededKey.current = shownKey;
    setFree(freeOpt === null ? '' : freeText(freeOpt));
  }, [shownKey, freeOpt]);
  const sendFree = () => {
    if (pressed !== null || free.trim() === '') return;
    if (ask !== null && !ask.multi) setVisit(visitAnswered(liveVisit));
    setPressed({ at: Number.POSITIVE_INFINITY, key: shownKey, screen: shown });
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
    sendFreeAnswer(session.id, free).then(
      (r) => setPressed((p) => (r === 'not-moved' ? null : p === null ? p : { ...p, at: Date.now() })),
      (err: unknown) => {
        console.warn('[emerald] free answer failed', err);
        setPressed(null);
      },
    );
  };
  // M9 fix 845: a multi-select's Submit button, as the chat view's card has.
  const submitShown = ask !== null && ask.multi && ask.submit !== null;
  const pressSubmit = () => {
    if (pressed !== null) return;
    setVisit(visitAnswered(liveVisit));
    setPressed({ at: Number.POSITIVE_INFINITY, key: shownKey, screen: shown });
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
    sendAskSubmit(session.id).then(
      (r) => setPressed((p) => (r === 'not-moved' ? null : p === null ? p : { ...p, at: Date.now() })),
      (err: unknown) => {
        console.warn('[emerald] ask submit failed', err);
        setPressed(null);
      },
    );
  };
  // M9 fix 922: a tab's press and an option's press, as the chat view's card.
  const pressTab = (tabs: readonly AskTab[], to: number) => {
    if (pressed !== null) return;
    const moves = tabMoves(
      tabs.findIndex((t) => t.current),
      to,
    );
    if (moves === '') return;
    setVisit({ index: to, from: ask?.question ?? null, question: null });
    press((freeOpt?.pointer === true ? '\x1b[A' : '') + moves);
  };
  const pressOption = (key: string) => {
    if (pressed !== null) return;
    if (ask !== null && !ask.multi) setVisit(visitAnswered(liveVisit));
    press(optionKeys(ask, key));
  };
  const askText = askBoxShown({ reason: session.needsInputReason, recognised: ask !== null || review !== null, options: options.length, pressed: pressed !== null, askedFor: session.askedFor });
  // A question wants words, so the box takes the keyboard as the card
  // opens; a permission keeps it in the terminal, the buttons need none.
  useEffect(() => {
    if (askText) inputRef.current?.focus();
  }, [askText]);
  return (
    <PopoverCard id={`answer:${session.id}`} className="answer-popover" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave} holdEscape>
      <div className="answer-popover-heading">{askHeading(session.needsInputReason, shown?.rows)}</div>
      {review !== null ? (
        <>
          {review.tabs.length > 0 && <AskTabs tabs={review.tabs} prefix="answer-popover" sent={pressed !== null} onPress={(to) => pressTab(review.tabs, to)} />}
          <div className="answer-popover-question">Review your answers</div>
          {review.warning !== null && <div className="answer-popover-review-warning">{review.warning}</div>}
          <div className="answer-popover-review">
            {review.items.map((item, i) => (
              <div key={i} className="answer-popover-review-item">
                <span className="answer-popover-review-q">{item.question}</span>
                <span className="answer-popover-review-a">{item.answer}</span>
              </div>
            ))}
          </div>
        </>
      ) : ask !== null ? (
        <>
          {askTabs.length > 0 && <AskTabs tabs={askTabs} prefix="answer-popover" sent={pressed !== null} onPress={(to) => pressTab(askTabs, to)} />}
          <div className="answer-popover-question">{ask.question}</div>
        </>
      ) : (
        <pre className="answer-popover-screen" data-rows={excerpt.length}>
          {shown === null ? 'Reading the screen…' : excerpt.length === 0 ? '(nothing drawn at the cursor)' : excerpt.join('\n')}
        </pre>
      )}
      <div className="answer-popover-options">
        {options.map((o) =>
          freeOpt !== null && o.key === freeOpt.key ? (
            <div
              key={o.key}
              className="answer-popover-option answer-popover-free"
              data-key={o.key}
              data-sent={sentMark}
              onClick={(ev) => {
                if (ev.target !== freeRef.current) freeRef.current?.focus();
              }}
            >
              <span className="answer-popover-key">{o.key}</span>
              <input
                ref={freeRef}
                className="answer-popover-free-input"
                placeholder="Type something"
                title="Sends this answer to the session"
                value={free}
                onChange={(ev) => setFree(ev.target.value)}
                // As the box below: the card's own press handler keeps the
                // terminal's focus, and the input needs it to take typing.
                onMouseDown={(ev) => ev.stopPropagation()}
                onKeyDown={(ev) => {
                  // Escape closes the card, as the box's does.
                  if (ev.key === 'Escape') onClose();
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    // In a multi-select the second Enter, the field already
                    // reading the text, submits (fix 845).
                    if (submitShown && freeOpt !== null && freeText(freeOpt) === free) pressSubmit();
                    else sendFree();
                  }
                  ev.stopPropagation();
                }}
              />
            </div>
          ) : (
            <button key={o.key} type="button" className="answer-popover-option" data-key={o.key} data-pointer={'pointer' in o && o.pointer ? 'true' : undefined} data-sent={sentMark} title={`Sends ${o.key} to the session`} onClick={() => pressOption(o.key)}>
              <span className="answer-popover-key">{o.key}</span>
              <span className="answer-popover-text">
                <span className="answer-popover-label">{o.label}</span>
                {'description' in o && o.description !== '' && <span className="answer-popover-desc">{o.description}</span>}
              </span>
            </button>
          ),
        )}
        {submitShown && ask.submit !== null && (
          <button type="button" className="answer-popover-option answer-popover-submit" data-key="submit" data-pointer={ask.submit.pointer ? 'true' : undefined} data-sent={sentMark} title="Submits the ticked answers" onClick={pressSubmit}>
            <span className="answer-popover-label">{ask.submit.label}</span>
          </button>
        )}
        {/* M9 fix 848: no Esc key cap here, since Escape on this card only
            closes it; the button is the session's Escape. */}
        {escShown && (
          <button type="button" className="answer-popover-option answer-popover-esc" data-key="esc" data-sent={sentMark} title="Sends Escape to the session" onClick={() => press('\x1b')}>
            <span className="answer-popover-label">Cancel</span>
          </button>
        )}
        {/* M9 fix 910: Back carries the ← cap, as the chat card's does: this card takes no key but Escape (Popover.tsx), so a Left goes to the focused terminal and reaches the session as the digits do. */}
        {review !== null && (
          <button type="button" className="answer-popover-option answer-popover-back" data-key="back" data-sent={sentMark} title="Sends ← to the session, back to the questions" onClick={() => press('\x1b[D')}>
            <span className="answer-popover-key">←</span>
            <span className="answer-popover-label">Back</span>
          </button>
        )}
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
                press(`${text}\r`);
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
