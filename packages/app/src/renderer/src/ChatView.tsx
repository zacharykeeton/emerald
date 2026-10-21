import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { contextWords, describeState, effortFold, effortState, folderName, formatDuration, markKind, queueFold, queueList, queueState, resultText, stepFold, stepState, teamCounts } from '@emerald/shared';
import type { EffortState, QueueState, SessionInfo, SessionState, Step, StepState, StepTurn } from '@emerald/shared';
import { ackIfDone, sendCtrlC, sendPrompt, typeInto } from './actions.ts';
import { sendAskSubmit, sendFreeAnswer } from './actions.ts';
import { CHAT_MODES, CHAT_MODE_WORDS, CHAT_REREAD_MS, CHIP_SETTLE_MS, EFFORT_LEVELS, EFFORT_LINES, FALLBACK_ON_GROWTH, IMAGE_PASTE_KEY, MODEL_CHOICES, MODE_CHOICES, QUEUE_PICK, SCREEN_READ_MS, agentChipText, askHeading, drawsPending, effortShown, fileHref, filterMention, filterSlash, hintText, inputHolds, isImageName, landedCounts, mentionQuery, mentionText, modelChipText, modelItems, modeOf, nextChatMode, opensMenu, pastedPath, pendingAfter, pendingItem, pendingWords, freshImage, promptRowImages, relativeMention, sessionDiff, slashQuery, slashRows, spinnerOf, stepModeTo, timelineItems, imageOnlyPrompt, viewChipShown, foldText, placeholderFirstLine } from './chat-model.ts';
// M9 fix 797, on a line of its own so the chat branches' imports do not meet.
import { shellWords } from './chat-model.ts';
import { rcOf, rcUrlOf } from './chat-model.ts';
import type { ReactNode } from 'react';
import type { ChatMode, FoldItem, PendingItem, SlashRow } from './chat-model.ts';
import { CARRY_MS, CARRY_POLL_MS, carryRead, stopCarry } from './chat-model.ts';
import { ChevronIcon, MentionMenu, PaperclipIcon, SlashMenu } from './ChatMenus.tsx';
import { isPasteKey } from './keys-model.ts';
import type { MentionRow } from './ChatMenus.tsx';
import type { SkillEntry, TailMark } from '../../preload/api.ts';
import { parentPath } from './files-model.ts';
import { ChatReply, ChatThumbRow, EditCardHead, PromptImages, usePathLinks } from './ChatParts.tsx';
import { openWebLink } from './ChatParts.tsx';
import { ChatBash, ChatCompact } from './ChatParts.tsx';
import { pendingEdit } from './chat-hunk.ts';
import { LIVE_ROWS_CAP, dropTaken, liveTurns } from './chat-feed.ts';
import type { LiveRow } from './chat-feed.ts';
import type { PendingEdit } from './chat-hunk.ts';
import { resolveIn } from './chat-paths.ts';
import { Menu } from './Menu.tsx';
import type { MenuHeading, MenuItem, MenuSegments } from './Menu.tsx';
import { PopoverAnchor } from './Popover.tsx';
import { RosterCard } from './roster.tsx';
import { answerOptions, askQuestion, askReview, ghostSuggestion, promptExcerpt } from './screen-prompt-model.ts';
import type { AnswerOption, AskOption } from './screen-prompt-model.ts';
import { dialogKey, freeOption, freeText, optionKeys, pressOver } from './screen-prompt-model.ts';
import type { AskPress } from './screen-prompt-model.ts';
import { tabKeyStep, tabMoves, tabStepTo, visitAfter, visitAnswered, visitedTabs } from './screen-prompt-model.ts';
import type { AskTab, AskVisit } from './screen-prompt-model.ts';
import { AskTabs } from './AskTabs.tsx';
import { answeredElsewhere, askBoxShown } from './chat-model.ts';
import { SessionMark } from './session-mark.tsx';
import { copyAndNote } from './actions.ts';
import { PaneNote } from './CheatSheet.tsx';
import { TrustCard } from './TrustCard.tsx';
import { acknowledgeAttention, getUiState, openReviewTab, setChatFace, setChatMode, useUi } from './ui.ts';
import { getState } from './store.ts';

// M9 fix 689: a Claude session's chat face, the conversation drawn from
// its transcript over the same session, with a box that types into it.
// It sits inside the pane's .term-wrap after the terminal, which stays
// mounted under it (hidden, never refit), so the shade, the wait overlay
// and the exited notice still draw over this face as they do over the
// terminal. Story 1 draws every step (Verbose). Since fix 713 the footer
// under the box carries story 2's chips: the permission mode, the model
// with its effort, the agents out and returned, and the lines changed.

// M9 fix 770: what the transcript has fed the view. The mark the next
// tail read starts from, the three folds (the turns, the queue, the
// effort), the byte offset read to (the fallback bar's growth read), and
// whether the first read skipped the head of a transcript over 8 MB.
interface Fed {
  mark: TailMark | null;
  steps: StepState;
  queue: QueueState;
  effort: EffortState;
  size: number;
  cut: boolean;
}

const freshFed = (): Fed => ({ mark: null, steps: stepState(), queue: queueState(), effort: effortState(), size: 0, cut: false });

// The box grows from two rows to this many before it scrolls.
const BOX_MAX_LINES = 8;
const BOX_LINE_PX = 18;

// Two rows growing to eight, from what the text needs. scrollHeight leaves
// out the border a border-box height counts, so it is added back, or the box
// is 2 px short and shows a scrollbar with nothing to scroll (M9 fix 846).
// Only for a box that is laid out: hidden, every read is 0 and the write
// would be 0px (M9 fix 957).
function fitBox(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${Math.min(el.scrollHeight + border, BOX_MAX_LINES * BOX_LINE_PX + 14)}px`;
}

// One canvas context for measuring the placeholder's first line (M9 fix 810).
let measureCtx: CanvasRenderingContext2D | null = null;
function measureContext(): CanvasRenderingContext2D {
  if (measureCtx === null) measureCtx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  return measureCtx;
}
// M9 fix 784: the box's text kept across an unmount that is not a flip to
// the terminal, by pane and session, and taken back on the next mount.
const chatDrafts = new Map<string, string>();
// The states a mount carries Claude's input in: never starting, an ask or
// an exited session.
const CARRY_STATES: ReadonlySet<SessionState> = new Set<SessionState>(['idle', 'done', 'waiting', 'working', 'errored']);
const CARRY_BLOCKED = "Claude's input holds text the chat box cannot take; Show the terminal to send or clear it";
// The scroll sticks to the end while the person is within this of it.
const STICK_PX = 24;
// The view menu's words beside each mode (M9 fix 714).
const VIEW_HINTS: Readonly<Record<ChatMode, string>> = { normal: 'steps folded', thinking: 'and the thinking', verbose: 'every step' };

const timeOf = (at: number | null): string | null => (at === null ? null : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));

export function ChatView({ paneId, session, focused, shaded }: { paneId: string; session: SessionInfo; focused: boolean; shaded: boolean }) {
  const path = session.transcriptPath ?? null;
  // M9 fix 770: what the transcript has fed the view, folded as it grows;
  // the view holds no transcript text. The ref is the folds as the last
  // read left them, and `fed` a copy of its fields the render reads, set
  // only by a read that brought text or started again.
  const fedRef = useRef<Fed>(freshFed());
  const [fed, setFed] = useState<Fed>(fedRef.current);

  // The transcript, read now and again whenever its folder changes, at
  // most once per CHAT_REREAD_MS with a trailing read, since a working
  // session writes a dozen lines a second and its neighbours in the same
  // project folder write beside it. Each read takes the whole lines the
  // file grew by since the last (M9 fix 770), so no two run at once: a
  // change during one reads again after it. A stale reply for another
  // path is dropped.
  useEffect(() => {
    fedRef.current = freshFed();
    setFed(fedRef.current);
    if (path === null) return;
    let live = true;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let again = false;
    const load = () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      last = Date.now();
      void window.emerald.files
        .readTail(path, fedRef.current.mark)
        .then((r) => {
          if (!live) return;
          // M9 fix 722: an error (the transcript not written yet, a read
          // caught mid-write) keeps what is drawn; the next change push
          // reads again, and a folder's first watch sends one
          // (folder-watchers.ts).
          if ('error' in r) return;
          const was = fedRef.current;
          const into = r.fresh ? freshFed() : was;
          stepFold(into.steps, r.text);
          queueFold(into.queue, r.text);
          effortFold(into.effort, r.text);
          fedRef.current = { ...into, mark: r.next, size: r.next.offset, cut: r.fresh ? r.cut : was.cut };
          if (r.fresh || r.text !== '') setFed(fedRef.current);
        })
        .catch((err: unknown) => console.warn('[emerald] chat read failed', err))
        .finally(() => {
          busy = false;
          if (again && live) {
            again = false;
            load();
          }
        });
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

  // M9 fix 769: the rows the session's mod pushes as Claude Code keeps
  // them, drawn over the file's turns until each one's line lands. The
  // daemon replays none: the file read covers what came before the mount.
  const [live, setLive] = useState<LiveRow[]>([]);
  useEffect(() => {
    setLive([]);
    return window.emerald.on((msg) => {
      if (msg.type !== 'transcript.row' || msg.sessionId !== session.id) return;
      const row: LiveRow = { uuid: msg.uuid, at: msg.at, row: msg.row, cut: msg.cut === true, came: Date.now() };
      setLive((rows) => [...rows, row].slice(-LIVE_ROWS_CAP));
    });
  }, [session.id, path]);
  useEffect(() => setLive((rows) => dropTaken(rows, fed.steps.uuids, Date.now())), [fed]);
  const turns = useMemo(() => liveTurns(fed.steps, live), [fed, live]);

  // M9 fix 754: the person's messages queued behind the turn. An idle,
  // done or exited session shows none, so a queue a crash left behind
  // never lingers.
  const queued = useMemo(() => (session.state === 'working' || session.state === 'needs-input' ? queueList(fed.queue) : []), [fed, session.state]);

  const diff = useMemo(() => sessionDiff(turns, session.cwd), [turns, session.cwd]);

  // M9 fix 713: one read of the session's screen a second while the view
  // shows, whatever the state, feeding the live line's word and count
  // (claim 8 of chat-claims-688.md), the mode chip and the ask card. A
  // shade covers the face, so the read waits for the lift and goes at
  // once then; it goes at once too when an ask comes up, and the card
  // takes no read sent before that moment, so it never builds from the
  // screen before the dialog.
  const working = session.state === 'working';
  const asking = session.state === 'needs-input';
  const [screen, setScreen] = useState<(Screen & { sentAt: number }) | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const askFrom = useRef(0);
  const wasAsking = useRef(false);
  if (asking && !wasAsking.current) askFrom.current = Date.now();
  wasAsking.current = asking;
  useEffect(() => setScreen(null), [session.id]);
  useEffect(() => {
    if (shaded) return;
    let live = true;
    const tick = () => {
      const sentAt = Date.now();
      setNow(sentAt);
      window.emerald
        .request('pty.screen', { sessionId: session.id })
        .then((res) => {
          if (live) setScreen({ rows: res.rows, cursor: res.cursor, ghost: res.ghost ?? null, sentAt });
        })
        .catch((err: unknown) => console.warn('[emerald] screen read failed', err));
    };
    tick();
    const timer = setInterval(tick, SCREEN_READ_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session.id, shaded, asking]);
  const spinner = working && screen !== null ? spinnerOf(screen.rows) : null;
  // M9 fix 769: the engine's own word where the mod posts it (the pty's
  // guess is off then), else the pty scanner's or the screen's.
  const liveWord = session.liveVerb ?? spinner?.word ?? null;
  const mode = screen === null ? null : modeOf(screen.rows);
  // M9 fix 889: remote control's pill, off the same screen read.
  const rc = screen === null ? null : rcOf(screen.rows);
  const rcUrl = useMemo(() => rcUrlOf(turns), [turns]);
  const askScreen = screen !== null && screen.sentAt >= askFrom.current ? screen : null;

  // The scroll sticks to the end unless the person has scrolled up, read
  // against the height the last layout left, with no scroll event.
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  // M9 fix 752: a fold toggle stores where the reply the person was
  // reading stood, and the next layout puts it back there in place of
  // the stick, then tints it once.
  const anchor = useRef<{ turn: number; top: number } | null>(null);
  const flash = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (el === null) return;
    const held = anchor.current;
    if (held !== null) {
      anchor.current = null;
      const target = foldAnchorIn(el, held.turn);
      if (target !== null) {
        el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - held.top;
        lastHeight.current = el.scrollHeight;
        if (target.classList.contains('chat-reply')) {
          if (flash.current !== null) {
            clearTimeout(flash.current.timer);
            flash.current.el.classList.remove('chat-fold-flash');
          }
          target.classList.add('chat-fold-flash');
          // Removed by the timer, never by animationend, so the class goes
          // when animations are off too.
          flash.current = { el: target, timer: setTimeout(() => target.classList.remove('chat-fold-flash'), 700) };
        }
        return;
      }
    }
    const atEnd = lastHeight.current === 0 || el.scrollTop + el.clientHeight >= lastHeight.current - STICK_PX;
    if (atEnd) el.scrollTop = el.scrollHeight;
    lastHeight.current = el.scrollHeight;
  });

  const [box, setBox] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // M9 fix 779: Claude Code's suggested prompt, ghosted in the empty box
  // where the placeholder sits; Tab or the Right arrow takes it. A screen
  // read sent before the last send can carry the last turn's suggestion,
  // so it is ignored.
  const lastSent = useRef(0);
  const ghost = box === '' && !asking && !working && screen !== null && screen.sentAt >= lastSent.current ? ghostSuggestion(screen) : null;
  // M9 fix 690: while the session asks, the card at the end of the
  // timeline takes the keys and the box is disabled under it.
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
  // menu only the terminal draws, with the transcript's size when it
  // opened (its byte offset since fix 770); it goes on Escape, on Show
  // the terminal, and (claim 6) when the transcript grows past that.
  const [fallback, setFallback] = useState<{ size: number } | null>(null);
  useEffect(() => {
    if (FALLBACK_ON_GROWTH && fallback !== null && fed.size > fallback.size) setFallback(null);
  }, [fed, fallback]);
  // Two rows growing to eight (fitBox); a box with no width is in a hidden
  // layout tab and is sized when the observer sees it laid out (M9 fix 957).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el === null || el.clientWidth === 0) return;
    fitBox(el);
  }, [box]);

  // M9 fix 810: the placeholder's first line is cut with an ellipsis inside
  // its quotes when the session's name would wrap it onto a second line and
  // push the hints past the box's two rows. The box's room and font are held
  // in state by a ResizeObserver; the line is measured with a canvas. Since
  // fix 846 the observer follows the box element itself through its ref, so
  // the box an exit unmounts and a Resume brings back is measured again, and
  // a read of a box with no width is skipped.
  const [boxGeom, setBoxGeom] = useState<{ room: number; font: string } | null>(null);
  const boxObserve = useCallback((el: HTMLTextAreaElement | null) => {
    boxRef.current = el;
    if (el === null) return;
    // M9 fix 957: a box first laid out after its mount (its layout tab hidden at a restore) is sized when it is.
    let laidOut = el.clientWidth > 0;
    const read = (): void => {
      if (el.clientWidth === 0) {
        laidOut = false;
        return;
      }
      if (!laidOut) {
        laidOut = true;
        fitBox(el);
      }
      const cs = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setBoxGeom((prev) => (prev !== null && prev.room === room && prev.font === cs.font ? prev : { room, font: cs.font }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      ro.disconnect();
      boxRef.current = null;
    };
  }, []);
  const placeholderFirst = useMemo(() => {
    if (boxGeom === null) return `Message session: "${session.name}"`;
    const ctx = measureContext();
    ctx.font = boxGeom.font;
    return placeholderFirstLine(session.name, boxGeom.room, (s) => ctx.measureText(s).width);
  }, [session.name, boxGeom]);

  // M9 fix 719: the `/` menu, while the whole box is a `/` and no space.
  // Escape closes it at the text it was dismissed at, and it shows again
  // once the text changes. The skills are asked for each time it opens
  // from closed; the built-ins and the terminal's rows show at once.
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillEntry[] | null>(null);
  const [slashActive, setSlashActive] = useState(0);
  const query = slashQuery(box);
  const slashWanted = query !== null && box !== slashDismissed && !asking;
  useEffect(() => {
    if (box !== slashDismissed) setSlashDismissed(null);
  }, [box, slashDismissed]);
  useEffect(() => {
    if (!slashWanted) {
      setSkills(null);
      return;
    }
    let live = true;
    window.emerald
      .skills(session.cwd)
      .then((list) => {
        if (live) setSkills(list);
      })
      .catch((err: unknown) => console.warn('[emerald] skills read failed', err));
    return () => {
      live = false;
    };
  }, [slashWanted, session.cwd]);
  const slashFiltered = useMemo(() => (query === null ? [] : filterSlash(slashRows(skills ?? []), query)), [query, skills]);
  const slashShown = slashWanted && slashFiltered.length > 0;
  useEffect(() => setSlashActive(0), [query]);
  const slashPick = slashFiltered[Math.min(slashActive, slashFiltered.length - 1)];

  // M9 fix 720: the `@` menu, on the token before the caret, listing the
  // one folder of the session's the typed path names (the files rail's
  // own listing), each folder read once while the menu is open. Escape
  // closes it at the text and caret it was dismissed at.
  const [caret, setCaret] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const listings = useRef(new Map<string, MentionRow[]>());
  const [listed, setListed] = useState(0);
  const mention = slashWanted ? null : mentionQuery(box, caret);
  const mentionKey = `${caret}:${box}`;
  const mentionWanted = mention !== null && !asking && mentionKey !== mentionDismissed;
  useEffect(() => {
    if (mentionKey !== mentionDismissed) setMentionDismissed(null);
  }, [mentionKey, mentionDismissed]);
  const mentionDir = mention?.dir ?? null;
  useEffect(() => {
    if (!mentionWanted || mentionDir === null) {
      if (!mentionWanted) listings.current.clear();
      return;
    }
    if (listings.current.has(mentionDir)) return;
    let live = true;
    const folder = mentionDir === '' ? session.cwd : `${session.cwd.replace(/[\\/]+$/, '')}\\${mentionDir.replace(/\//g, '\\').replace(/\\+$/, '')}`;
    window.emerald.files
      .list(folder)
      .then((r) => {
        if (!live) return;
        listings.current.set(mentionDir, 'error' in r ? [] : r.entries);
        setListed((n) => n + 1);
      })
      .catch(() => {
        if (!live) return;
        listings.current.set(mentionDir, []);
        setListed((n) => n + 1);
      });
    return () => {
      live = false;
    };
  }, [mentionWanted, mentionDir, session.cwd]);
  const mentionRows = useMemo(() => (mention === null ? [] : filterMention(listings.current.get(mention.dir) ?? [], mention.needle)), [mention?.dir, mention?.needle, listed]);
  const mentionShown = mentionWanted && mentionRows.length > 0;
  useEffect(() => setMentionActive(0), [mention?.dir, mention?.needle]);
  const mentionPick = mentionRows[Math.min(mentionActive, mentionRows.length - 1)];
  // The box's text with `insert` in place of from..to, the caret after it.
  const replaceInBox = (from: number, to: number, insert: string) => {
    const el = boxRef.current;
    const text = el === null ? box : el.value;
    setBox(text.slice(0, from) + insert + text.slice(to));
    pendingCaret.current = from + insert.length;
  };
  // A file goes in finished, with a space; a folder goes in as `@dir/`,
  // so the menu lists it next, unless its path has a space, which
  // Claude Code's quoted form closes, so it goes in finished too.
  const pickMention = (row: MentionRow) => {
    if (mention === null) return;
    const rel = `${mention.dir}${row.name}`;
    if (row.kind === 'file') replaceInBox(mention.start, caret, `${mentionText(rel)} `);
    else if (rel.includes(' ')) replaceInBox(mention.start, caret, `${mentionText(`${rel}/`)} `);
    else replaceInBox(mention.start, caret, `@${rel}/`);
    boxRef.current?.focus();
  };
  useLayoutEffect(() => {
    const el = boxRef.current;
    const at = pendingCaret.current;
    if (el === null || at === null) return;
    pendingCaret.current = null;
    el.setSelectionRange(at, at);
    setCaret(at);
  }, [box]);
  // `Mention in the message` from a path's menu in the timeline (the
  // reply branch's A10) arrives as this event; the view whose pane it
  // names puts the path at the caret, the selection replaced.
  const cwdRef = useRef(session.cwd);
  cwdRef.current = session.cwd;
  const askingRef = useRef(asking);
  askingRef.current = asking;
  // A mention of an absolute path at from..to, made relative to the
  // session's folder once main gives the path its long spelling, since
  // the daemon keeps the folder long and a reply or %TEMP% may name it
  // short (M9 fix 751). Every mention source goes through here.
  // A folder goes in finished, `@dir/ `, since a drop is not a typeahead
  // (M9 fix 746).
  const insertMention = async (abs: string, from: number, to: number, dir = false) => {
    const real = await window.emerald.files.real(abs).catch(() => abs);
    const rel = relativeMention(cwdRef.current, real);
    replaceInBox(from, to, `${mentionText(dir ? `${rel}/` : rel)} `);
    if (!askingRef.current) boxRef.current?.focus();
  };
  useEffect(() => {
    const onMention = (ev: Event) => {
      const detail = (ev as CustomEvent<{ paneId?: unknown; path?: unknown }>).detail;
      if (detail?.paneId !== paneId || typeof detail.path !== 'string') return;
      const el = boxRef.current;
      if (el === null) return;
      void insertMention(detail.path, el.selectionStart, el.selectionEnd);
    };
    window.addEventListener('emerald:chat-mention', onMention);
    return () => window.removeEventListener('emerald:chat-mention', onMention);
  }, [paneId, session.cwd]);

  // M9 fix 782: the messages sent from the box and not yet in the
  // conversation, drawn at its end until their prompt line or queued card
  // lands. The match is worked out in the render that draws the new turn,
  // so the bubble and the prompt are never on screen in one frame; an
  // effect then prunes the list. `quietSince` is when the session last went
  // quiet (the mount, when it was quiet then), null while it works or asks.
  const [pending, setPending] = useState<PendingItem[]>([]);
  const nextPending = useRef(0);
  const landed = useMemo(() => landedCounts(turns, queueList(fed.queue)), [turns, fed]);
  const landedRef = useRef(landed);
  landedRef.current = landed;
  const shownPending = useMemo(() => pendingAfter(pending, landed), [pending, landed]);
  useEffect(() => {
    if (shownPending.length !== pending.length) setPending(shownPending);
  }, [shownPending, pending]);
  useEffect(() => setPending([]), [session.id]);
  const quiet = !working && !asking;
  const quietSince = useRef<number | null>(quiet ? Date.now() : null);
  const wasQuiet = useRef(quiet);
  if (quiet !== wasQuiet.current) quietSince.current = quiet ? Date.now() : null;
  wasQuiet.current = quiet;

  // M9 fix 784: the input moves with the face. On mount (the face flipped
  // to chat, or the pane given this session) the box takes back its kept
  // draft, then the text in Claude Code's own input moves into the box by
  // fix 778's carry (Claude's input emptied); an input holding an image, a
  // pasted block or more than one row stays, with a hint. Never while an
  // ask is open, since an AskUserQuestion's `❯ 1.` option reads as the
  // prompt row. On unmount the box's text goes back into Claude's input,
  // with no Enter, when the face no longer names the session (flipped to
  // the terminal, or the pane given another session); any other unmount
  // (the pane no longer a Claude pane, the tab hidden) keeps it as a draft.
  const boxNow = useRef(box);
  boxNow.current = box;
  useEffect(() => {
    const id = session.id;
    const key = `${paneId}:${id}`;
    const draft = chatDrafts.get(key);
    chatDrafts.delete(key);
    setBox(draft ?? '');
    if (draft !== undefined) pendingCaret.current = draft.length;
    const at = getState().sessions.get(id) ?? session;
    if (markKind(at) === 'claude' && CARRY_STATES.has(at.state) && !askingRef.current) {
      void window.emerald
        .request('pty.screen', { sessionId: id })
        .then((sc) => {
          if (!alive.current || sessionRef.current !== id || askingRef.current) return;
          const read = carryRead(sc);
          if (read.kind === 'blocked') setRefusal(CARRY_BLOCKED);
          else if (read.kind === 'text') void carryInput();
        })
        .catch(() => {});
    }
    return () => {
      const text = boxNow.current;
      if (text === '') return;
      const now = getState().sessions.get(id);
      if (getUiState().chatPanes.get(paneId) !== id && now !== undefined && now.state !== 'needs-input' && now.state !== 'exited') typeInto(id, text);
      else chatDrafts.set(key, text);
    };
  }, [session.id]);

  // The words go after the images already in Claude Code's prompt, so a
  // send with only chips is a send too.
  const send = (text = box) => {
    const prompt = text;
    if ((prompt.trim() === '' && chipsRef.current.length === 0) || asking) return;
    setModeMiss(null);
    // M9 fix 781: images sit in Claude Code's own input as [Image #N], and
    // a mod submit would send the words alone and leave them there, so a
    // send with chips is typed.
    const typed = chipsRef.current.length > 0;
    setBox('');
    lastSent.current = Date.now();
    setChips([]);
    const menu = opensMenu(prompt);
    // M9 fix 782: a send drops the refused and unseen bubbles, then draws
    // its own unless it is a command or empty.
    const id = (nextPending.current += 1);
    const sentAt = Date.now();
    const draws = drawsPending(prompt);
    setPending((list) => {
      const kept = pendingAfter(list, landedRef.current).filter((p) => pendingWords(p, sentAt, quietSince.current).state === 'sending');
      return draws ? [...kept, pendingItem(id, prompt, sentAt, kept, landedRef.current)] : kept;
    });
    void sendPrompt(session.id, prompt, { typed }).then((outcome) => {
      if (outcome.kind === 'refused') {
        setRefusal(outcome.reason);
        const reason = outcome.reason;
        setPending((list) => list.map((p) => (p.id === id ? { ...p, refusal: reason } : p)));
        // The text goes back in the box, before whatever is there now.
        if (prompt.trim() !== '' && alive.current && sessionRef.current === session.id) {
          const now = boxRef.current?.value ?? '';
          const next = now === '' ? prompt : `${prompt}\n${now}`;
          setBox(next);
          pendingCaret.current = next.length;
        }
      } else if (menu) setFallback({ size: fedRef.current.size });
    });
  };
  // M9 fix 778: Escape on a working turn makes Claude Code put the interrupted prompt back in its input, where the next message would be joined onto it; the prompt moves into the box instead, the terminal's input emptied, as the terminal shows it.
  // An Escape that stops no turn (leaving a menu) carries nothing, and if
  // the transcript has not written the turn's prompt yet the expect is the
  // turn before's, the input does not start with it, and nothing moves. A
  // prompt the mod submitted is never in the input, so for a turn stopped
  // before any step the box takes it off the turn (stopCarry).
  const stop = () => {
    const turn = working && turns.length > 0 ? turns[turns.length - 1]! : null;
    typeInto(session.id, '\x1b');
    if (turn !== null) void carryInput(turn.prompt, turn);
  };
  // M9 fix 754: a queued message taken back from Claude Code's queue the
  // way its own keys do it, by QUEUE_PICK: on 'all' (2.1.301) one Up pulls
  // the whole queue into the TUI's input; on 'one' Up to the message (the
  // newest is one Up) and Enter pulls that one. Backspaces then empty the
  // input, and an Edit puts the text in the box. Escape is never sent,
  // since it cancels the turn. A bubble goes when the transcript's popAll
  // or popOne line lands.
  const [takingBack, setTakingBack] = useState(false);
  const takingRef = useRef(false);
  const queuePath = QUEUE_PICK;
  const takeBack = async (k: number, then: 'edit' | 'remove') => {
    const message = queued[k];
    if (message === undefined || takingRef.current) return;
    const all = queuePath === 'all';
    // The pull-all path brings the whole queue back, oldest first.
    const target = all ? queued[0]! : message;
    const texts = all ? queued.map((m) => m.text) : [message.text];
    takingRef.current = true;
    setTakingBack(true);
    const id = session.id;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const rows = async () => (await window.emerald.request('pty.screen', { sessionId: id })).rows;
    const until = async (want: boolean, ms = 3000) => {
      const end = Date.now() + ms;
      for (;;) {
        if (inputHolds(await rows(), target.text) === want) return true;
        if (Date.now() >= end) return false;
        await wait(150);
      }
    };
    try {
      const ups = all ? 1 : queued.length - k;
      for (let i = 0; i < ups; i++) {
        typeInto(id, '\x1b[A');
        await wait(80);
      }
      // On the pull-all path the Up brings the queue back by itself, and an
      // Enter would send it again, so Enter goes on the one path alone.
      if (!all) typeInto(id, '\r');
      if (!(await until(true))) {
        setRefusal('The terminal did not take the message back; Show the terminal to edit it');
        return;
      }
      // Ctrl+L, the keymap's chat:clearInput, leaves the text on 2.1.301
      // (read on a real session), so the input is emptied by Backspace,
      // one per character the pull put there and a few more; a Backspace
      // in an empty input does nothing.
      const pulled = texts.join('\n');
      typeInto(id, '\x7f'.repeat(pulled.length + 4));
      if (!(await until(false))) {
        setRefusal('The message is in the terminal\'s input; Show the terminal to clear it');
        return;
      }
      if (then === 'edit') {
        const el = boxRef.current;
        const now = el === null ? box : el.value;
        const next = now === '' ? texts.join('\n') : `${now}\n${texts.join('\n')}`;
        setBox(next);
        pendingCaret.current = next.length;
        el?.focus();
      }
    } catch (err) {
      console.warn('[emerald] queued take-back failed', err);
    } finally {
      takingRef.current = false;
      setTakingBack(false);
    }
  };
  // M9 fix 778: the text in Claude Code's input moved into the box, by
  // carryRead's rules: polled until it shows (or is blocked) within
  // CARRY_MS, emptied by Backspace as the take-back empties it, and put in
  // the box once the read is empty again. `expect` is the prompt Stop
  // knows; fix 784 calls this with none for text typed on the CLI face.
  // Nothing moves for a blocked input, and an input that will not empty
  // is left in the terminal with a refusal, the box untouched. `turn` is
  // Stop's stopped turn, for stopCarry's 'prompt': its prompt goes in the
  // box with the input left alone, since it is already empty.
  const carryingRef = useRef(false);
  const carryInput = async (expect: string | null = null, turn: StepTurn | null = null): Promise<boolean> => {
    if (carryingRef.current) return false;
    carryingRef.current = true;
    const id = session.id;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const read = async () => carryRead(await window.emerald.request('pty.screen', { sessionId: id }), expect);
    const toBox = (text: string) => {
      const el = boxRef.current;
      const was = el === null ? box : el.value;
      const next = was === '' ? text : `${was}\n${text}`;
      setBox(next);
      pendingCaret.current = next.length;
      el?.focus();
    };
    try {
      let now = await read();
      for (const end = Date.now() + CARRY_MS; now.kind === 'none' && Date.now() < end; ) {
        await wait(CARRY_POLL_MS);
        now = await read();
      }
      if (expect !== null && turn !== null && stopCarry(now, turn) === 'prompt') {
        toBox(expect);
        return true;
      }
      if (now.kind !== 'text') return false;
      const text = now.text;
      typeInto(id, '\x7f'.repeat(text.length + 4));
      let gone = false;
      for (const end = Date.now() + CARRY_MS; ; ) {
        await wait(CARRY_POLL_MS);
        if ((await read()).kind === 'none') {
          gone = true;
          break;
        }
        if (Date.now() >= end) break;
      }
      if (!gone) {
        setRefusal('The prompt is still in the terminal\'s input; Show the terminal to clear it');
        return false;
      }
      toBox(text);
      return true;
    } catch (err) {
      console.warn('[emerald] input carry failed', err);
      return false;
    } finally {
      carryingRef.current = false;
    }
  };
  // M9 fix 744: the model chip's menu, the models and a row of the effort
  // levels. A pick is typed as the box sends a prompt, but not through
  // send, whose terminal-command read would open the fallback bar for
  // `/model`. A picked effort shows until the status line or a later
  // assistant line says one.
  const modelChipRef = useRef<HTMLButtonElement>(null);
  const [modelMenu, setModelMenu] = useState<{ x: number; y: number } | null>(null);
  const [effortPick, setEffortPick] = useState<{ level: string; assistants: number; live: string | null } | null>(null);
  useEffect(() => setEffortPick(null), [session.id]);
  const openModelMenu = () => {
    const el = modelChipRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setModelMenu((open) => (open === null ? { x: r.left, y: r.top } : null));
  };
  const pickModel = (alias: string) => {
    setModelMenu(null);
    void sendPrompt(session.id, `/model ${alias}`).then((outcome) => {
      if (outcome.kind === 'refused') setRefusal(outcome.reason);
    });
  };
  const pickEffort = (level: string) => {
    setModelMenu(null);
    const live = session.effort ?? null;
    void sendPrompt(session.id, `/effort ${level}`).then((outcome) => {
      if (outcome.kind === 'refused') setRefusal(outcome.reason);
      else setEffortPick({ level, assistants: fedRef.current.effort.assistants, live });
    });
  };
  const shownEffort = effortShown(session.effort ?? null, fed.effort, effortPick);
  const modelText = modelChipText(contextWords(session), shownEffort);
  const modelMenuItems: Array<MenuItem | MenuHeading | MenuSegments> = [
    { heading: 'Model' },
    ...modelItems(session.model, MODEL_CHOICES).map(({ alias, name, line, checked }) => (alias === null ? { label: name, line, checked, disabled: true, onClick: () => {} } : { label: name, line, checked, onClick: () => pickModel(alias) })),
    {
      segments: 'Effort',
      separator: true,
      options: EFFORT_LEVELS.map((l) => ({ word: l, title: EFFORT_LINES[l], active: l === shownEffort, onPick: () => pickEffort(l) })),
    },
  ];
  const counts = teamCounts(session);
  const agentsText = agentChipText(counts);
  const rosterId = `chat-roster:${session.id}`;
  // A press on a chip leaves the keyboard where it was (the box), so a
  // chip is a click and never a stop on the way to typing.
  const keepKeys = (ev: React.MouseEvent) => ev.preventDefault();

  // M9 fix 714: what the timeline shows, kept per pane with the face; a
  // turn's fold opened by a click stays open until the mode changes.
  const { chatModes } = useUi();
  const view = chatModes.get(paneId) ?? 'normal';
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => setUnfolded(new Set()), [view]);
  const toggleFold = (i: number) => {
    const el = timelineRef.current;
    const target = el === null ? null : foldAnchorIn(el, i);
    anchor.current = el === null || target === null ? null : { turn: i, top: target.getBoundingClientRect().top - el.getBoundingClientRect().top };
    setUnfolded((open) => {
      const next = new Set(open);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const viewChipRef = useRef<HTMLButtonElement>(null);
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null);
  // M9 fix 785: the chip waits for something the mode changes; a /clear
  // empties the turns, and an open menu must not outlive its chip.
  const showViewChip = useMemo(() => viewChipShown(turns), [turns]);
  useEffect(() => {
    if (!showViewChip) setViewMenu(null);
  }, [showViewChip]);
  const openViewMenu = () => {
    const el = viewChipRef.current;
    if (el === null) return;
    const r = el.getBoundingClientRect();
    setViewMenu((open) => (open === null ? { x: r.left, y: r.top } : null));
  };
  const viewItems: Array<MenuItem | MenuHeading> = [
    { heading: 'What the timeline shows' },
    ...CHAT_MODES.map((m) => ({
      label: CHAT_MODE_WORDS[m],
      hint: VIEW_HINTS[m],
      checked: m === view,
      onClick: () => {
        setChatMode(paneId, m);
        setViewMenu(null);
      },
    })),
    { heading: 'Ctrl+O cycles them' },
  ];

  // M9 fix 743: the mode chip's menu, built as the view chip's is. A pick
  // presses Shift+Tab and reads the footer after each press until the mode
  // is reached (stepModeTo), one pick at a time; a pick made on another
  // session, or with the view gone, stops pressing.
  const modeChipRef = useRef<HTMLButtonElement>(null);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(null);
  const [modeMiss, setModeMiss] = useState<string | null>(null);
  const stepping = useRef(false);
  // The mode a pick is pressing towards (M9 fix 819): the chip shows it,
  // dimmed, rather than the modes the footer passes on the way.
  const [modePending, setModePending] = useState<string | null>(null);
  const busy = modePending !== null;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const sessionRef = useRef(session.id);
  sessionRef.current = session.id;
  useEffect(() => setModeMiss(null), [session.id]);
  const openModeMenu = () => {
    const el = modeChipRef.current;
    if (el === null || busy) return;
    const r = el.getBoundingClientRect();
    setModeMenu((open) => (open === null ? { x: r.left, y: r.top } : null));
  };
  const pickMode = (word: string) => {
    setModeMenu(null);
    setModeMiss(null);
    if (word === mode || stepping.current) return;
    stepping.current = true;
    setModePending(word);
    const id = session.id;
    void stepModeTo(word, {
      press: () => typeInto(id, '\x1b[Z'),
      // The pick's reads feed the view's own screen as well (M9 fix 819):
      // at four reads a second it settles before the view's one-second
      // poll has seen the mode, and the chip would read the old one until
      // that poll came round.
      read: async () => {
        const sentAt = Date.now();
        const res = await window.emerald.request('pty.screen', { sessionId: id });
        if (alive.current && sessionRef.current === id) setScreen({ rows: res.rows, cursor: res.cursor, ghost: res.ghost ?? null, sentAt });
        return res.rows;
      },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      cancelled: () => !alive.current || sessionRef.current !== id,
    }).then((got) => {
      stepping.current = false;
      if (!alive.current) return;
      setModePending(null);
      if (!got.reached && !got.cancelled) setModeMiss(`Could not reach ${word}`);
    });
  };
  const modeItems: Array<MenuItem | MenuHeading> = [
    { heading: 'Permission mode' },
    ...MODE_CHOICES.map(({ word, line }) => ({ label: word, line, checked: word === mode, onClick: () => pickMode(word) })),
  ];

  // M9 fix 721: an image goes into Claude Code's own prompt as a pasted
  // path (pastedPath: the probe found a typed path stays text and a
  // bracketed paste of it becomes `[Image #N]`), and a chip over the box
  // shows it, labelled with the number the prompt row gains. The chips go
  // on Send. The probe found neither Ctrl+L nor Escape clears the marker
  // and one Ctrl+C does, so the chips row's × sends one Ctrl+C once a
  // screen read shows a marker on the prompt row, and never while the
  // session works or asks (M9 fix 748); Escape and Stop leave the chips
  // alone.
  const [chips, setChips] = useState<{ id: number; thumb: string; n: number | null }[]>([]);
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  const nextChip = useRef(0);
  const sessionIdRef = useRef(session.id);
  sessionIdRef.current = session.id;
  const stateRef = useRef(session.state);
  stateRef.current = session.state;
  // With onMarker the chip is added only once a fresh marker shows on the
  // prompt row, and not at all if none comes in its 3 s (M9 fix 807).
  const addChip = (thumb: string, onMarker = false) => {
    nextChip.current += 1;
    const id = nextChip.current;
    if (!onMarker) setChips((c) => [...c, { id, thumb, n: null }]);
    const until = Date.now() + 3000;
    const look = () => {
      window.emerald
        .request('pty.screen', { sessionId: sessionIdRef.current })
        .then((res) => {
          const n = freshImage(res.rows, new Set(chipsRef.current.map((c) => c.n)));
          if (n !== null) setChips((c) => (onMarker ? [...c, { id, thumb, n }] : c.map((x) => (x.id === id ? { ...x, n } : x))));
          else if (Date.now() < until) setTimeout(look, 250);
        })
        .catch(() => {});
    };
    setTimeout(look, 250);
  };
  // An image dropped anywhere else on this pane was pasted into the prompt
  // by explorer-drop.ts, which says so with this event; the chip is all
  // that is left to do. While the view reads the session as asking the
  // paste went into the ask dialog, or into the prompt of a Claude Code that
  // closed the dialog before the store heard, so the chip comes only once a
  // fresh marker shows on the prompt row (M9 fixes 747 and 807).
  const addChipRef = useRef(addChip);
  addChipRef.current = addChip;
  useEffect(() => {
    const onImage = (ev: Event) => {
      const detail = (ev as CustomEvent<{ paneId?: unknown; path?: unknown }>).detail;
      if (detail?.paneId !== paneId || typeof detail.path !== 'string') return;
      addChipRef.current(fileHref(detail.path), askingRef.current);
    };
    window.addEventListener('emerald:chat-image', onImage);
    return () => window.removeEventListener('emerald:chat-image', onImage);
  }, [paneId]);
  // M9 fix 783: the × waits CHIP_SETTLE_MS after the session leaves
  // working or needs-input, since a Ctrl+C a moment after a turn's Stop
  // left the marker in Claude Code's prompt.
  const leftBusyAt = useRef(0);
  const [settling, setSettling] = useState(false);
  const busyNow = working || asking;
  const wasBusyForChips = useRef(busyNow);
  useEffect(() => {
    const was = wasBusyForChips.current;
    wasBusyForChips.current = busyNow;
    if (!was || busyNow) return;
    leftBusyAt.current = Date.now();
    setSettling(true);
    const timer = setTimeout(() => setSettling(false), CHIP_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [busyNow]);
  // The ×: one Ctrl+C, never a second within a click, since a Ctrl+C on an
  // empty prompt is the first half of Claude Code's exit; the read before
  // it is that guard. The box's words are React state and stay. The
  // Ctrl+C goes through sendCtrlC (fix 783), which waits out CTRL_C_GAP_MS
  // since the last one any renderer sender sent the session before it asks
  // `ready` here; the button shows it is working while it waits.
  const clearing = useRef(false);
  const [chipsBusy, setChipsBusy] = useState(false);
  const sessionBusy = () => stateRef.current === 'working' || stateRef.current === 'needs-input';
  const clearImages = async () => {
    if (clearing.current) return;
    clearing.current = true;
    setChipsBusy(true);
    try {
      const id = sessionIdRef.current;
      const sent = await sendCtrlC(id, async () => {
        // A click from before the settle time began waits it out.
        const settle = leftBusyAt.current + CHIP_SETTLE_MS - Date.now();
        if (settle > 0) await new Promise((r) => setTimeout(r, settle));
        if (sessionBusy()) return false;
        const before = await window.emerald.request('pty.screen', { sessionId: id });
        if (promptRowImages(before.rows).length === 0) {
          setChips([]);
          return false;
        }
        return !sessionBusy();
      });
      if (!sent) return;
      // Read again every 250 ms for two seconds, since a loaded box can
      // redraw the prompt late; the Ctrl+C is never sent twice.
      for (let waited = 0; waited < 2000; waited += 250) {
        await new Promise((r) => setTimeout(r, 250));
        const after = await window.emerald.request('pty.screen', { sessionId: id });
        if (promptRowImages(after.rows).length === 0) {
          setChips([]);
          return;
        }
      }
      console.warn('[emerald] the images stayed in the prompt after Ctrl+C');
    } catch {
      // A screen read that fails ends the click with the chips kept.
    } finally {
      clearing.current = false;
      setChipsBusy(false);
    }
  };
  // A file into the prompt: the path pasted, then its chip.
  const attachPath = (p: string, thumb: string) => {
    typeInto(session.id, pastedPath(p));
    addChip(thumb);
  };
  const attachClipboard = async () => {
    const r = await window.emerald.clipboard.image(IMAGE_PASTE_KEY !== null);
    if (r === null) return;
    if (r.path === null) {
      if (IMAGE_PASTE_KEY !== null) typeInto(session.id, IMAGE_PASTE_KEY);
      addChip(r.thumb);
    } else attachPath(r.path, r.thumb);
  };
  // The box never reads the clipboard itself, so under a harness it reads
  // the window's held one and never the person's: text goes in at the
  // caret, an image with no text goes into the prompt.
  const paste = async () => {
    const c = await window.emerald.clipboard.read();
    if (c.text !== null) {
      const el = boxRef.current;
      if (el !== null) replaceInBox(el.selectionStart, el.selectionEnd, c.text);
    } else if (c.image) await attachClipboard();
  };
  // A file from the paperclip or a drop on the box (M9 fix 746): an image
  // into Claude Code's prompt, anything else (a folder too) a mention at
  // the caret, with its absolute path when it is outside the folder.
  const takeFile = (p: string, kind: 'file' | 'dir') => {
    if (kind === 'file' && isImageName(p)) {
      attachPath(p, fileHref(p));
      return;
    }
    const el = boxRef.current;
    const from = el === null ? box.length : el.selectionStart;
    const to = el === null ? box.length : el.selectionEnd;
    void insertMention(p, from, to, kind === 'dir');
  };
  const attach = async () => {
    const p = await window.emerald.pickFile(session.cwd);
    if (p !== null) takeFile(p, 'file');
  };
  // The box's own right-click menu: Cut, Copy and Paste.
  const [boxMenu, setBoxMenu] = useState<{ x: number; y: number } | null>(null);
  const selection = () => {
    const el = boxRef.current;
    return el === null ? '' : el.value.slice(el.selectionStart, el.selectionEnd);
  };

  // A row picked: sent at once (a terminal row shows the fallback bar as
  // typing it does), or put in the box with a space for its arguments.
  // M9 fix 780: a command whose argument is required completes on Enter,
  // Tab or a click alike and sends nothing; Enter on the completed box
  // sends it, since a space closes the menu.
  const pickSlash = (row: SlashRow, how: 'send' | 'complete') => {
    if (how === 'send' && !row.argument) send(row.name);
    else {
      setBox(`${row.name} `);
      pendingCaret.current = row.name.length + 1;
    }
    boxRef.current?.focus();
  };

  const last = turns.length === 0 ? null : turns[turns.length - 1]!;
  const hint = refusal ?? modeMiss ?? hintText(session.state, queued.length);
  const exited = session.state === 'exited';
  return (
    <div
      className="chat-view"
      data-session-id={session.id}
      data-chat-view={view}
      data-exited={exited ? '' : undefined}
      // Escape anywhere in the view (the box included) goes to the
      // session, stopping a turn or leaving a menu, and closes the
      // fallback bar; the ask card handles its own. Ctrl+O cycles the
      // view mode (fix 714); it never reaches the pty, whose TUI takes
      // Ctrl+O for its own transcript.
      onKeyDown={(ev) => {
        if (ev.defaultPrevented) return;
        if (ev.code === 'KeyO' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
          ev.preventDefault();
          setChatMode(paneId, nextChatMode(view));
          return;
        }
        if (ev.key !== 'Escape') return;
        // M9 fix 847: a trust dialog takes Escape as No, exit, so the view
        // sends none while one is up; its answers are the card's buttons.
        if (asking && session.needsInputReason === 'trust') {
          ev.preventDefault();
          return;
        }
        ev.preventDefault();
        setFallback(null);
        stop();
      }}
    >
      <div
        className="chat-timeline"
        ref={timelineRef}
        // M9 fix 882: focusable, so a click on the conversation's text keeps
        // the keyboard in the view (Escape, Ctrl+O, PageUp and PageDown) and
        // leaves a selection as made.
        tabIndex={-1}
        // M9 fix 806: Copy on select here too, a selection in the
        // conversation copied as the left button is let go, a tick later
        // as the terminal waits for its drag to settle. Not in the ask
        // card's answer box, where selecting is editing.
        onMouseUp={(ev) => {
          if (ev.button !== 0 || !getUiState().copyOnSelect) return;
          if (ev.target instanceof Element && ev.target.closest('input, textarea') !== null) return;
          const timeline = ev.currentTarget;
          setTimeout(() => {
            const sel = window.getSelection();
            if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return;
            if (!timeline.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
            const text = sel.toString();
            if (text !== '') copyAndNote(text, paneId);
          }, 0);
        }}
        // M9 fix 849: Ctrl+C (the Edit menu's Copy) on a selection in the
        // conversation, through the window's clipboard and with its note,
        // as every copy out of a pane; the browser's own copy would write
        // the person's clipboard under a private home and say nothing.
        onCopy={(ev) => {
          if (ev.target instanceof Element && ev.target.closest('input, textarea') !== null) return;
          const sel = window.getSelection();
          if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return;
          if (!ev.currentTarget.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
          const text = sel.toString();
          if (text === '') return;
          ev.preventDefault();
          copyAndNote(text, paneId);
        }}
      >
        <div className="chat-column">
          {/* M9 fix 770: a transcript over 8 MB opens on its last 2 MB. */}
          {fed.cut && (
            <div className="chat-earlier">
              <span>Earlier turns are in the terminal</span>
              <button type="button" className="secondary" onClick={() => setChatFace(paneId, session.id, false)}>
                Show the terminal
              </button>
            </div>
          )}
          {turns.map((turn, i) => (
            <ChatTurn key={i} index={i} turn={turn} paneId={paneId} session={session} mode={view} open={unfolded.has(i)} onToggle={() => toggleFold(i)} />
          ))}
          {/* M9 fix 808: a starting Claude says so until its first word or its trust dialog. */}
          {session.state === 'starting' && <div className="chat-starting">{`Starting Claude in ${folderName(session.cwd) || session.cwd}…`}</div>}
          {asking && (session.needsInputReason === 'trust' ? <TrustCard session={session} screen={askScreen} rootRef={askRef} /> : <AskCard session={session} screen={askScreen} rootRef={askRef} paneId={paneId} edit={pendingEdit(turns)} />)}
          {working && (
            <div className="chat-live">
              <span className="chat-live-mark">
                {/* M9 fix 715: the state's tone, so the glyph wears the title row's colour in either skin. */}
                <SessionMark kind="claude" tone={describeState(session).tone} working size="unit" />
              </span>
              {liveWord !== null && <span className="chat-live-word">{liveWord}</span>}
              <span className="chat-live-time">
                {last?.at != null ? formatDuration(last.at, now) : ''}
                {spinner?.down != null ? ` · ↓${spinner.down}` : ''}
              </span>
            </div>
          )}
          {queued.length > 0 && (
            <div className="chat-queued-list">
              {queued.map((m, k) => (
                <div key={k} className="chat-queued" data-queued-index={k}>
                  <span className="chat-queued-mark">Queued</span>
                  <div className="chat-queued-text">{m.text}</div>
                  <button type="button" className="secondary chat-queued-edit" disabled={takingBack} onClick={() => void takeBack(k, 'edit')}>
                    Edit
                  </button>
                  {queuePath === 'one' && (
                    <button type="button" className="secondary chat-queued-remove" disabled={takingBack} onClick={() => void takeBack(k, 'remove')}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {shownPending.length > 0 && (
            <div className="chat-pending-list">
              {shownPending.map((p) => {
                const mark = pendingWords(p, now, quietSince.current);
                return (
                  <div key={p.id} className="chat-prompt-pending" data-pending={mark.state}>
                    <div className="chat-prompt-pending-text">{p.text}</div>
                    <span className="chat-prompt-pending-mark">{mark.words}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* M9 fix 849: a copy's note in the pane's bottom right, above the box. */}
      <div className="chat-note-row">
        <PaneNote paneId={paneId} />
      </div>
      {/* M9 fix 804: an exited session has no process to type to, so no box, chips or footer; the notice over the pane says how to resume. */}
      {!exited && (
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
          {chips.length > 0 && (
            <div className="chat-image-chips">
              {chips.map((c) => (
                <span key={c.id} className="chat-image-chip">
                  <img className="chat-image-chip-thumb" src={c.thumb} alt="" />
                  <span className="chat-image-chip-label">{c.n === null ? 'Image' : `Image #${c.n}`}</span>
                </span>
              ))}
              <button
                type="button"
                className="chat-image-chips-clear"
                title={chipsBusy ? 'Waiting for Claude Code' : "Remove the images (clears Claude Code's prompt; your text stays)"}
                aria-label="Remove the images"
                data-busy={chipsBusy ? 'true' : undefined}
                disabled={working || asking || settling}
                onMouseDown={keepKeys}
                onClick={() => void clearImages()}
              >
                ×
              </button>
            </div>
          )}
          <textarea
            ref={boxObserve}
            className="chat-box"
            rows={2}
            value={box}
            disabled={asking}
            placeholder={asking ? (session.needsInputReason === 'trust' ? 'Answer the trust question above' : 'Answer the ask above, or press Esc to cancel') : ghost ?? `${placeholderFirst}\n/ for commands · @ for a file`}
            data-ghost={ghost === null ? undefined : ''}
            onChange={(ev) => {
              setBox(ev.target.value);
              setCaret(ev.target.selectionStart);
              setRefusal(null);
            }}
            onSelect={(ev) => setCaret(ev.currentTarget.selectionStart)}
            onPaste={(ev) => {
              ev.preventDefault();
              void paste();
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              setBoxMenu({ x: ev.clientX, y: ev.clientY });
            }}
            // A file dropped on the box goes in as the attach button's does:
            // an image pasted into Claude Code's prompt, anything else (a
            // folder too) a mention at the caret (M9 fix 746).
            // explorer-drop.ts leaves a prevented drop alone, where it would
            // type the path as text.
            onDrop={(ev) => {
              const file = ev.dataTransfer.files[0];
              if (file === undefined || asking) return;
              const p = window.emerald.files.pathFor(file);
              if (p === '') return;
              ev.preventDefault();
              if (isImageName(p)) {
                takeFile(p, 'file');
                return;
              }
              window.emerald.files
                .stat(p)
                .then((st) => {
                  if ('error' in st) return;
                  takeFile(p, st.kind === 'dir' ? 'dir' : 'file');
                })
                .catch(() => {});
            }}
            onBlur={() => {
              if (slashShown) setSlashDismissed(box);
              if (mentionShown) setMentionDismissed(mentionKey);
            }}
            onKeyDown={(ev) => {
              // Ctrl+V (a dictation tool's code-less one too) and Alt+V,
              // Claude Code's own image key on Windows, paste through
              // main (M9 fix 721).
              if (isPasteKey(ev) || (ev.altKey && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey && ev.code === 'KeyV')) {
                ev.preventDefault();
                void paste();
                return;
              }
              // While a menu shows, the arrows, Enter, Tab and Escape are
              // its (M9 fixes 719 and 720); Escape prevented here never
              // reaches the session through the view's handler.
              const menu = slashShown && slashPick !== undefined
                ? { n: slashFiltered.length, move: setSlashActive, enter: () => pickSlash(slashPick, 'send'), tab: () => pickSlash(slashPick, 'complete'), close: () => setSlashDismissed(box) }
                : mentionShown && mentionPick !== undefined
                  ? { n: mentionRows.length, move: setMentionActive, enter: () => pickMention(mentionPick), tab: () => pickMention(mentionPick), close: () => setMentionDismissed(mentionKey) }
                  : null;
              if (menu !== null && !ev.nativeEvent.isComposing && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
                const { n } = menu;
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                  ev.preventDefault();
                  menu.move((a) => (Math.min(a, n - 1) + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n);
                  return;
                }
                if ((ev.key === 'Enter' || ev.key === 'Tab') && !ev.shiftKey) {
                  ev.preventDefault();
                  if (ev.key === 'Enter') menu.enter();
                  else menu.tab();
                  return;
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  menu.close();
                  return;
                }
              }
              // M9 fix 779: Tab or the Right arrow in the empty box takes
              // the suggestion, as in the terminal; nothing goes to the pty,
              // since the send replaces whatever Claude Code's input holds.
              if ((ev.key === 'Tab' || ev.key === 'ArrowRight') && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.nativeEvent.isComposing && box === '' && ghost !== null) {
                ev.preventDefault();
                setBox(ghost);
                pendingCaret.current = ghost.length;
                return;
              }
              // M9 fix 754: a bare Up in the empty box with messages queued
              // takes the newest back to edit, as Up does in the terminal.
              if (ev.key === 'ArrowUp' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.nativeEvent.isComposing && box === '' && !asking && !takingBack && queued.length > 0) {
                ev.preventDefault();
                void takeBack(queued.length - 1, 'edit');
                return;
              }
              // Enter is the box's and Escape the view's (above); every
              // other key passes, so the window's chords (Ctrl+O among
              // them) still work from in here.
              if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                ev.preventDefault();
                send();
              }
            }}
          />
          {slashShown && <SlashMenu box={boxRef.current} rows={slashFiltered} active={Math.min(slashActive, slashFiltered.length - 1)} onPick={(row) => pickSlash(row, 'send')} onHover={setSlashActive} onClose={() => setSlashDismissed(box)} />}
          {mentionShown && mention !== null && <MentionMenu box={boxRef.current} dir={mention.dir} rows={mentionRows} active={Math.min(mentionActive, mentionRows.length - 1)} onPick={pickMention} onHover={setMentionActive} onClose={() => setMentionDismissed(mentionKey)} />}
          {boxMenu !== null && (
            <Menu
              x={boxMenu.x}
              y={boxMenu.y}
              className="chat-box-menu"
              onClose={() => setBoxMenu(null)}
              items={[
                {
                  label: 'Cut',
                  hint: 'Ctrl+X',
                  disabled: selection() === '',
                  onClick: () => {
                    setBoxMenu(null);
                    const el = boxRef.current;
                    if (el === null) return;
                    void window.emerald.clipboard.write(selection());
                    replaceInBox(el.selectionStart, el.selectionEnd, '');
                  },
                },
                {
                  label: 'Copy',
                  hint: 'Ctrl+C',
                  disabled: selection() === '',
                  onClick: () => {
                    setBoxMenu(null);
                    void window.emerald.clipboard.write(selection());
                  },
                },
                {
                  label: 'Paste',
                  hint: 'Ctrl+V',
                  onClick: () => {
                    setBoxMenu(null);
                    void paste();
                  },
                },
              ]}
            />
          )}
          <div className="chat-foot">
            <button type="button" className="chat-attach" title="Attach a file" aria-label="Attach a file" disabled={asking} onClick={() => void attach()}>
              <PaperclipIcon />
            </button>
            {(mode !== null || modePending !== null) && (
              <button
                ref={modeChipRef}
                type="button"
                className="chat-chip"
                data-chip="mode"
                data-open={modeMenu !== null || undefined}
                data-busy={busy || undefined}
                onMouseDown={keepKeys}
                title={modePending !== null ? `Switching to ${modePending}` : 'Permission mode; pick one from the list'}
                onClick={openModeMenu}
              >
                <span className="chat-chip-word">{modePending ?? mode}</span>
                <span className="chat-chip-caret" aria-hidden="true">
                  <ChevronIcon />
                </span>
              </button>
            )}
            {modeMenu !== null && (
              <Menu x={modeMenu.x} y={modeMenu.y} above items={modeItems} onClose={() => setModeMenu(null)} className="chat-mode-menu" data={{ menu: 'chat-mode' }} anchor={modeChipRef.current} />
            )}
            {modelText !== null && (
              <button
                ref={modelChipRef}
                type="button"
                className="chat-chip"
                data-chip="model"
                data-open={modelMenu !== null || undefined}
                onMouseDown={keepKeys}
                title="Model and effort. A model pick is saved as your default for new sessions, as /model does."
                onClick={openModelMenu}
              >
                <span className="chat-chip-word">{modelText}</span>
                <span className="chat-chip-caret" aria-hidden="true">
                  <ChevronIcon />
                </span>
              </button>
            )}
            {modelMenu !== null && (
              <Menu x={modelMenu.x} y={modelMenu.y} above items={modelMenuItems} onClose={() => setModelMenu(null)} className="chat-model-menu" data={{ menu: 'chat-model' }} anchor={modelChipRef.current} />
            )}
            {rc !== null && (
              <button
                type="button"
                className="chat-chip chat-chip-plain"
                data-chip="rc"
                data-state={rc.state}
                onMouseDown={keepKeys}
                title={rcUrl ?? 'Remote Control; its link is in the terminal'}
                onClick={(ev) => {
                  // M9 fix 923: with no connect line read (one past the read
                  // cap, fix 770) the link is in the terminal, so the click
                  // shows it there, as the title says.
                  if (rcUrl !== null) openWebLink(rcUrl, paneId, ev.ctrlKey);
                  else setChatFace(paneId, session.id, false);
                }}
              >
                <span className="chat-chip-dot" data-state={rc.state} />
                <span className="chat-chip-word">{rc.word}</span>
              </button>
            )}
            {showViewChip && (
              <button ref={viewChipRef} type="button" className="chat-chip" data-chip="view" data-open={viewMenu !== null || undefined} onMouseDown={keepKeys} title="What the timeline shows (Ctrl+O)" onClick={openViewMenu}>
                <span className="chat-chip-word">{CHAT_MODE_WORDS[view]}</span>
                <span className="chat-chip-caret" aria-hidden="true">
                  <ChevronIcon />
                </span>
              </button>
            )}
            {showViewChip && viewMenu !== null && (
              <Menu x={viewMenu.x} y={viewMenu.y} above items={viewItems} onClose={() => setViewMenu(null)} className="chat-view-menu" data={{ menu: 'chat-view' }} anchor={viewChipRef.current} />
            )}
            {agentsText !== null && (
              <PopoverAnchor
                id={rosterId}
                className="chat-chip chat-chip-plain"
                data={{ 'data-chip': 'agents' }}
                card={(props) => <RosterCard counts={counts} members={session.team} anchorId={rosterId} {...props} />}
              >
                <span className="chat-chip-dot" data-state={counts.out > 0 ? 'out' : 'returned'} />
                <span className="chat-chip-word">{agentsText}</span>
              </PopoverAnchor>
            )}
            {(diff.added > 0 || diff.removed > 0) && (
              <button type="button" className="chat-chip chat-chip-plain" data-chip="diff" title="Review changes" onClick={() => openReviewTab(session.id, undefined, 'session')}>
                <span className="chat-chip-word">
                  <span className="chat-added">+{diff.added}</span> <span className="chat-removed">{'−'}{diff.removed}</span>
                </span>
              </button>
            )}
            <span className="chat-hint">{hint}</span>
            {working && (
              <button type="button" className="secondary chat-stop" title="Sends Escape to the session" onClick={stop}>
                Stop
              </button>
            )}
            <button type="button" className="chat-send" disabled={(box.trim() === '' && chips.length === 0) || asking} onClick={() => send()}>
              Send ⏎
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

interface Screen {
  rows: string[];
  cursor: { x: number; y: number };
  // The prompt row's dim run (M9 fix 779), absent from an older daemon.
  ghost?: { y: number; x: number; text: string } | null;
}

// M9 fix 690: the ask as a card on the rail, read off the screen as the
// sidebar's card is (AnswerPopover.tsx, which stays its own; both build
// on screen-prompt-model.ts). The digits press the option of that key,
// Escape cancels, and a question gets a box. Since fix 713 the screen is
// the view's one read, null until a read sent after the ask came up.
// Since fix 801 it takes one press per dialog: a sent card dims and keeps
// what it answered until a read after the press shows another dialog, or
// the same one ASK_PRESS_RETRY_MS on, and never opens its box after a
// press. Since fix 845 a multi-select has a Submit button (Enter on the
// card presses it), which sends the Downs to Claude Code's Submit row and
// Enter. Since fix 879 the Review your answers tab draws as a review, each
// question with its answer, its Submit answers and Cancel pressed by their
// digits. Since fix 880 an ask answered elsewhere (the terminal face, the
// sidebar's card) dims the card on what was asked, as its own press would.
// Since fix 922 every tab but the current one is a button that moves the
// dialog there, and the card keeps the tab it moved to as current while the
// dialog draws its question.
function AskCard({ session, screen, rootRef, paneId, edit }: { session: SessionInfo; screen: (Screen & { sentAt: number }) | null; rootRef: React.RefObject<HTMLDivElement | null>; paneId: string; edit: PendingEdit | null }) {
  // M9 fix 717: a permission for the Edit the transcript wrote last is the
  // edit card, its file a path link like any other.
  const links = usePathLinks(paneId);
  // M9 fix 777: an AskUserQuestion drawn as the terminal draws it, its
  // tabs, its question and each option's description, with no box; since
  // fix 803 its Type something row is an input that sends a free answer,
  // and Chat about this is answered by its digit.
  const [pressed, setPressed] = useState<(AskPress & { screen: (Screen & { sentAt: number }) | null }) | null>(null);
  // A sent card draws what it answered until the press is over.
  const shown = pressed !== null ? pressed.screen : screen;
  useEffect(() => {
    if (pressed !== null && screen !== null && pressOver(pressed, screen)) setPressed(null);
  }, [screen, pressed]);
  // M9 fix 880: the last dialog this needs-input spell drew, so a read with
  // none is told apart as the ask answered elsewhere.
  const lastDialog = useRef<{ spell: number; key: string; screen: Screen & { sentAt: number } } | null>(null);
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
  const review = shown === null ? null : askReview(shown.rows);
  const ask = shown === null || review !== null ? null : askQuestion(shown.rows);
  // M9 fix 922: the tab a click moved the dialog to, read against the live
  // screen rather than the one a press holds, so it lands on the read that
  // draws its question; the card draws it as current from there.
  const [visit, setVisit] = useState<AskVisit | null>(null);
  const liveVisit = visit === null || screen === null ? visit : visitAfter(visit, { question: askQuestion(screen.rows)?.question ?? null, dialog: dialogKey(screen.rows, screen.cursor) !== null, pressing: pressed !== null });
  useEffect(() => {
    if (liveVisit !== visit) setVisit(liveVisit);
  }, [liveVisit, visit]);
  const askTabs = ask === null ? [] : visitedTabs(ask.tabs, liveVisit);
  const editCard = edit !== null && session.needsInputReason === 'permission' && ask === null && review === null ? edit : null;
  const [answer, setAnswer] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const excerpt = shown === null ? [] : promptExcerpt(shown.rows, shown.cursor);
  const options: (AnswerOption | AskOption)[] = review?.options ?? ask?.options ?? (shown === null ? [] : answerOptions(shown.rows));
  // M9 fix 879: a dialog with a Cancel of its own (the review's) draws no
  // second one; Escape there cancels the ask as Cancel does (read on
  // 2.1.302), and the card's Escape key still sends it.
  const escShown = !options.some((o) => o.label === 'Cancel');
  // Not before the first read, or the box would take the keyboard and go
  // with it the moment the options are read.
  const askText = screen !== null && askBoxShown({ reason: session.needsInputReason, recognised: ask !== null || review !== null, options: options.length, pressed: pressed !== null, askedFor: session.askedFor });
  const send = (data: string) => {
    typeInto(session.id, data);
    // An answer is a look at the row, as a click in the pane would be.
    acknowledgeAttention(session.id);
    void ackIfDone(session.id);
  };
  // One press per dialog: a second press before the dialog moves would
  // reach whatever the terminal draws next (a digit typed into Claude's
  // empty prompt).
  const press = (data: string) => {
    if (pressed !== null) return;
    send(data);
    setPressed({ at: Date.now(), key: shown === null ? null : dialogKey(shown.rows, shown.cursor), screen: shown });
  };
  const sentMark = pressed !== null ? 'true' : undefined;
  // M9 fix 803: the Type something row's input, seeded with the field's
  // text off the screen whenever the dialog changes.
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
  // The free answer is a press: nothing ends it while its keys go in (the
  // field's own label changes under them), and a read sent after they are
  // in ends it as any press; a row the pointer never reached frees the
  // card, the text kept in the input.
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
  // M9 fix 845: a multi-select's Submit button, a press in sendFree's shape.
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
  // M9 fix 922: a tab's press, from the current tab (a landed visit's, else
  // the inferred one; Submit on the review) to it, off the Type something
  // field first (an Up, as optionKeys sends), where the arrows would move
  // its caret.
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
  // An option's press; a single-select's answer moves the dialog on one
  // tab, and a landed visit with it.
  const pressOption = (key: string) => {
    if (pressed !== null) return;
    if (ask !== null && !ask.multi) setVisit(visitAnswered(liveVisit));
    press(optionKeys(ask, key));
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
        // M9 fix 959: the tab keys, one tab per key, each prevented so a
        // Tab never walks the focus out of the card. The review is the
        // last tab: back is the Left it always sent (read on 2.1.302), on
        // is nothing.
        const tabStep = tabKeyStep(ev.key, ev.shiftKey);
        if (tabStep !== 0 && review !== null) {
          ev.preventDefault();
          if (tabStep < 0) press('\x1b[D');
          return;
        }
        if (tabStep !== 0 && ask !== null && askTabs.length > 0) {
          ev.preventDefault();
          const to = tabStepTo(askTabs, tabStep);
          if (to !== null) pressTab(askTabs, to);
          return;
        }
        if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          press('\x1b');
        } else if (ev.key === 'Enter' && submitShown) {
          ev.preventDefault();
          pressSubmit();
        } else if (/^[1-9]$/.test(ev.key) && freeOpt !== null && freeOpt.key === ev.key) {
          // The free row's digit takes the keyboard to its input.
          ev.preventDefault();
          freeRef.current?.focus();
        } else if (/^[1-9]$/.test(ev.key) && options.some((o) => o.key === ev.key)) {
          ev.preventDefault();
          pressOption(ev.key);
        }
      }}
    >
      <div className="chat-ask" {...links.handlers}>
        {editCard !== null ? (
          <EditCardHead session={session} edit={editCard} />
        ) : review !== null ? (
          <>
            <div className="chat-ask-heading">{askHeading(session.needsInputReason, shown?.rows)}</div>
            {review.tabs.length > 0 && <AskTabs tabs={review.tabs} prefix="chat-ask" sent={pressed !== null} onPress={(to) => pressTab(review.tabs, to)} />}
            <div className="chat-ask-question">Review your answers</div>
            {review.warning !== null && <div className="chat-ask-review-warning">{review.warning}</div>}
            <div className="chat-ask-review">
              {review.items.map((item, i) => (
                <div key={i} className="chat-ask-review-item">
                  <span className="chat-ask-review-q">{item.question}</span>
                  <span className="chat-ask-review-a">{item.answer}</span>
                </div>
              ))}
            </div>
          </>
        ) : ask !== null ? (
          <>
            <div className="chat-ask-heading">{askHeading(session.needsInputReason, shown?.rows)}</div>
            {askTabs.length > 0 && <AskTabs tabs={askTabs} prefix="chat-ask" sent={pressed !== null} onPress={(to) => pressTab(askTabs, to)} />}
            <div className="chat-ask-question">{ask.question}</div>
          </>
        ) : (
          <>
            <div className="chat-ask-heading">{askHeading(session.needsInputReason, shown?.rows)}</div>
            <pre className="chat-ask-screen" data-rows={excerpt.length}>
              {shown === null ? 'Reading the screen…' : excerpt.length === 0 ? '(nothing drawn at the cursor)' : excerpt.join('\n')}
            </pre>
          </>
        )}
        <div className="chat-ask-options">
          {options.map((o) =>
            freeOpt !== null && o.key === freeOpt.key ? (
              <div
                key={o.key}
                className="chat-ask-option chat-ask-free"
                data-key={o.key}
                data-sent={sentMark}
                onClick={(ev) => {
                  if (ev.target !== freeRef.current) freeRef.current?.focus();
                }}
              >
                <span className="chat-ask-key">{o.key}</span>
                <input
                  ref={freeRef}
                  className="chat-ask-free-input"
                  placeholder="Type something"
                  title="Sends this answer to the session"
                  value={free}
                  onChange={(ev) => setFree(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Escape') {
                      ev.preventDefault();
                      ev.stopPropagation();
                      press('\x1b');
                    } else if (ev.key === 'Enter') {
                      ev.preventDefault();
                      ev.stopPropagation();
                      // In a multi-select the first Enter types the text
                      // (which ticks the row) and the next one, the field
                      // already reading it, submits (fix 845).
                      if (submitShown && freeOpt !== null && freeText(freeOpt) === free) pressSubmit();
                      else sendFree();
                    }
                  }}
                />
              </div>
            ) : (
              <button key={o.key} type="button" className="chat-ask-option" data-key={o.key} data-pointer={'pointer' in o && o.pointer ? 'true' : undefined} data-sent={sentMark} title={`Sends ${o.key} to the session`} onClick={() => pressOption(o.key)}>
                <span className="chat-ask-key">{o.key}</span>
                <span className="chat-ask-text">
                  <span className="chat-ask-label">{o.label}</span>
                  {'description' in o && o.description !== '' && <span className="chat-ask-desc">{o.description}</span>}
                </span>
              </button>
            ),
          )}
          {submitShown && ask.submit !== null && (
            <button type="button" className="chat-ask-option chat-ask-submit" data-key="submit" data-pointer={ask.submit.pointer ? 'true' : undefined} data-sent={sentMark} title="Submits the ticked answers" onClick={pressSubmit}>
              <span className="chat-ask-key">Enter</span>
              <span className="chat-ask-label">{ask.submit.label}</span>
            </button>
          )}
          {escShown && (
            <button type="button" className="chat-ask-option chat-ask-esc" data-key="esc" data-sent={sentMark} title="Sends Escape to the session" onClick={() => press('\x1b')}>
              <span className="chat-ask-key">Esc</span>
              <span className="chat-ask-label">Cancel</span>
            </button>
          )}
          {review !== null && (
            <button type="button" className="chat-ask-option chat-ask-back" data-key="back" data-sent={sentMark} title="Sends ← to the session, back to the questions" onClick={() => press('\x1b[D')}>
              <span className="chat-ask-key">←</span>
              <span className="chat-ask-label">Back</span>
            </button>
          )}
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
                press('\x1b');
              }
              if (ev.key === 'Enter' && answer.trim() !== '') {
                ev.preventDefault();
                press(`${answer}\r`);
                setAnswer('');
              }
            }}
          />
        )}
        {links.menu}
      </div>
    </div>
  );
}

// M9 fix 752: the step a fold toggle keeps in place, inside the turn with
// this index: the last reply after the turn's fold row, else the fold row.
// Closed, the fold stands before the first text after the first call;
// open, at the first call; so the replies after it are the same steps
// either way, and no node identity is needed (the rows remount).
// Several fold rows (fix 797) open and close together; the first one is
// the anchor.
function foldAnchorIn(timeline: Element, turn: number): HTMLElement | null {
  const turnEl = timeline.querySelector(`.chat-turn[data-turn-index=${JSON.stringify(String(turn))}]`);
  const rail = turnEl?.querySelector(':scope > .chat-rail');
  if (rail === null || rail === undefined) return null;
  const rows = [...rail.children];
  const at = rows.findIndex((r) => r.classList.contains('chat-fold'));
  if (at < 0) return null;
  const replies = rows.slice(at + 1).filter((r): r is HTMLElement => r instanceof HTMLElement && r.classList.contains('chat-reply'));
  return replies[replies.length - 1] ?? (rows[at] as HTMLElement);
}

function ChatTurn({ index, turn, paneId, session, mode, open, onToggle }: { index: number; turn: StepTurn; paneId: string; session: SessionInfo; mode: ChatMode; open: boolean; onToggle: () => void }) {
  const when = timeOf(turn.at);
  const length = turn.at !== null && turn.endAt !== null ? formatDuration(turn.at, turn.endAt) : null;
  const stamp = when !== null || length !== null ? [when, length].filter((x) => x !== null).join(' · ') : null;
  // M9 fix 958: a bash run stands where the prompt would, so its head shows the turn's time and length.
  const bashStamp = turn.prompt === '' && turn.steps[0]?.kind === 'bash' ? stamp : null;
  const links = usePathLinks(paneId);
  const bare = imageOnlyPrompt(turn.prompt, turn.images);
  const items = timelineItems(turn.steps, mode, open);
  return (
    <div className="chat-turn" data-turn-index={index} {...links.handlers}>
      {/* M9 fix 798: a bare turn holds a command's note made before the first prompt. */}
      {turn.prompt !== '' && (
        <div className="chat-prompt-row">
          <div className="chat-prompt" data-bare={bare ? '' : undefined}>
            {bare ? null : turn.prompt}
            <PromptImages images={turn.images} />
          </div>
          {stamp !== null && <span className="chat-prompt-time">{stamp}</span>}
        </div>
      )}
      {turn.steps.length > 0 && (
        <div className="chat-rail">
          {/* An image result's thumbnail follows its tool row, and in a
              folded mode the closed fold's images item (M9 fix 717). */}
          {items.map((item, i) =>
            item.kind === 'fold' ? (
              <ChatFold key={i} fold={item} onToggle={onToggle} />
            ) : item.kind === 'images' ? (
              <Fragment key={i}>
                {item.steps.map((step, j) => (
                  <ChatThumbRow key={j} step={step} />
                ))}
              </Fragment>
            ) : (
              <Fragment key={i}>
                <ChatStep step={item.step} paneId={paneId} session={session} time={item.step === turn.steps[0] ? bashStamp : null} />
                <ChatThumbRow step={item.step} />
              </Fragment>
            ),
          )}
        </div>
      )}
      {links.menu}
    </div>
  );
}

// M9 fix 714: a turn's tool calls folded into one row; a click opens it.
// Fix 753: the row wears the folded calls' tone (foldTone) on data-tone, in its text since fix 891. Fix 797: one
// row per stretch, under Claude Code's own sentence (foldText).
function ChatFold({ fold, onToggle }: { fold: FoldItem; onToggle: () => void }) {
  return (
    <button type="button" className="chat-step chat-fold" data-kind="fold" data-tone={fold.tone} data-open={fold.open || undefined} onClick={onToggle}>
      <span className="chat-fold-text">{fold.text}</span>
      {fold.added + fold.removed > 0 && (
        <>
          {' '}
          <span className="chat-added">+{fold.added}</span> <span className="chat-removed">{'−'}{fold.removed}</span>
        </>
      )}{' '}
      <span className="chat-fold-caret">{fold.open ? '⌄' : '›'}</span>
    </button>
  );
}

function ChatStep({ step, paneId, session, time }: { step: Step; paneId: string; session: SessionInfo; time: string | null }) {
  if (step.kind === 'thinking') {
    return (
      <div className="chat-step" data-kind="thinking">
        <div className="chat-thinking-head">{step.ms === null ? 'Thought' : `Thought for ${Math.round(step.ms / 1000)}s`}</div>
        {step.text.trim() !== '' && <div className="chat-thinking-text">{step.text}</div>}
      </div>
    );
  }
  if (step.kind === 'text' || step.kind === 'update') {
    return <ChatReply step={step} paneId={paneId} session={session} />;
  }
  if (step.kind === 'command') {
    // M9 fix 798: what a command printed, its first line as a centred
    // divider across the rail, the whole of it in the tooltip.
    const [first = ''] = step.text.split('\n');
    // M9 fix 889: remote control's connect line carries its URL, drawn as
    // a link in place in the first line, or after it when the line lacks it.
    const url = step.url;
    let text: ReactNode = first;
    if (url !== undefined) {
      const at = first.indexOf(url);
      const link = (
        <a className="chat-command-note-link" href={url}>
          {url}
        </a>
      );
      text =
        at >= 0 ? (
          <>
            {first.slice(0, at)}
            {link}
            {first.slice(at + url.length)}
          </>
        ) : (
          <>
            {first} {link}
          </>
        );
    }
    return (
      <div className="chat-step chat-command-note" data-kind="command" data-url={url} title={step.text}>
        <span className="chat-command-note-text">{text}</span>
      </div>
    );
  }
  if (step.kind === 'compact') return <ChatCompact step={step} />;
  if (step.kind === 'bash') return <ChatBash step={step} time={time} />;
  if (step.kind === 'note') {
    return (
      <div className="chat-step chat-note" data-kind="note">
        {step.text}
      </div>
    );
  }
  if (step.kind === 'queued') {
    // M9 fix 754: a message Claude read mid-turn, a small bubble in place.
    const when = timeOf(step.at);
    return (
      <div className="chat-step chat-queued-step" data-kind="queued">
        <div className="chat-queued-bubble">{step.text}</div>
        <span className="chat-queued-time">{when === null ? 'sent mid-turn' : `sent mid-turn · ${when}`}</span>
      </div>
    );
  }
  if (step.kind === 'notification') {
    // M9 fix 805: a task's end, an agent's report or another session's
    // message as one line; the output link opens like any chat path.
    return (
      <div className="chat-step chat-notification" data-kind="notification" data-source={step.source} data-tone={step.tone}>
        <span className="chat-notification-text" title={step.title}>
          {step.text}
        </span>
        {step.output !== null && (
          <>
            {' · '}
            <span className="chat-path chat-notification-output" data-path={resolveIn(session.cwd, step.output)} title={step.output}>
              output
            </span>
          </>
        )}
      </div>
    );
  }
  const tone = step.result === null ? 'pending' : step.result.error ? 'error' : 'done';
  const result = resultText(step);
  const counts = /^\+(\d+) −(\d+)$/.exec(result);
  // M9 fix 717: a file the call names is a path link, in the folder or
  // not, there or not; a pattern or a command stays plain.
  const named = typeof step.input['file_path'] === 'string' ? step.input['file_path'] : typeof step.input['notebook_path'] === 'string' ? step.input['notebook_path'] : null;
  const linked = named === null ? null : resolveIn(session.cwd, named);
  // M9 fix 797: a shell call's description on the row, the command dim
  // under it, as Claude Code draws them.
  const words = shellWords(step);
  return (
    <div className="chat-step" data-kind="tool" data-tool={step.name} data-tone={tone} data-described={words === null ? undefined : ''}>
      <span className="chat-tool-name">{step.name}</span>
      <span className={linked === null ? 'chat-tool-arg' : 'chat-tool-arg chat-path'} data-path={linked ?? undefined} title={step.arg}>
        {words ?? step.arg}
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
      {words !== null && (
        <div className="chat-tool-command" title={step.arg}>
          {step.arg}
        </div>
      )}
    </div>
  );
}
