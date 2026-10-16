import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { contextWords, describeState, effortOf, formatDuration, parseSteps, queuedOf, resultText, teamCounts } from '@emerald/shared';
import type { SessionInfo, Step, StepTurn } from '@emerald/shared';
import { ackIfDone, sendPrompt, typeInto } from './actions.ts';
import { CHAT_MODES, CHAT_MODE_WORDS, CHAT_REREAD_MS, EFFORT_LEVELS, EFFORT_LINES, FALLBACK_ON_GROWTH, IMAGE_PASTE_KEY, MODEL_CHOICES, MODE_CHOICES, QUEUE_PICK, SCREEN_READ_MS, agentChipText, askHeading, effortShown, fileHref, filterMention, filterSlash, foldText, hintText, inputHolds, isImageName, mentionQuery, mentionText, modelChipText, modeOf, nextChatMode, opensMenu, pastedPath, promptRowImages, relativeMention, sessionDiff, slashQuery, slashRows, spinnerOf, stepModeTo, timelineItems } from './chat-model.ts';
import type { ChatMode, FoldItem, SlashRow } from './chat-model.ts';
import { ChevronIcon, MentionMenu, PaperclipIcon, SlashMenu } from './ChatMenus.tsx';
import { isPasteKey } from './keys-model.ts';
import type { MentionRow } from './ChatMenus.tsx';
import type { SkillEntry } from '../../preload/api.ts';
import { parentPath } from './files-model.ts';
import { ChatReply, ChatThumbRow, EditCardHead, PromptImages, usePathLinks } from './ChatParts.tsx';
import { pendingEdit } from './chat-hunk.ts';
import type { PendingEdit } from './chat-hunk.ts';
import { resolveIn } from './chat-paths.ts';
import { Menu } from './Menu.tsx';
import type { MenuHeading, MenuItem, MenuSegments } from './Menu.tsx';
import { PopoverAnchor } from './Popover.tsx';
import { RosterCard } from './roster.tsx';
import { answerOptions, promptExcerpt } from './screen-prompt-model.ts';
import { SessionMark } from './session-mark.tsx';
import { acknowledgeAttention, openReviewTab, setChatFace, setChatMode, useUi } from './ui.ts';

// M9 fix 689: a Claude session's chat face, the conversation drawn from
// its transcript over the same session, with a box that types into it.
// It sits inside the pane's .term-wrap after the terminal, which stays
// mounted under it (hidden, never refit), so the shade, the wait overlay
// and the exited notice still draw over this face as they do over the
// terminal. Story 1 draws every step (Verbose). Since fix 713 the footer
// under the box carries story 2's chips: the permission mode, the model
// with its effort, the agents out and returned, and the lines changed.

type Read = { text: string } | { error: string } | null;

// The box grows from two rows to this many before it scrolls.
const BOX_MAX_LINES = 8;
const BOX_LINE_PX = 18;
// The least time between two Ctrl+Cs the image chips' × sends (M9 fix 748).
const CTRL_C_GAP_MS = 2000;
// The scroll sticks to the end while the person is within this of it.
const STICK_PX = 24;
// The view menu's words beside each mode (M9 fix 714).
const VIEW_HINTS: Readonly<Record<ChatMode, string>> = { normal: 'steps folded', thinking: 'and the thinking', verbose: 'every step' };

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
          else if ('error' in r) {
            if (r.error.startsWith('Too large')) setRead({ error: r.error });
            // M9 fix 722: any other error (the transcript not written yet, a
            // read caught mid-write) keeps what is drawn; the next change push
            // reads again, and a folder's first watch sends one
            // (folder-watchers.ts).
          } else setRead({ error: 'Not a text file' });
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

  // M9 fix 754: the person's messages queued behind the turn. An idle,
  // done or exited session shows none, so a queue a crash left behind
  // never lingers.
  const queued = useMemo(() => (session.state === 'working' || session.state === 'needs-input' ? queuedOf(text) : []), [text, session.state]);

  const effort = useMemo(() => effortOf(text), [text]);
  const diff = useMemo(() => sessionDiff(turns), [turns]);

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
          if (live) setScreen({ rows: res.rows, cursor: res.cursor, sentAt });
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
  const mode = screen === null ? null : modeOf(screen.rows);
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

  // The words go after the images already in Claude Code's prompt, so a
  // send with only chips is a send too.
  const send = (text = box) => {
    const prompt = text;
    if ((prompt.trim() === '' && chipsRef.current.length === 0) || asking) return;
    setModeMiss(null);
    setBox('');
    setChips([]);
    const menu = opensMenu(prompt);
    void sendPrompt(session.id, prompt).then((outcome) => {
      if (outcome.kind === 'refused') setRefusal(outcome.reason);
      else if (menu) setFallback({ length: textRef.current.length });
    });
  };
  const stop = () => typeInto(session.id, '\x1b');
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
  // M9 fix 744: the model chip's menu, the models and a row of the effort
  // levels. A pick is typed as the box sends a prompt, but not through
  // send, whose terminal-command read would open the fallback bar for
  // `/model`. A picked effort shows until a later assistant line says one.
  const modelChipRef = useRef<HTMLButtonElement>(null);
  const [modelMenu, setModelMenu] = useState<{ x: number; y: number } | null>(null);
  const [effortPick, setEffortPick] = useState<{ level: string; length: number } | null>(null);
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
    void sendPrompt(session.id, `/effort ${level}`).then((outcome) => {
      if (outcome.kind === 'refused') setRefusal(outcome.reason);
      else setEffortPick({ level, length: textRef.current.length });
    });
  };
  const shownEffort = effortShown(text, effort, effortPick);
  const modelText = modelChipText(contextWords(session), shownEffort);
  const modelItems: Array<MenuItem | MenuHeading | MenuSegments> = [
    { heading: 'Model' },
    ...MODEL_CHOICES.map(({ alias, name, line }) => ({ label: name, line, checked: name === session.model, onClick: () => pickModel(alias) })),
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
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    const id = session.id;
    void stepModeTo(word, {
      press: () => typeInto(id, '\x1b[Z'),
      read: async () => (await window.emerald.request('pty.screen', { sessionId: id })).rows,
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      cancelled: () => !alive.current || sessionRef.current !== id,
    }).then((got) => {
      stepping.current = false;
      if (!alive.current) return;
      setBusy(false);
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
  const addChip = (thumb: string) => {
    nextChip.current += 1;
    const id = nextChip.current;
    setChips((c) => [...c, { id, thumb, n: null }]);
    const until = Date.now() + 3000;
    const look = () => {
      window.emerald
        .request('pty.screen', { sessionId: sessionIdRef.current })
        .then((res) => {
          const held = new Set(chipsRef.current.map((c) => c.n));
          const fresh = promptRowImages(res.rows).filter((n) => !held.has(n));
          if (fresh.length > 0) setChips((c) => c.map((x) => (x.id === id ? { ...x, n: Math.max(...fresh) } : x)));
          else if (Date.now() < until) setTimeout(look, 250);
        })
        .catch(() => {});
    };
    setTimeout(look, 250);
  };
  // An image dropped anywhere else on this pane was pasted into the prompt
  // by explorer-drop.ts, which says so with this event; the chip is all
  // that is left to do. Not while asking: the paste went into the ask
  // dialog, so no marker will come (M9 fix 747).
  const addChipRef = useRef(addChip);
  addChipRef.current = addChip;
  useEffect(() => {
    const onImage = (ev: Event) => {
      const detail = (ev as CustomEvent<{ paneId?: unknown; path?: unknown }>).detail;
      if (detail?.paneId !== paneId || typeof detail.path !== 'string' || askingRef.current) return;
      addChipRef.current(fileHref(detail.path));
    };
    window.addEventListener('emerald:chat-image', onImage);
    return () => window.removeEventListener('emerald:chat-image', onImage);
  }, [paneId]);
  // The ×: one Ctrl+C, never a second within a click, since a Ctrl+C on an
  // empty prompt is the first half of Claude Code's exit; the read before
  // it is that guard. The box's words are React state and stay.
  // Claude Code 2.1.301 counts any Ctrl+C toward its press-again exit, the
  // one that clears the input too: two × clicks 0.4 s apart ended the
  // session in fix 748's runs, 1.6 s apart did not. So a click waits out
  // CTRL_C_GAP_MS since the last Ctrl+C it sent before it reads.
  const clearing = useRef(false);
  const lastCtrlC = useRef(0);
  const sessionBusy = () => stateRef.current === 'working' || stateRef.current === 'needs-input';
  const clearImages = async () => {
    if (clearing.current) return;
    clearing.current = true;
    try {
      const gap = lastCtrlC.current + CTRL_C_GAP_MS - Date.now();
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      if (sessionBusy()) return;
      const id = sessionIdRef.current;
      const before = await window.emerald.request('pty.screen', { sessionId: id });
      if (promptRowImages(before.rows).length === 0) {
        setChips([]);
        return;
      }
      if (sessionBusy()) return;
      lastCtrlC.current = Date.now();
      typeInto(id, '\x03');
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
  const pickSlash = (row: SlashRow, how: 'send' | 'complete') => {
    if (how === 'send') send(row.name);
    else setBox(`${row.name} `);
    boxRef.current?.focus();
  };

  const last = turns.length === 0 ? null : turns[turns.length - 1]!;
  const hint = refusal ?? modeMiss ?? hintText(session.state, queued.length);
  return (
    <div
      className="chat-view"
      data-session-id={session.id}
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
            <ChatTurn key={i} index={i} turn={turn} paneId={paneId} session={session} mode={view} open={unfolded.has(i)} onToggle={() => toggleFold(i)} />
          ))}
          {asking && <AskCard session={session} screen={askScreen} rootRef={askRef} paneId={paneId} edit={pendingEdit(turns)} />}
          {working && (
            <div className="chat-live">
              <span className="chat-live-mark">
                {/* M9 fix 715: the state's tone, so the glyph wears the title row's colour in either skin. */}
                <SessionMark kind="claude" tone={describeState(session).tone} working size="unit" />
              </span>
              {spinner !== null && <span className="chat-live-word">{spinner.word}</span>}
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
                title="Remove the images (clears Claude Code's prompt; your text stays)"
                aria-label="Remove the images"
                disabled={working || asking}
                onMouseDown={keepKeys}
                onClick={() => void clearImages()}
              >
                ×
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
            {mode !== null && (
              <button
                ref={modeChipRef}
                type="button"
                className="chat-chip"
                data-chip="mode"
                data-open={modeMenu !== null || undefined}
                data-busy={busy || undefined}
                onMouseDown={keepKeys}
                title="Permission mode; pick one from the list"
                onClick={openModeMenu}
              >
                <span className="chat-chip-word">{mode}</span>
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
              <Menu x={modelMenu.x} y={modelMenu.y} above items={modelItems} onClose={() => setModelMenu(null)} className="chat-model-menu" data={{ menu: 'chat-model' }} anchor={modelChipRef.current} />
            )}
            <button ref={viewChipRef} type="button" className="chat-chip" data-chip="view" data-open={viewMenu !== null || undefined} onMouseDown={keepKeys} title="What the timeline shows (Ctrl+O)" onClick={openViewMenu}>
              <span className="chat-chip-word">{CHAT_MODE_WORDS[view]}</span>
              <span className="chat-chip-caret" aria-hidden="true">
                <ChevronIcon />
              </span>
            </button>
            {viewMenu !== null && (
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
              <button type="button" className="chat-chip chat-chip-plain" data-chip="diff" title="Review changes" onClick={() => openReviewTab(session.id)}>
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
    </div>
  );
}

interface Screen {
  rows: string[];
  cursor: { x: number; y: number };
}

// M9 fix 690: the ask as a card on the rail, read off the screen as the
// sidebar's card is (AnswerPopover.tsx, which stays its own; both build
// on screen-prompt-model.ts). The digits press the option of that key,
// Escape cancels, and a question gets a box. Since fix 713 the screen is
// the view's one read, null until a read sent after the ask came up.
function AskCard({ session, screen, rootRef, paneId, edit }: { session: SessionInfo; screen: Screen | null; rootRef: React.RefObject<HTMLDivElement | null>; paneId: string; edit: PendingEdit | null }) {
  // M9 fix 717: a permission for the Edit the transcript wrote last is the
  // edit card, its file a path link like any other.
  const links = usePathLinks(paneId);
  const editCard = edit !== null && session.needsInputReason === 'permission' ? edit : null;
  const [answer, setAnswer] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
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
      <div className="chat-ask" {...links.handlers}>
        {editCard !== null ? (
          <EditCardHead session={session} edit={editCard} />
        ) : (
          <>
            <div className="chat-ask-heading">{askHeading(session.needsInputReason)}</div>
            <pre className="chat-ask-screen" data-rows={excerpt.length}>
              {screen === null ? 'Reading the screen…' : excerpt.length === 0 ? '(nothing drawn at the cursor)' : excerpt.join('\n')}
            </pre>
          </>
        )}
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
  const links = usePathLinks(paneId);
  return (
    <div className="chat-turn" data-turn-index={index} {...links.handlers}>
      <div className="chat-prompt-row">
        <div className="chat-prompt">
          {turn.prompt}
          <PromptImages images={turn.images} />
        </div>
        {(when !== null || length !== null) && <span className="chat-prompt-time">{[when, length].filter((x) => x !== null).join(' · ')}</span>}
      </div>
      {turn.steps.length > 0 && (
        <div className="chat-rail">
          {/* An image result's thumbnail follows its tool row, and in a
              folded mode the closed fold's images item (M9 fix 717). */}
          {timelineItems(turn.steps, mode, open).map((item, i) =>
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
                <ChatStep step={item.step} paneId={paneId} session={session} />
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
// Fix 753: its dot wears the folded calls' tone (foldTone).
function ChatFold({ fold, onToggle }: { fold: FoldItem; onToggle: () => void }) {
  return (
    <button type="button" className="chat-step chat-fold" data-kind="fold" data-open={fold.open || undefined} onClick={onToggle}>
      <span className="chat-dot" data-tone={fold.tone} />
      <span className="chat-fold-text">{foldText(fold)}</span>
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

function ChatStep({ step, paneId, session }: { step: Step; paneId: string; session: SessionInfo }) {
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
    return <ChatReply step={step} paneId={paneId} session={session} />;
  }
  if (step.kind === 'note') {
    return (
      <div className="chat-step chat-note" data-kind="note">
        <span className="chat-dot" data-tone="thinking" />
        {step.text}
      </div>
    );
  }
  if (step.kind === 'queued') {
    // M9 fix 754: a message Claude read mid-turn, a small bubble in place.
    const when = timeOf(step.at);
    return (
      <div className="chat-step chat-queued-step" data-kind="queued">
        <span className="chat-dot" data-tone="thinking" />
        <div className="chat-queued-bubble">{step.text}</div>
        <span className="chat-queued-time">{when === null ? 'sent mid-turn' : `sent mid-turn · ${when}`}</span>
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
  return (
    <div className="chat-step" data-kind="tool" data-tool={step.name}>
      <span className="chat-dot" data-tone={tone} />
      <span className="chat-tool-name">{step.name}</span>
      <span className={linked === null ? 'chat-tool-arg' : 'chat-tool-arg chat-path'} data-path={linked ?? undefined} title={step.arg}>
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
