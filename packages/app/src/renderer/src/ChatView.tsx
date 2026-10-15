import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, parseSteps, resultText } from '@emerald/shared';
import type { SessionInfo, Step, StepTurn } from '@emerald/shared';
import { ackIfDone, sendPrompt, typeInto } from './actions.ts';
import { ASK_REFRESH_MS, CHAT_REREAD_MS, FALLBACK_ON_GROWTH, askHeading, hintText, opensMenu, spinnerOf } from './chat-model.ts';
import { parentPath } from './files-model.ts';
import { answerOptions, promptExcerpt } from './screen-prompt-model.ts';
import { SessionMark } from './session-mark.tsx';
import { acknowledgeAttention, setChatFace } from './ui.ts';

// M9 fix 689: a Claude session's chat face, the conversation drawn from
// its transcript over the same session, with a box that types into it.
// It sits inside the pane's .term-wrap after the terminal, which stays
// mounted under it (hidden, never refit), so the shade, the wait overlay
// and the exited notice still draw over this face as they do over the
// terminal. Story 1 draws every step (Verbose); the view modes, the
// footer's chips and the menus are story 2's.

type Read = { text: string } | { error: string } | null;

// The box grows from two rows to this many before it scrolls.
const BOX_MAX_LINES = 8;
const BOX_LINE_PX = 18;
// The scroll sticks to the end while the person is within this of it.
const STICK_PX = 24;

const timeOf = (at: number | null): string | null => (at === null ? null : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));

export function ChatView({ paneId, session, focused, shaded }: { paneId: string; session: SessionInfo; focused: boolean; shaded: boolean }) {
  const path = session.transcriptPath ?? null;
  const [read, setRead] = useState<Read>(null);

  // The transcript, read now and again whenever its folder changes, at
  // most once per CHAT_REREAD_MS with a trailing read, since a working
  // session writes a dozen lines a second and its neighbours in the same
  // project folder write beside it. A stale reply for another path is
  // dropped.
  useEffect(() => {
    setRead(null);
    if (path === null) return;
    let live = true;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      last = Date.now();
      void window.emerald.files
        .read(path)
        .then((r) => {
          if (!live) return;
          if ('text' in r) setRead({ text: r.text });
          else if ('error' in r) setRead({ error: r.error });
          else setRead({ error: 'Not a text file' });
        })
        .catch((err: unknown) => console.warn('[emerald] chat read failed', err));
    };
    load();
    const folder = parentPath(path);
    const off = window.emerald.files.onChanged((dir) => {
      if (dir !== folder || timer !== null) return;
      const wait = Math.max(0, last + CHAT_REREAD_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        load();
      }, wait);
    });
    return () => {
      live = false;
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [path]);

  const text = read !== null && 'text' in read ? read.text : '';
  const turns = useMemo(() => parseSteps(text), [text]);
  const tooLarge = read !== null && 'error' in read && read.error.startsWith('Too large') ? read.error : null;

  // The live line's word and count, off the spinner row, read once a
  // second while the session works (claim 8 of chat-claims-688.md).
  const working = session.state === 'working';
  const [spinner, setSpinner] = useState<{ word: string; down: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) {
      setSpinner(null);
      return;
    }
    let live = true;
    const tick = () => {
      setNow(Date.now());
      window.emerald
        .request('pty.screen', { sessionId: session.id })
        .then((res) => {
          if (live) setSpinner(spinnerOf(res.rows));
        })
        .catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [working, session.id]);

  // The scroll sticks to the end unless the person has scrolled up, read
  // against the height the last layout left, with no scroll event.
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (el === null) return;
    const atEnd = lastHeight.current === 0 || el.scrollTop + el.clientHeight >= lastHeight.current - STICK_PX;
    if (atEnd) el.scrollTop = el.scrollHeight;
    lastHeight.current = el.scrollHeight;
  });

  const [box, setBox] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // M9 fix 690: while the session asks, the card at the end of the
  // timeline takes the keys and the box is disabled under it.
  const asking = session.state === 'needs-input';
  const askRef = useRef<HTMLDivElement>(null);
  // The box takes the keyboard while the pane is focused and unshaded:
  // on mount (the face flipping to chat), on the pane taking focus and
  // when an ask ends; the card takes it while an ask is open.
  useEffect(() => {
    if (!focused || shaded) return;
    if (asking) askRef.current?.focus();
    else boxRef.current?.focus();
  }, [focused, shaded, asking]);

  // M9 fix 690: the fallback bar, over the box after a command whose
  // menu only the terminal draws, with the transcript's length when it
  // opened; it goes on Escape, on Show the terminal, and (claim 6) when
  // the transcript grows past that length.
  const [fallback, setFallback] = useState<{ length: number } | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    if (FALLBACK_ON_GROWTH && fallback !== null && text.length > fallback.length) setFallback(null);
  }, [text, fallback]);
  // Two rows growing to eight, from what the text needs.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, BOX_MAX_LINES * BOX_LINE_PX + 14)}px`;
  }, [box]);

  const send = () => {
    const prompt = box;
    if (prompt.trim() === '' || asking) return;
    setBox('');
    const menu = opensMenu(prompt);
    void sendPrompt(session.id, prompt).then((outcome) => {
      if (outcome.kind === 'refused') setRefusal(outcome.reason);
      else if (menu) setFallback({ length: textRef.current.length });
    });
  };
  const stop = () => typeInto(session.id, '\x1b');

  const last = turns.length === 0 ? null : turns[turns.length - 1]!;
  const hint = refusal ?? hintText(session.state);
  return (
    <div
      className="chat-view"
      data-session-id={session.id}
      // Escape anywhere in the view (the box included) goes to the
      // session, stopping a turn or leaving a menu, and closes the
      // fallback bar; the ask card handles its own.
      onKeyDown={(ev) => {
        if (ev.key !== 'Escape' || ev.defaultPrevented) return;
        ev.preventDefault();
        setFallback(null);
        stop();
      }}
    >
      <div className="chat-timeline" ref={timelineRef}>
        <div className="chat-column">
          {tooLarge !== null && (
            <div className="chat-error">
              <span>{tooLarge} · the terminal has the whole conversation</span>
              <button type="button" className="secondary" onClick={() => setChatFace(paneId, session.id, false)}>
                Show the terminal
              </button>
            </div>
          )}
          {turns.map((turn, i) => (
            <ChatTurn key={i} turn={turn} />
          ))}
          {asking && <AskCard session={session} rootRef={askRef} />}
          {working && (
            <div className="chat-live">
              <span className="chat-live-mark">
                <SessionMark kind="claude" working size="unit" />
              </span>
              {spinner !== null && <span className="chat-live-word">{spinner.word}</span>}
              <span className="chat-live-time">
                {last?.at != null ? formatDuration(last.at, now) : ''}
                {spinner?.down != null ? ` · ↓${spinner.down}` : ''}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="chat-dock">
        <div className="chat-dock-inner">
          {fallback !== null && (
            <div className="chat-fallback">
              <span className="chat-fallback-text">The terminal is showing a menu this view cannot draw</span>
              <button
                type="button"
                className="secondary chat-fallback-show"
                onClick={() => {
                  setFallback(null);
                  setChatFace(paneId, session.id, false);
                }}
              >
                Show the terminal
              </button>
            </div>
          )}
          <textarea
            ref={boxRef}
            className="chat-box"
            rows={2}
            value={box}
            disabled={asking}
            placeholder={asking ? 'Answer the ask above, or press Esc to cancel' : `Message ${session.name} · / for commands · @ for a file`}
            onChange={(ev) => {
              setBox(ev.target.value);
              setRefusal(null);
            }}
            onKeyDown={(ev) => {
              // Enter is the box's and Escape the view's (above); every
              // other key passes, so the window's chords still work from
              // in here.
              if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                send();
              }
            }}
          />
          <div className="chat-foot">
            <span className="chat-hint">{hint}</span>
            {working && (
              <button type="button" className="secondary chat-stop" title="Sends Escape to the session" onClick={stop}>
                Stop
              </button>
            )}
            <button type="button" className="chat-send" disabled={box.trim() === '' || asking} onClick={send}>
              Send ⏎
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Screen {
  rows: string[];
  cursor: { x: number; y: number };
}

// M9 fix 690: the ask as a card on the rail, read off the screen once a
// second as the sidebar's card is (AnswerPopover.tsx, which stays its
// own; both build on screen-prompt-model.ts). The digits press the
// option of that key, Escape cancels, and a question gets a box.
function AskCard({ session, rootRef }: { session: SessionInfo; rootRef: React.RefObject<HTMLDivElement | null> }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [answer, setAnswer] = useState('');
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
    const timer = setInterval(read, ASK_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session.id]);
  const excerpt = screen === null ? [] : promptExcerpt(screen.rows, screen.cursor);
  const options = screen === null ? [] : answerOptions(screen.rows);
  // Not before the first read, or the box would take the keyboard and go
  // with it the moment the options are read.
  const askText = screen !== null && (session.needsInputReason === 'question' || session.needsInputReason === 'elicitation' || options.length === 0);
  const send = (data: string) => {
    typeInto(session.id, data);
    // An answer is a look at the row, as a click in the pane would be.
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
  };
  // A question wants words, so its box takes the keyboard, as the
  // sidebar card's does.
  useEffect(() => {
    if (askText) inputRef.current?.focus();
    // The box gone with the keyboard in it: back to the card.
    else if (document.activeElement === document.body) rootRef.current?.focus();
  }, [askText, rootRef]);
  return (
    <div
      className="chat-step chat-ask-step"
      data-kind="ask"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(ev) => {
        if (ev.target !== ev.currentTarget) return;
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          send('\x1b');
        } else if (/^[1-9]$/.test(ev.key) && options.some((o) => o.key === ev.key)) {
          ev.preventDefault();
          send(ev.key);
        }
      }}
    >
      <span className="chat-dot" data-tone="blocked" />
      <div className="chat-ask">
        <div className="chat-ask-heading">{askHeading(session.needsInputReason)}</div>
        <pre className="chat-ask-screen" data-rows={excerpt.length}>
          {screen === null ? 'Reading the screen…' : excerpt.length === 0 ? '(nothing drawn at the cursor)' : excerpt.join('\n')}
        </pre>
        <div className="chat-ask-options">
          {options.map((o) => (
            <button key={o.key} type="button" className="chat-ask-option" data-key={o.key} title={`Sends ${o.key} to the session`} onClick={() => send(o.key)}>
              <span className="chat-ask-key">{o.key}</span>
              <span className="chat-ask-label">{o.label}</span>
            </button>
          ))}
          <button type="button" className="chat-ask-option chat-ask-esc" data-key="esc" title="Sends Escape to the session" onClick={() => send('\x1b')}>
            <span className="chat-ask-key">Esc</span>
            <span className="chat-ask-label">Cancel</span>
          </button>
        </div>
        {askText && (
          <input
            ref={inputRef}
            className="chat-ask-input"
            placeholder="Type an answer and press Enter"
            value={answer}
            onChange={(ev) => setAnswer(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                send('\x1b');
              }
              if (ev.key === 'Enter' && answer.trim() !== '') {
                ev.preventDefault();
                send(`${answer}\r`);
                setAnswer('');
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function ChatTurn({ turn }: { turn: StepTurn }) {
  const when = timeOf(turn.at);
  const length = turn.at !== null && turn.endAt !== null ? formatDuration(turn.at, turn.endAt) : null;
  return (
    <div className="chat-turn">
      <div className="chat-prompt-row">
        <div className="chat-prompt">{turn.prompt}</div>
        {(when !== null || length !== null) && <span className="chat-prompt-time">{[when, length].filter((x) => x !== null).join(' · ')}</span>}
      </div>
      {turn.steps.length > 0 && (
        <div className="chat-rail">
          {turn.steps.map((step, i) => (
            <ChatStep key={i} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatStep({ step }: { step: Step }) {
  if (step.kind === 'thinking') {
    return (
      <div className="chat-step" data-kind="thinking">
        <span className="chat-dot" data-tone="thinking" />
        <div className="chat-thinking-head">{step.ms === null ? 'Thought' : `Thought for ${Math.round(step.ms / 1000)}s`}</div>
        {step.text.trim() !== '' && <div className="chat-thinking-text">{step.text}</div>}
      </div>
    );
  }
  if (step.kind === 'text') {
    return (
      <div className="chat-step chat-reply" data-kind="text">
        {/* The tick is the cell's ::before, so the reply's text is the element's text alone. */}
        <span className="chat-tick-cell" aria-hidden="true" />{step.text}
      </div>
    );
  }
  if (step.kind === 'note') {
    return (
      <div className="chat-step chat-note" data-kind="note">
        <span className="chat-dot" data-tone="thinking" />
        {step.text}
      </div>
    );
  }
  const tone = step.result === null ? 'pending' : step.result.error ? 'error' : 'done';
  const result = resultText(step);
  const counts = /^\+(\d+) −(\d+)$/.exec(result);
  return (
    <div className="chat-step" data-kind="tool" data-tool={step.name}>
      <span className="chat-dot" data-tone={tone} />
      <span className="chat-tool-name">{step.name}</span>
      <span className="chat-tool-arg" title={step.arg}>
        {step.arg}
      </span>
      <span className="chat-tool-result">
        {counts === null ? (
          result
        ) : (
          <>
            <span className="chat-added">+{counts[1]}</span> <span className="chat-removed">{'−'}{counts[2]}</span>
          </>
        )}
      </span>
    </div>
  );
}
