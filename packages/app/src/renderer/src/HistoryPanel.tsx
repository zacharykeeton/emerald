import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { describeState, folderName, formatDuration, formatUsd } from '@emerald/shared';
import type { SessionInfo, Turn } from '@emerald/shared';
import type { HistoryScan, HistorySession, TranscriptTurns } from '../../preload/api.ts';
import { resumeSession, resumeTranscript, showSessionAuto } from './actions.ts';
import { focusTerminal } from './focus.ts';
import { useTranscriptCost } from './history-cost.ts';
import { focusedProject, groupByProject, matches, promptsText } from './history-model.ts';
import { Menu } from './Menu.tsx';
import { useFocusedSession } from './shown-sessions.ts';
import { publishHistoryTitles } from './history-index.ts';
import { ClaudeStar } from './skin-star.tsx';
import { HistoryRowAnchor } from './SweepCards.tsx';
import { useStore } from './store.ts';
import { clearRevealConversation, foldHistoryProjects, openHistoryFold, openTranscriptTab, setHistorySearch, showTab, toggleHistoryFold, useUi } from './ui.ts';

// Every Claude Code conversation on the machine, in the files rail behind
// the Sessions tab (History until M9 fix 83), like Orca's Agent Session
// History: whether or not emerald started it, searchable, grouped by
// repository, and resumable. The main process does the reading
// (history.ts); this file only sorts and shows.
// The panel scans when it is first shown and whenever Claude Code appends
// to history.jsonl, never while it is hidden, since it is unmounted then.

export function HistoryPanel() {
  const [scan, setScan] = useState<HistoryScan | null>(null);
  const [scanning, setScanning] = useState(false);
  // M9 fix 367: the search text lives in ui.ts, not the panel's own
  // state, so a rail collapse (which unmounts the panel) does not lose it.
  // M9 fix 417: the folds live there now for the same reason.
  const { revealConversation: reveal, tabs, historySearch: search, historyFolds: folds } = useUi();
  const collapsed = folds.collapsed;
  // M53: the rows unfolded into their turns, and the turns read for
  // them, keyed by the row's id and its last time so a conversation that
  // went on since is read again on the next unfold.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [turns, setTurns] = useState<ReadonlyMap<string, TurnsRead>>(new Map());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const live = useLiveByClaudeId();
  const now = useNow();
  const scanning_ = useRef(false);

  const rescan = () => {
    // One scan at a time; a change that lands mid-scan is picked up by
    // the next watcher push, since the watcher debounces after the write.
    if (scanning_.current) return;
    scanning_.current = true;
    setScanning(true);
    void window.emerald.history
      .scan()
      .then((result) => {
        publishHistoryTitles(result);
        setScan(result);
      })
      .catch((err: unknown) => console.warn('[emerald] history scan failed', err))
      .finally(() => {
        scanning_.current = false;
        setScanning(false);
      });
  };
  useEffect(() => {
    rescan();
    void window.emerald.history.watch(true).catch((err: unknown) => console.warn('[emerald] history watch failed', err));
    const off = window.emerald.history.onChanged(rescan);
    return () => {
      off();
      void window.emerald.history.watch(false).catch(() => undefined);
    };
  }, []);

  const sessions = scan?.sessions ?? [];
  const shown = sessions.filter((s) => matches(s, search));
  const groups = groupByProject(shown);
  // M9 fix 417: the fold is decided from every session the scan found,
  // not the ones the search leaves, so a project the search is hiding is
  // folded too and the list is right the moment the search clears. The
  // panel still shows `groups`, the narrowed ones.
  const allGroups = groupByProject(sessions);
  // M9 fix 84: with a dozen projects the list is long, so when the panel
  // shows and whenever the focused pane changes, every group folds but
  // the one the focused pane's session belongs to, which is scrolled to
  // the top of the list. A header click still folds and unfolds by hand
  // until the next focus change. Keyed on the focused session's id, not
  // the project: a click on another pane of the same project leaves a
  // hand-opened group as it is. The groups are read through a ref so a
  // scan landing after the focus change does not fold again; the first
  // scan is the one moment the groups exist to fold. Since fix 417 the
  // fold set is ui.ts's, which outlives the panel, so the effect asks
  // what it last folded for: the window's first scan folds, a focus
  // change folds, and a remount on the same focus leaves it alone. Since
  // fix 439 the fresh fold this effect hands over also takes back
  // whatever this focus had opened by hand before the last reload
  // (ui.ts's foldHistoryProjects does it, off localStorage), so the very
  // first fold after a reload is where a hand-open reappears.
  const focused = useFocusedSession();
  const focusedId = focused?.id ?? null;
  const hasScan = scan !== null;
  const groupsRef = useRef(allGroups);
  groupsRef.current = allGroups;
  const foldsRef = useRef(folds);
  foldsRef.current = folds;
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollTo = useRef<string | null>(null);
  useEffect(() => {
    if (!hasScan) return;
    if (foldsRef.current.foldedFor === focusedId) return;
    const own = focusedProject(groupsRef.current, focused);
    foldHistoryProjects(focusedId, new Set(groupsRef.current.map((g) => g.project).filter((p) => p !== own)));
    scrollTo.current = own;
  }, [hasScan, focusedId]);
  // After the commit that unfolded the group, so its header is where it
  // will stay; synchronous, since a covered window gets no frames.
  useLayoutEffect(() => {
    const own = scrollTo.current;
    if (own === null) return;
    scrollTo.current = null;
    const list = listRef.current;
    if (list === null || list.scrollHeight <= list.clientHeight) return;
    [...list.querySelectorAll<HTMLElement>('.history-group')].find((g) => g.dataset['project'] === own)?.scrollIntoView({ block: 'start' });
  }, [collapsed]);
  // M60: the lane card's Transcript names a conversation to show. Once
  // the scan has its row, the search is cleared if it hides the row, its
  // group is opened, the row unfolded and scrolled to, and the reveal
  // taken; the same conversation open as a tab (M53) is brought to the
  // front as well. A conversation the scan does not hold (older than
  // the recent cap) is left where it is; the tab is still shown.
  const revealSeq = reveal?.seq ?? null;
  const revealTo = useRef<string | null>(null);
  useEffect(() => {
    if (reveal === null || scan === null) return;
    const s = scan.sessions.find((x) => x.id === reveal.id);
    if (s === undefined) {
      clearRevealConversation(reveal.seq);
      return;
    }
    if (!matches(s, search)) setHistorySearch('');
    openHistoryFold(s.project);
    setUnfolded((u) => (u.has(s.id) ? u : new Set(u).add(s.id)));
    if (tabs.files.includes(s.path)) showTab(s.path);
    revealTo.current = s.id;
    clearRevealConversation(reveal.seq);
    // Only revealSeq: the effect fires once per Transcript, on the scan
    // it finds the row in.
  }, [revealSeq, scan]);
  useLayoutEffect(() => {
    const id = revealTo.current;
    if (id === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`.history-row[data-id=${JSON.stringify(id)}]`);
    if (row === null || row === undefined) return;
    revealTo.current = null;
    row.scrollIntoView({ block: 'center' });
  });
  const toggleGroup = (key: string) => toggleHistoryFold(key);
  const toggleRow = (id: string) =>
    setUnfolded((u) => {
      const next = new Set(u);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // The turns of every unfolded row that has none read yet. A read for a
  // row folded meanwhile is kept; it is small and the next unfold has it
  // at once.
  useEffect(() => {
    for (const s of sessions) {
      if (!unfolded.has(s.id)) continue;
      const key = turnsKey(s);
      if (turns.has(key)) continue;
      setTurns((t) => new Map(t).set(key, 'loading'));
      void window.emerald.history
        .turns(s.path)
        .then((read) => setTurns((t) => new Map(t).set(key, read)))
        .catch((err: unknown) => {
          console.warn('[emerald] transcript turns failed', err);
          setTurns((t) => new Map(t).set(key, { error: 'The transcript could not be read' }));
        });
    }
  }, [unfolded, sessions, turns]);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  // Show a live session, resume emerald's own exited one under its id, and
  // start anything else fresh with --resume.
  const act = (s: HistorySession, split: boolean) => {
    const own = live.get(s.id);
    if (own !== undefined && own.state !== 'exited') void showSessionAuto(own.id).catch(warn('show'));
    else if (own !== undefined) void resumeSession(own.id).catch(warn('resume'));
    else if (s.cwdExists) void resumeTranscript(s.cwd, s.id, split).catch(warn('resume'));
  };
  const openMenu = (s: HistorySession, x: number, y: number) => setMenu({ session: s, x, y });

  let empty: string | null = null;
  if (scan !== null && sessions.length === 0) empty = 'No Claude Code sessions found';
  else if (scan !== null && shown.length === 0) empty = 'No matching sessions';

  return (
    <div className="history-panel" data-scanning={scanning || undefined}>
      <div className="history-header">
        <div className="history-heading">
          <span className="history-title">Sessions</span>
          <span className="history-count" title={scan === null ? undefined : `${shown.length} shown of the ${scan.sessions.length} most recent, ${scan.total} in all`}>
            {scan === null ? 'scanning' : `${shown.length} shown · ${scan.sessions.length} recent`}
          </span>
        </div>
        <button className="files-button history-refresh" title="Scan again" onClick={rescan} onMouseDown={(ev) => ev.preventDefault()}>
          <RefreshIcon />
        </button>
      </div>
      <div className="files-filter history-search">
        {/* M9 fix 336: the × is placed against this box, as the files
            tab's FilterBox wraps its own input and clear button; with no
            wrapper it lands on the rail's collapse button instead, since
            that is what .files-filter-clear's absolute position resolves
            against with no .files-filter-box ancestor. */}
        <div className="files-filter-box">
          <input
            className="files-filter-input"
            placeholder="Search sessions"
            value={search}
            spellCheck={false}
            onChange={(e) => setHistorySearch(e.target.value)}
            onKeyDown={(ev) => {
              // Escape clears and hands the keyboard back, as the files
              // filter does; no key here should reach a chord.
              if (ev.key === 'Escape') {
                setHistorySearch('');
                focusTerminal();
              }
              ev.stopPropagation();
            }}
          />
          {search !== '' && (
            <button
              className="files-filter-clear"
              title="Clear"
              onClick={() => {
                setHistorySearch('');
                focusTerminal();
              }}
              onMouseDown={(ev) => ev.preventDefault()}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div className="history-list" ref={listRef}>
        {empty !== null && <div className="files-empty">{empty}</div>}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.project);
          return (
            <div key={g.project} className="history-group" data-project={g.project} data-collapsed={isCollapsed || undefined}>
              <div className="history-group-header" title={g.project} onClick={() => toggleGroup(g.project)} onMouseDown={(ev) => ev.preventDefault()}>
                <span className="files-chevron">{isCollapsed ? '▸' : '▾'}</span>
                <span className="history-group-name">{folderName(g.project)}</span>
                <span className="history-group-count">{g.sessions.length}</span>
              </div>
              {!isCollapsed &&
                g.sessions.map((s) => (
                  <HistoryRow key={s.id} session={s} own={live.get(s.id)} now={now} unfolded={unfolded.has(s.id)} turns={turns.get(turnsKey(s)) ?? null} onToggle={toggleRow} onAct={act} onMenu={openMenu} />
                ))}
            </div>
          );
        })}
      </div>
      {menu !== null && <RowMenu menu={menu} own={live.get(menu.session.id)} onAct={act} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface MenuState {
  session: HistorySession;
  x: number;
  y: number;
}

type TurnsRead = 'loading' | TranscriptTurns | { error: string };

function turnsKey(s: HistorySession): string {
  return `${s.id}:${s.lastAt ?? 0}`;
}

interface RowProps {
  session: HistorySession;
  // emerald's own session on this conversation, when it has one.
  own: SessionInfo | undefined;
  now: number;
  unfolded: boolean;
  turns: TurnsRead | null;
  onToggle: (id: string) => void;
  onAct: (s: HistorySession, split: boolean) => void;
  onMenu: (s: HistorySession, x: number, y: number) => void;
}

// A row folded is the title, the last message and the facts; unfolded
// (M53, a click on the row or its chevron) it is the turns of the
// conversation in place, the last reply whole, with Expand for the same
// as a tab and Open transcript for the raw file. The buttons stop their
// clicks so they do not fold the row.
function HistoryRow({ session: s, own, now, unfolded, turns, onToggle, onAct, onMenu }: RowProps) {
  const liveOwn = own !== undefined && own.state !== 'exited' ? own : undefined;
  const isLive = liveOwn !== undefined;
  const label = own === undefined ? null : describeState(own);
  const action = isLive ? 'Show' : 'Resume';
  const actionTitle = liveOwn !== undefined
    ? `Show ${liveOwn.name} in the focused pane`
    : own !== undefined
      ? `Start ${own.name} again with its conversation`
      : s.cwdExists
        ? `claude --resume in ${s.cwd}, in the focused pane (Shift for a new pane)`
        : `${s.cwd} no longer exists`;
  const read = turns !== null && turns !== 'loading' && 'turns' in turns ? turns : null;
  // Unfolded, the facts give the span of the conversation in place of
  // its age, and the branch when the transcript names one. The prompt
  // count comes off the turns once a row has read them, folded or not
  // (M9 fix 97), since the scan's count stops at COUNT_CAP_BYTES and
  // runs short for a long conversation.
  const prompts = read === null ? `${s.prompts} ${s.prompts === 1 ? 'prompt' : 'prompts'}` : promptsText(read.turns);
  const meta = (
    unfolded
      ? [prompts, spanText(read?.startedAt ?? s.startedAt, read?.lastAt ?? s.lastAt), read?.branch ?? s.branch, s.model]
      : [prompts, s.lastAt === null ? null : `${formatDuration(s.lastAt, now)} ago`, s.model]
  ).filter((x): x is string => x !== null);
  // What the conversation cost, last on the facts line (M9 fix 256): a
  // live session's own figure, the one Claude Code keeps, as a bare
  // $1.40; else our estimate off the transcript's requests and its
  // subagents' (M9 fix 273) as ~$1.40, the way the context card marks
  // one, the agents' share named on the unfolded row when there were
  // any; nothing until the answer lands, so the line never jumps to a
  // placeholder, and nothing for a transcript with no requests or over
  // the cap.
  const estimate = useTranscriptCost(s.path, s.lastAt);
  const liveUsd = liveOwn?.costUsd ?? null;
  const cost =
    liveUsd !== null
      ? { text: formatUsd(liveUsd), title: "at API rates, subagents included, Claude Code's own figure", estimate: false }
      : estimate !== undefined && estimate !== null && estimate.usd !== null
        ? {
            text: unfolded && estimate.agents.count > 0 && estimate.agents.usd !== null ? `~${formatUsd(estimate.usd)} (agents ~${formatUsd(estimate.agents.usd)})` : `~${formatUsd(estimate.usd)}`,
            title: `an estimate from our rate table, subagents included${estimate.agents.skipped > 0 ? ` but ${estimate.agents.skipped} agent ${estimate.agents.skipped === 1 ? 'file' : 'files'} too large to read` : ''}`,
            estimate: true,
          }
        : null;
  const stop = (fn: () => void) => (ev: { stopPropagation: () => void }) => {
    ev.stopPropagation();
    fn();
  };
  return (
    <div
      className="history-row"
      data-id={s.id}
      data-live={isLive || undefined}
      data-own={own?.id}
      data-unfolded={unfolded || undefined}
      onClick={() => onToggle(s.id)}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onMenu(s, ev.clientX, ev.clientY);
      }}
      // Keyboard focus stays in the terminal, as with the sidebar.
      onMouseDown={(ev) => ev.preventDefault()}
    >
      <div className="history-row-top">
        <span className="history-row-fold files-chevron" title={unfolded ? 'Fold the turns away' : 'Unfold the turns'}>
          {unfolded ? '▾' : '▸'}
        </span>
        {label !== null && <span className={`sidebar-row-dot history-row-dot state-${label.tone}`} title={label.text} />}
        {/* The title opens the row's card (M73 task 4): the folder, branch, model, prompts, times and file the row's tooltip carried. A click on it pins the card; the rest of the row still folds and unfolds. */}
        <HistoryRowAnchor session={s} className="history-row-title">
          {s.title}
        </HistoryRowAnchor>
        <button
          className="sidebar-row-menu history-row-menu"
          title="Resume, copy, open or reveal"
          onClick={(ev) => {
            ev.stopPropagation();
            const r = ev.currentTarget.getBoundingClientRect();
            onMenu(s, r.left, r.bottom);
          }}
        >
          ⋯
        </button>
      </div>
      {!unfolded && s.preview !== null && (
        <div className="history-row-preview" title={s.preview.text}>
          <span className="history-row-who">{s.preview.who === 'you' ? 'You:' : 'Agent:'}</span> {s.preview.text}
        </div>
      )}
      <div className="history-row-meta">
        <ClaudeStar className="history-glyph" />
        <span className="history-row-facts">
          {meta.join(' · ')}
          {cost !== null && (
            <>
              {' · '}
              <span className="history-row-cost" data-estimate={cost.estimate || undefined} title={cost.title}>
                {cost.text}
              </span>
            </>
          )}
        </span>
        <button
          className="history-row-action"
          data-action={action.toLowerCase()}
          title={actionTitle}
          disabled={!isLive && own === undefined && !s.cwdExists}
          onClick={(ev) => {
            ev.stopPropagation();
            onAct(s, ev.shiftKey);
          }}
        >
          {action}
        </button>
      </div>
      {unfolded && (
        <>
          {turns === 'loading' || turns === null ? (
            <div className="history-turns-note">reading the transcript</div>
          ) : 'error' in turns ? (
            <div className="history-turns-note">{turns.error}</div>
          ) : (
            <div className="history-turns">
              {turns.turns.map((t, i) => (
                <TurnLines key={i} turn={t} whole={i === turns.turns.length - 1} />
              ))}
            </div>
          )}
          <div className="history-row-buttons">
            <button className="history-row-action history-expand" title="The same conversation as a tab, every reply whole" onClick={stop(() => openTranscriptTab(s.path, 'turns'))}>
              <ExpandIcon /> Expand
            </button>
            <button className="history-row-open" title={`${s.path}, read-only in a tab`} onClick={stop(() => openTranscriptTab(s.path, 'raw'))}>
              Open transcript
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// One turn in the rail: the prompt's first line behind the sidebar's ›
// with the turn's length at the right, and the reply's first line behind
// a ✓; the last reply is shown whole, since that is what answers "where
// were we".
function TurnLines({ turn, whole }: { turn: Turn; whole: boolean }) {
  const length = turn.at !== null && turn.endAt !== null ? formatDuration(turn.at, turn.endAt) : null;
  return (
    <div className="history-turn" data-whole={whole || undefined}>
      <div className="history-turn-prompt" title={turn.prompt}>
        <span className="history-turn-mark">›</span>
        <span className="history-turn-text">{firstLine(turn.prompt)}</span>
        {length !== null && <span className="history-turn-length">{length}</span>}
      </div>
      {turn.reply !== null && (
        <div className="history-turn-reply" title={whole ? undefined : turn.reply}>
          <span className="history-turn-mark">✓</span>
          <span className="history-turn-text">{whole ? turn.reply.trim() : firstLine(turn.reply)}</span>
        </div>
      )}
    </div>
  );
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
}

// 09:12 to 11:48, or the one time when the conversation has no end yet.
function spanText(from: number | null, to: number | null): string | null {
  if (from === null) return null;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return to === null || to <= from ? clock(from) : `${clock(from)} to ${clock(to)}`;
}

function RowMenu({ menu, own, onAct, onClose }: { menu: MenuState; own: SessionInfo | undefined; onAct: (s: HistorySession, split: boolean) => void; onClose: () => void }) {
  const s = menu.session;
  const liveOwn = own !== undefined && own.state !== 'exited' ? own : undefined;
  const isLive = liveOwn !== undefined;
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  // M9 fix 370: the main process's clipboard, not navigator.clipboard,
  // which asks a permission this menu's click does not carry.
  const copy = (text: string) => void window.emerald.clipboard.write(text).catch(warn('copy'));
  const done = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const canResume = !isLive && (own !== undefined || s.cwdExists);
  return (
    <Menu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      className="history-menu"
      data={{ id: s.id }}
      items={[
        ...(liveOwn !== undefined ? [{ label: 'Show', title: `Show ${liveOwn.name} in the focused pane`, onClick: done(() => onAct(s, false)) }] : []),
        ...(!isLive
          ? [
              { label: 'Resume here', title: s.cwdExists || own !== undefined ? `claude --resume in ${s.cwd}` : `${s.cwd} no longer exists`, disabled: !canResume, onClick: done(() => onAct(s, false)) },
              { label: 'Resume in a split', title: 'The same, in a new pane beside the focused one', disabled: !canResume || own !== undefined, onClick: done(() => onAct(s, true)) },
            ]
          : []),
        { label: 'Copy resume command', title: `claude --resume ${s.id}`, onClick: done(() => copy(`claude --resume ${s.id}`)), separator: true },
        { label: 'Copy session id', title: s.id, onClick: done(() => copy(s.id)) },
        // M9 fix 85: the whole conversation as a read-only tab, the way a
        // file from the rail opens (M11), for when a row's preview is
        // not enough to tell which one to resume.
        { label: 'Open transcript', title: `${s.path}, read-only in a tab`, onClick: done(() => openTranscriptTab(s.path, 'raw')), separator: true },
        { label: 'Reveal transcript', title: s.path, onClick: done(() => void window.emerald.files.reveal(s.path).catch(warn('reveal'))) },
      ]}
    />
  );
}

// emerald's own sessions by the Claude session id they reported, so a row
// can say it is live, or resume the exited one under its own id.
function useLiveByClaudeId(): ReadonlyMap<string, SessionInfo> {
  const { sessions } = useStore('sessions');
  const map = new Map<string, SessionInfo>();
  for (const s of sessions.values()) {
    if (s.claudeSessionId !== null && s.kind === 'claude') map.set(s.claudeSessionId, s);
  }
  return map;
}

// Relative times need no more than a tick a minute.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
