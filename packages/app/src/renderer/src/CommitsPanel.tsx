import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { agentLineText, currentTab, describeState, findPane, formatDuration, formatUsd, markKind, modelWord, tokensRowText, workingMotion } from '@emerald/shared';
import type { ActivitySession, GraphViewState, Layout, SessionInfo, UsageMessage } from '@emerald/shared';
import type { GitGraph, GraphCommit } from '../../preload/api.ts';
import { AgentCard } from './AgentCard.tsx';
import { COL_PX, CommitGraph, ROW_PX, drawnRange, stepScale } from './CommitGraph.tsx';
import { isGraphScale } from '@emerald/shared';
import type { LaneCardAnchor } from './CommitGraph.tsx';
import type { Orientation } from './CommitGraph.tsx';
import { HistoryCard } from './HistoryCard.tsx';
import { PaneIcon, TabIcon } from './icons.tsx';
import { LaneCard } from './LaneCard.tsx';
import { conflictPeers, conflictReading } from './conflict-model.ts';
import { commitBranches, leanTitle } from './commit-depth-model.ts';
import type { CommitBranch } from './commit-depth-model.ts';
import { twinInfo, twinPillText, twinPillTitle } from './commit-twins-model.ts';
import type { TwinInfo } from './commit-twins-model.ts';
import { branchGroups, commitSlice, conversationAt, rowCost } from './commit-price-model.ts';
import type { RowCost } from './commit-price-model.ts';
import { askUsage, useConversationUsage } from './commit-usage.ts';
import { folderName } from './files-model.ts';
import { outsideKind } from './lane-card-model.ts';
import type { CardBar, LaneCardAgent, LaneCardSession } from './lane-card-model.ts';
import { OutsideCard } from './OutsideCard.tsx';
import { PersonCard } from './PersonCard.tsx';
import { RemoteCard } from './RemoteCard.tsx';
import { usePopoverAnchor } from './Popover.tsx';
import { CommitCard, WriteCard, elsewhereText, groupText } from './SweepCards.tsx';
import type { CommitPrice } from './SweepCards.tsx';
import { OUTSIDE_KEY, agentLabel, agentRole, blockKey, historyIdOf, holdGraph, laneAgents, laneSessions, personNameOf, remoteBranchOf, sessionGraph, spanCommits, spanIdOf, spanIds, spanName } from './commit-graph-model.ts';
import type { AgentItem, BlockLayout, CommitItem, GraphMode, LaneAgent, SessionGraph } from './commit-graph-model.ts';
import { clearLines, drawState, drawnBlocks, soloLines, toggleLines } from './graph-filter-model.ts';
import type { DrawMode } from './graph-filter-model.ts';
import type { CardLayout, CardLines } from './LaneCard.tsx';
import { useGitPoll } from './git-poll.ts';
import { ensureHistoryTranscripts, useHistoryTranscripts } from './history-index.ts';
import { Menu } from './Menu.tsx';
import type { MenuItem } from './Menu.tsx';
import { useStore } from './store.ts';
import { activitySupported } from './daemon-model.ts';
import { buildReplay, frameAt, nextChange, replayGraph, replayInput, replayNote, togglePlay } from './replay-model.ts';
import type { Replay, ReplayFrame } from './replay-model.ts';
import { GRAPH_KEY, VIEW_KEY, cleanGraph } from './view-state.ts';
import type { CommitsSnapshot } from './view-state.ts';
import { observeBand } from './band-visibility.ts';
import { writeGraphInput } from './write-graph-model.ts';
import type { GraphWrite } from './write-graph-model.ts';

// The Commits tab of the files rail (M45 as Timeline, M49 as Commits, M51
// as a graph, M65 as the sessions' graphs): the repo the focused pane's
// session is in, as the whole repository's log newest first, every local
// branch, with each session drawn as a little graph of its own beside
// the rows (commit-graph-model.ts, CommitGraph.tsx): a node per commit
// on the lane of the session that made it (M58's owner, one dot per
// row, in a grey block for a commit made outside emerald), the lanes
// inside a block following git's parents so a merged branch reads as a
// branch and a merge (M68), a lane
// per subagent worktree in the session's colour (M61), the session's
// agents as rows of their own above their newest commit with the mark,
// the status, the activity line and a wash of the session's colour,
// and the branch names as pills on the commits they sit on. Graph and
// List are one row list under two lane layouts: the list gives each
// session one straight line, and the switch is a re-layout and nothing
// else. Upright beside the rows, or on its side as the whole panel with
// time along the x axis, and either way in time. The branch the log is
// on is named at the top, since nothing else on the panel says what is
// checked out; it is the daemon's read of .git/HEAD for the session's
// folder, the same one the sidebar row shows. The log comes from the
// main process (git-status.ts) on the rail's git cadence, and the main
// process watches the repo's logs folder so a commit shows within a
// moment of landing. In a pane of its own (M52) the panel has no session
// behind it, so the branch is the graph's own read of HEAD.
const EMPTY: GitGraph = { root: null, head: null, headHash: null, defaultBranch: null, merged: [], commits: [], worktrees: [], author: null, fetchedAt: null };

// What of a graph read the panel draws (M9 fix 354): the head and its
// hash, the default branch, the fetch time behind the remote chip, the
// worktrees, the author, and every commit's hash with its refs (twins
// derive from the commits).
function graphStamp(g: GitGraph): string {
  return [g.root, g.head, g.headHash, g.defaultBranch, g.fetchedAt, g.author, g.merged.join('|'), g.worktrees.join('|'), ...g.commits.map((c) => `${c.hash}:${c.refs.join('|')}:${(c.remoteRefs ?? []).join('|')}`)].join(',');
}
const EMPTY_WRITES: ReadonlyMap<string, GraphWrite> = new Map();

// How the graph is drawn: upright or on its side, whether time runs
// the other way (newest last), which blocks draw as one line or as
// their graph against the switch's default (M71), by block key, and
// which blocks draw lanes at all (M72): every block or the active
// sessions, less the hidden set, or one block alone. The rows never
// change under any of these; the gutter does. rows (M9 fix 171): whether
// the commit rows draw beside the upright gutter at all, for the rail
// and the document tab, which share it as they share the orientation; a
// pane keeps the flag on its view record instead (fix 162). scale (M9
// fix 213): the zoom, kept with the orientation so the rail and every
// pane and tab zoom together as they turn together. remotes (M9 fix
// 286): whether the read asks for the remote branches, off by default
// since they double every lane a local branch tracks.
interface GraphPrefs {
  orientation: Orientation;
  reverse: boolean;
  layout: Record<string, BlockLayout>;
  draw: DrawMode;
  hidden: readonly string[];
  solo: string | null;
  rows: boolean;
  scale: number;
  remotes: boolean;
}

// A replay of the graph from one commit (M9 fix 869): the folder, view
// and commit it was asked for, the model and timing once the working
// record has answered (null while loading), the note on where the record
// starts, when it started playing, and the replay ms a seek holds it at.
interface ReplayRun {
  folder: string;
  view: GraphMode;
  hash: string;
  model: SessionGraph | null;
  replay: Replay | null;
  note: string | null;
  historyFrom: number | null;
  startedAt: number;
  pausedAt: number | null;
}

// How often the replay's slider moves while it plays (M9 fix 905): the panel sleeps between changes, so without it the thumb would jump from one change to the next.
const REPLAY_TICK_MS = 250;

// The replay's strip: a play and pause button, the slider, the text and the note. It ticks on its own so the graph still renders only at a change.
function ReplayStrip({ run, replay, onToggle, onScrub }: { run: ReplayRun; replay: Replay; onToggle: () => void; onScrub: (at: number) => void }): React.JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (run.pausedAt !== null) return;
    const id = setInterval(() => setTick((n) => n + 1), REPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [run.pausedAt, run.startedAt]);
  const at = run.pausedAt ?? Math.min(replay.length, Date.now() - run.startedAt);
  const paused = run.pausedAt !== null;
  const text = `Replaying from ${run.hash.slice(0, 7)} · Space pauses · Escape stops`;
  return (
    <div className="commits-replay" data-hash={run.hash}>
      <button className="files-button commits-replay-play" data-state={paused ? 'paused' : 'playing'} title={paused ? 'Play the replay on from here (Space)' : 'Pause the replay (Space)'} onMouseDown={(ev) => ev.preventDefault()} onClick={onToggle}>
        {paused ? '▶' : '❚❚'}
      </button>
      <input
        type="range"
        className="commits-replay-range"
        aria-label="Replay position"
        title="Drag to move through the replay; it holds where you let go"
        min={0}
        max={replay.length}
        step="any"
        value={at}
        onChange={(ev) => {
          const v = Number(ev.currentTarget.value);
          onScrub(v);
        }}
      />
      <span className="commits-replay-text" title={text}>
        {text}
      </span>
      {run.note !== null && (
        <span className="commits-replay-note" data-from={run.historyFrom === null ? undefined : String(run.historyFrom)} title={run.note}>
          {run.note}
        </span>
      )}
    </div>
  );
}

// How long a commit the watch just brought in stays marked on the graph.
const FRESH_MS = 1000;

// onOpenPane (M69): the same graph in a pane beside the focused one.
// onExpand (M61): the rail's panel offers the graph as a document tab;
// a panel that is the tab, or an M52 pane, passes none. inPane (M9 fix
// 161): a layout pane's panel can fold its branch line and its tools
// row away behind the flag every commits pane shares, leaving the graph;
// the rail's section and the tab keep their rows whatever the flag.
// rows and onRows (M9 fix 162): a pane's view record says whether the
// commit rows draw beside the upright gutter; with them off the panel is
// the graph's lines alone, its lanes named by their cards (M9 fix 173).
// A caller that passes neither (the rail, the document tab) gets the
// flag from the prefs (M9 fix 171), so the tools row offers the toggle
// everywhere; a pane on a daemon too old for the record's flag passes
// rows alone and gets no button.
// graph and onGraph (M9 fix 178): a panel opened from the rail, in a
// pane or a tab, holds its own graph state, handed in by its owner (the
// pane's view record, the tab's query) and written back through onGraph;
// the rail's panel passes neither and keeps its state under the shared
// localStorage keys as before. onExpand and onOpenPane carry the panel's
// state, so the view they open starts as a snapshot of this one.
// folded and onFold (M9 fix 179): the pane's chrome flag, on its view
// record, folds the branch line and the tools row here and the title bar
// in ViewPane together; the ▴ button asks the pane to fold through
// onFold, and a pane on a daemon too old for the flag passes none and
// gets no button.
// zoom (M9 fix 213): whether Ctrl+wheel may step the scale; a pane on a
// daemon too old to keep the field on its record passes false, since the
// daemon would drop it and the picture snap back on every write.
// remotes (M9 fix 286): whether the remotes chip is offered, false in a
// pane on a daemon too old to keep the flag on its record, for the same
// reason.
export function CommitsPanel({ folder, branch, createdAt, tick, onExpand, onOpenPane, inPane = false, rows: rowsProp, onRows: onRowsProp, graph: graphProp, onGraph, folded: foldedProp = false, onFold, zoom = true, remotes: remotesProp = true }: { folder: string | null; branch: string | null; createdAt: number | null; tick: number; onExpand?: ((folder: string, state: CommitsSnapshot) => void) | undefined; onOpenPane?: ((folder: string, state: CommitsSnapshot) => void) | undefined; inPane?: boolean | undefined; rows?: boolean | undefined; onRows?: ((rows: boolean) => void) | undefined; graph?: GraphViewState | undefined; onGraph?: ((graph: GraphViewState) => void) | undefined; folded?: boolean | undefined; onFold?: (() => void) | undefined; zoom?: boolean | undefined; remotes?: boolean | undefined }) {
  const [ownView, setOwnView] = useState<GraphMode>(() => readView());
  const [ownPrefs, setOwnPrefs] = useState<GraphPrefs>(() => readPrefs());
  const owned = graphProp !== undefined;
  const view: GraphMode = owned ? (graphProp.mode ?? 'graph') : ownView;
  const prefs: GraphPrefs = owned ? prefsOf(graphProp, rowsProp ?? true) : ownPrefs;
  // The remote branches ride the read (M9 fix 286): the chip's flag is
  // the poll's key, so a click reads the log again with or without them.
  const withRemotes = remotesProp && prefs.remotes;
  // The stamp (M9 fix 354) is what the panel draws off the read: an
  // unchanged log hands back the held graph object, so the usage
  // effect and every consumer keyed on it stay quiet between changes.
  const read = useGitPoll(folder, tick, EMPTY, (dir) => window.emerald.files.gitGraph(dir, { remotes: withRemotes }), 'git graph', withRemotes ? 'remotes' : '', graphStamp);
  // A read that came back empty on the same root shows the last graph
  // that had commits (M9 fix 210), so the view is never unmounted and
  // remounted, which parked its scroll at the tip again.
  const held = useRef<GitGraph>(EMPTY);
  const graph = holdGraph(held.current, read);
  held.current = graph;
  // Whether any read has landed for this folder (M9 fix 224): the poll
  // hands back its empty graph, this very object, until the first one
  // does, and the panel used to read that as "Not a git repository" for
  // the second or so a 200-commit log takes, every time the rail's
  // Activity tab mounted it afresh; the message waits for a read that
  // said so, and the list is blank until then.
  const pending = folder !== null && read === EMPTY;
  const now = useNow();
  const folded = foldedProp && inPane;
  const { sessions, removed, layout, daemon, connected } = useStore('sessions', 'removed', 'layout', 'daemon', 'connected');
  // The session behind the focused pane of the current tab (M9 fix 186),
  // for the graph's "you are here"; a view pane or an empty one lights
  // nothing. Every window showing this folder's graph reads the same
  // layout, so the band follows the focus as the pane's ring does.
  const focusedSessionId = focusedSessionIn(layout);
  // The removed sessions too (M57), so a lane outlives Clear exited.
  const sessionList = [...sessions.values(), ...removed.values()];
  // The right-click menu: the direction items, and above them the items
  // for the block of the row it opened on (M72), when it did, and the
  // row's commit for Replay from here (M9 fix 869).
  const [menu, setMenu] = useState<{ x: number; y: number; block: string | null; hash: string | null } | null>(null);
  const fresh = useFresh(graph);
  // The centre action (M9 fix 170), set by the view once it has its box.
  const centre = useRef<(() => void) | null>(null);
  const choosePrefs = (next: GraphPrefs) => {
    if (owned) {
      onGraph?.(stateOf(next, view));
      return;
    }
    setOwnPrefs(next);
    try {
      localStorage.setItem(GRAPH_KEY, JSON.stringify(next));
    } catch {
      // Kept for the session only.
    }
  };
  const rows = rowsProp ?? prefs.rows;
  const onRows = onRowsProp ?? (rowsProp === undefined ? (next: boolean) => choosePrefs({ ...prefs, rows: next }) : undefined);
  const onScale = zoom ? (scale: number) => choosePrefs({ ...prefs, scale }) : null;
  // The switch sets the default and clears every block's own choice
  // (M71), so a click on it always does something visible.
  const chooseView = (v: GraphMode) => {
    if (owned) {
      onGraph?.(stateOf({ ...prefs, layout: {} }, v));
      return;
    }
    setOwnView(v);
    if (Object.keys(prefs.layout).length > 0) choosePrefs({ ...prefs, layout: {} });
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Kept for the session only.
    }
  };
  // What an open from this panel starts with (M9 fix 178).
  const snapshot = (): CommitsSnapshot => ({ graph: stateOf(prefs, view), rows });
  // The repository's checkouts (M68): a live Claude session in one of
  // them is a row of its own on the graph, commits or none.
  const roots = graph.root === null ? [] : [graph.root, ...graph.worktrees];
  // The conversations on disk (M70), for the commits whose trailer names
  // one the daemon never held; one scan is asked for the first time such
  // a trailer shows, and the graph redraws when it lands.
  const history = useHistoryTranscripts();
  // The blocks that draw (M72): active is a session with a sidebar row,
  // which is one the store lists (removed ones are apart); a listed
  // session's earlier conversation spans (M9 fix 185) are its blocks too.
  const live = new Set([...sessions.keys(), ...[...sessions.values()].flatMap((s) => spanIds(s))]);
  // A folder that is no repository (M9 fix 255) draws the folder's
  // sessions' writes as its nodes (write-graph-model.ts), the same
  // layout over commit-shaped items; the folder itself is the one root.
  const noRepo = folder !== null && graph.root === null && !pending;
  const writeInput = noRepo && folder !== null ? writeGraphInput(sessionList, folder) : null;
  const model =
    writeInput === null || folder === null
      ? sessionGraph(graph.commits, sessionList, view, roots, graph.defaultBranch, history, { layout: new Map(Object.entries(prefs.layout)), drawn: (keys) => drawnBlocks(prefs, keys, live), historyColors: HISTORY_COLORS, author: graph.author })
      : sessionGraph(writeInput.commits, writeInput.sessions, view, [folder], null, new Map(), { layout: new Map(Object.entries(prefs.layout)), drawn: (keys) => drawnBlocks(prefs, keys, live) });
  const writes = writeInput?.writes ?? EMPTY_WRITES;
  // The replay (M9 fix 869): the model is built once from the record and
  // held, so the live poll's new commits wait until it ends; the live
  // model above goes on being computed under it. The panel sleeps until
  // the next thing changes rather than rendering on a frame tick.
  const [run, setRun] = useState<ReplayRun | null>(null);
  const [, setReplayTick] = useState(0);
  const runReplay = run?.replay ?? null;
  const replayAtNow = run === null || runReplay === null ? 0 : (run.pausedAt ?? Math.min(runReplay.length, Date.now() - run.startedAt));
  const startReplay = (hash: string) => {
    const commit = graph.commits.find((c) => c.hash === hash);
    if (folder === null || commit === undefined) return;
    const asked = { folder, view, hash };
    setRun({ ...asked, model: null, replay: null, note: null, historyFrom: null, startedAt: 0, pausedAt: null });
    const commits = graph.commits;
    const records = sessionList;
    const options = { layout: new Map(Object.entries(prefs.layout)), drawn: (keys: readonly string[]) => drawnBlocks(prefs, keys, live), historyColors: HISTORY_COLORS, author: graph.author };
    const defaultBranch = graph.defaultBranch;
    const askedAt = Date.now();
    // requestsSince at the ask's own time keeps the request points out of
    // the answer; the replay reads only the spans.
    const ask: Promise<{ rows: readonly ActivitySession[]; historyFrom: number | null; answered: boolean }> =
      activitySupported(daemon) && connected
        ? window.emerald.request('activity.spans', { from: commit.at, to: askedAt, requestsSince: askedAt }).then(
            (res) => ({ rows: res.sessions, historyFrom: res.historyFrom ?? null, answered: true }),
            () => ({ rows: [], historyFrom: null, answered: false }),
          )
        : Promise.resolve({ rows: [], historyFrom: null, answered: false });
    void ask.then(({ rows: activity, historyFrom, answered }) => {
      const input = replayInput(records, activity, new Set(commits.map((c) => c.hash)));
      const m = sessionGraph(commits, input.sessions, asked.view, roots, defaultBranch, history, { ...options, membersOnLine: input.membersOnLine });
      const r = buildReplay(m, input.marks, hash, Date.now());
      setRun((cur) => {
        if (cur === null || cur.folder !== asked.folder || cur.hash !== asked.hash || cur.view !== asked.view || cur.replay !== null) return cur;
        if (r === null || r.length === 0) return null;
        return { ...cur, model: m, replay: r, note: replayNote(r.from, historyFrom, answered), historyFrom, startedAt: Date.now() };
      });
    });
  };
  // Playing: a timer to the next change, and the end of the run at the
  // end of the replay unless a seek holds it, the end decided in the
  // timer by an updater so a seek that lands first keeps the run.
  useEffect(() => {
    if (run === null || runReplay === null || run.pausedAt !== null) return;
    const next = nextChange(runReplay, replayAtNow);
    const timer = setTimeout(
      () => {
        if (next >= runReplay.length) setRun((cur) => (cur === null || cur.replay !== runReplay || cur.pausedAt !== null ? cur : null));
        else setReplayTick((n) => n + 1);
      },
      Math.max(0, next - replayAtNow) + 1,
    );
    return () => clearTimeout(timer);
  }, [run, runReplay, replayAtNow]);
  // A change of folder or view ends it.
  useEffect(() => {
    if (run !== null && (run.folder !== folder || run.view !== view)) setRun(null);
  }, [run, folder, view]);
  // Escape stops it, and never reaches a focused terminal, where it would
  // interrupt Claude (fix 848's shape); an open card's own Escape still
  // closes the card.
  const replaying = run !== null;
  useEffect(() => {
    if (!replaying) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      setRun(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [replaying]);
  // A seek, for the script alone: no product control sends it. It holds
  // the replay at the time asked until Escape or a play. A layout effect, so the
  // listener is there by the time the replay's first frame is in the DOM:
  // a fixture's replay plays in tens of milliseconds, and the script's
  // seek goes out the moment it sees the panel on.
  useLayoutEffect(() => {
    if (runReplay === null) return;
    const length = runReplay.length;
    const onSeek = (ev: Event) => {
      const at = Number((ev as CustomEvent<{ at: number }>).detail?.at);
      if (!Number.isFinite(at)) return;
      setRun((cur) => (cur === null ? cur : { ...cur, pausedAt: Math.max(0, Math.min(length, at)) }));
    };
    window.addEventListener('emerald:graph-replay-seek', onSeek);
    return () => window.removeEventListener('emerald:graph-replay-seek', onSeek);
  }, [runReplay]);
  const stopReplay = run === null ? null : () => setRun(null);
  const toggleReplay = () => setRun((cur) => (cur === null || cur.replay === null ? cur : { ...cur, ...togglePlay(cur, cur.replay.length, Date.now()) }));
  const scrubReplay = (at: number) => setRun((cur) => (cur === null || cur.replay === null ? cur : { ...cur, pausedAt: Math.max(0, Math.min(cur.replay.length, at)) }));
  // Space pauses and plays the replay (M9 fix 905), armed once the record
  // is in so Space passes through while it loads. It is taken in the
  // capture phase and never reaches a focused terminal, as Escape never
  // does (fix 848's shape), but a text field outside a terminal keeps its
  // space; Ctrl+Space is the prefix key and passes.
  const replayArmed = runReplay !== null;
  useEffect(() => {
    if (!replayArmed) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== ' ' || ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
      const el = ev.target instanceof HTMLElement ? ev.target : null;
      const typing = el !== null && el.closest('.xterm') === null && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'));
      if (typing) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleReplay();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // toggleReplay only calls setRun, which is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayArmed]);
  const replayShown: { replay: Replay; frame: ReplayFrame } | null = runReplay === null ? null : { replay: runReplay, frame: frameAt(runReplay, replayAtNow) };
  const blockKeys = model.blocks.map((b) => blockKey(b.sessionId));
  const draw = drawState(prefs, blockKeys);
  const drawnCount = model.blocks.filter((b) => b.drawn).length;
  // The way to one block's lines (M72), for its cards and its rows:
  // whether they draw, Show only this and the hide or show toggle.
  const linesOf = (sessionId: string | null): CardLines | null => {
    const b = model.blocks.find((x) => x.sessionId === sessionId);
    if (b === undefined) return null;
    const key = blockKey(sessionId);
    return { drawn: b.drawn, solo: () => choosePrefs({ ...prefs, ...soloLines(prefs, key) }), toggle: () => choosePrefs({ ...prefs, ...toggleLines(prefs, key, b.drawn) }) };
  };
  // What a row's menu calls the block: the session's name, the
  // conversation's title, or the outside commits.
  const blockName = (sessionId: string | null): string => {
    if (sessionId === null) return 'the outside commits';
    const b = model.blocks.find((x) => x.sessionId === sessionId);
    if (b?.history !== null && b?.history !== undefined) return b.history.title;
    // A person's block is named by the person, a remote block by the
    // branch (M9 fix 286).
    if (b?.person !== null && b?.person !== undefined) return b.person.name;
    if (b?.remote !== null && b?.remote !== undefined) return b.remote.branch;
    const span = spanIdOf(sessionId);
    const record = span === null ? (sessions.get(sessionId) ?? removed.get(sessionId)) : (sessions.get(span.sessionId) ?? removed.get(span.sessionId));
    if (record === undefined) return sessionId;
    // A record on its second conversation or later is named with the
    // span's ordinal, as its block is (M9 fix 185).
    return spanName(record.name, span?.ordinal ?? Math.max(1, record.spans?.length ?? 1));
  };
  // The session a stand-in for an earlier conversation span stands for
  // (M9 fix 185): the record's fields under the span's id, name,
  // conversation, claude.ai id and commits, exited, with the span's
  // end for the card's state line. Resume goes through the conversation
  // as a removed session's does, so it reaches that conversation.
  const spanSessionOf = (sessionId: string): LaneCardSession | undefined => {
    const span = spanIdOf(sessionId);
    if (span === null) return undefined;
    const record = sessions.get(span.sessionId) ?? removed.get(span.sessionId);
    const s = record?.spans?.[span.ordinal - 1];
    if (record === undefined || s === undefined) return undefined;
    const commits = spanCommits(record.commits, record.spans ?? [])[span.ordinal - 1] ?? [];
    const conversation = { id: s.conversation, cwd: record.conversation?.cwd ?? record.groupCwd, args: record.conversation?.args ?? [] };
    return { ...record, id: sessionId, name: spanName(record.name, span.ordinal), commits, team: [], state: 'exited', claudeSessionId: s.conversation, remoteSessionId: s.remoteSessionId, conversation, startHead: s.startHead, removedAt: s.endedAt ?? record.removedAt ?? null, spanEndedAt: s.endedAt };
  };
  // The card's Graph or Line toggle (M71): the block's own layout, and
  // the other one on a click, kept with the prefs.
  const layoutOf = (sessionId: string | null): CardLayout | null => {
    const b = model.blocks.find((x) => x.sessionId === sessionId);
    if (b === undefined) return null;
    const next: BlockLayout = b.layout === 'line' ? 'graph' : 'line';
    return { current: b.layout, toggle: () => choosePrefs({ ...prefs, layout: { ...prefs.layout, [blockKey(sessionId)]: next } }) };
  };
  const unowned = model.items.some((it) => it.kind === 'commit' && it.sessionId === null && it.commit.claudeSession !== null && it.commit.claudeSession !== undefined);
  useEffect(() => {
    if (unowned) ensureHistoryTranscripts();
  }, [unowned]);
  // The card a lane opens (M60): one anchor id per session, since every
  // line and node of a session's block stands for the same session and
  // a press on any of them is the click that pins. A subagent's branch
  // pill opens the parent's card with the agent named (M9 fix 110),
  // under an anchor id of its own so the parent's own lane and the
  // agent's are two cards.
  // The bars on a block's lanes (M9 fix 152), each with the hash of the
  // commit on its row, newest first, for the card's lines: a bar has no
  // words on the picture, and hovering one opens the block's card. The
  // dot's landing flag (M9 fix 399) rides along, so the card can tell a
  // fork bar's landing from a lane's own end.
  const barsOf = (sessionId: string | null): CardBar[] =>
    model.dots
      .filter((d) => d.shape === 'bar' && d.sessionId === sessionId)
      .sort((a, b) => a.row - b.row)
      .flatMap((d) => {
        const it = model.items[d.row];
        return it !== undefined && it.kind === 'commit' ? [{ kind: d.kind, hash: it.commit.hash, ...(d.landing === true ? { landing: true as const } : {}) }] : [];
      });
  const cardFor = (session: LaneCardSession, agent?: LaneCardAgent): LaneCardAnchor => {
    const id = agent === undefined ? `lane:${session.id}` : `lane:${session.id}:${agent.memberId}`;
    return { id, card: (props) => <LaneCard session={session} shown={graph.commits} now={now} anchorId={id} agent={agent ?? null} layout={layoutOf(session.id)} lines={linesOf(session.id)} bars={barsOf(session.id)} {...props} /> };
  };
  // A removed session's lane opens its card too (M9 fix 111): the store
  // keeps the removed records apart, and the card reads the same fields.
  // A history lane (M70) opens the conversation's card, off the
  // transcript the scan listed under the lane's id.
  const cardOf = (sessionId: string, agent?: LaneCardAgent): LaneCardAnchor | null => {
    const transcriptId = historyIdOf(sessionId);
    if (transcriptId !== null) {
      const t = [...history.values()].find((x) => x.id === transcriptId);
      if (t === undefined) return null;
      const id = `lane:${sessionId}`;
      const mine = model.items.flatMap((it) => (it.kind === 'commit' && it.sessionId === sessionId ? [it.commit] : []));
      const color = model.blocks.find((b) => b.sessionId === sessionId)?.color ?? null;
      return { id, card: (props) => <HistoryCard transcript={t} mine={mine} color={color} now={now} anchorId={id} layout={layoutOf(sessionId)} lines={linesOf(sessionId)} {...props} /> };
    }
    // A person's block and a remote block (M9 fix 286) open cards of
    // their own kind, off the block's commits in the shown log.
    const person = personNameOf(sessionId);
    const remoteBranch = remoteBranchOf(sessionId);
    if (person !== null || remoteBranch !== null) {
      const id = `lane:${sessionId}`;
      const mine = model.items.flatMap((it) => (it.kind === 'commit' && it.sessionId === sessionId ? [it.commit] : []));
      const color = model.blocks.find((b) => b.sessionId === sessionId)?.color ?? null;
      if (person !== null) return { id, card: (props) => <PersonCard name={person} mine={mine} color={color} anchorId={id} layout={layoutOf(sessionId)} lines={linesOf(sessionId)} bars={barsOf(sessionId)} {...props} /> };
      return { id, card: (props) => <RemoteCard branch={remoteBranch!} mine={mine} fetchedAt={graph.fetchedAt} now={now} anchorId={id} layout={layoutOf(sessionId)} lines={linesOf(sessionId)} bars={barsOf(sessionId)} {...props} /> };
    }
    const own = sessions.get(sessionId) ?? removed.get(sessionId);
    // A record on its second conversation or later (M9 fix 185) wears
    // the ordinal its block does.
    const s = own === undefined ? spanSessionOf(sessionId) : (own.spans?.length ?? 0) >= 2 ? { ...own, name: spanName(own.name, own.spans!.length) } : own;
    return s === undefined ? null : cardFor(s, agent);
  };
  // The agent's own card, off its marker (M65); a session's own row
  // (M68) opens the same card about the session.
  const agentCard = (item: AgentItem): LaneCardAnchor | null => {
    const s = sessions.get(item.sessionId) ?? removed.get(item.sessionId);
    if (s === undefined) return null;
    const id = `agent:${item.sessionId}:${item.member?.id ?? 'own'}`;
    return { id, card: (props) => <AgentCard member={item.member} session={s} now={now} anchorId={id} {...props} /> };
  };
  // The mark and the sideways label of a row: the agent's, or the
  // session's own by the sidebar's reading (M68). A member's label says
  // its kind, not its state (M9 fix 398): `subagent`, then the word
  // Claude Code names it by when the record has one (`subagent · fork`),
  // the same words the upright pill and the agent card wear, ending in
  // its name; the mark already steps while the member works, so the
  // state word is not needed here too.
  const agentMark = (item: AgentItem): { kind: 'claude' | 'shell'; label: string; family: string | null } => {
    if (item.member !== null) return { kind: 'claude', label: `${agentRole(item.member)} · ${agentLabel(item.member)}`, family: null };
    const s = sessions.get(item.sessionId) ?? removed.get(item.sessionId);
    return s === undefined ? { kind: 'claude', label: '', family: null } : { kind: markKind(s), label: `${describeState(s).text} · ${spanName(s.name, Math.max(1, s.spans?.length ?? 1))}`, family: null };
  };
  // The session's branch as the daemon reads it, else the graph's own read
  // of HEAD: a view in a pane (M52) has no session behind it. The
  // checkout's folder name beside it (M9 fix 148), since the panel
  // follows the focused pane's folder and nothing else on it says which
  // repository the log is; one stray row read as two projects merged.
  const shownBranch = branch ?? graph.head ?? graph.headHash?.slice(0, 7) ?? null;
  // Initialise a repository (M9 fix 255): the main process runs git init
  // in the folder and pushes the folder as a change, so the poll reads
  // the new repository and the panel turns into the commit graph.
  const [initError, setInitError] = useState<string | null>(null);
  const initRepo = () => {
    if (folder === null) return;
    setInitError(null);
    void window.emerald.files.gitInit(folder).then((r) => {
      if (r.error !== null) setInitError(r.error);
    });
  };
  // The menu's commit and its block's items (M9 fix 869 reads the first).
  const menuHash = menu?.hash ?? null;
  const menuBlockItems = menu === null ? [] : blockItems(menu.block, menu.block === null ? null : linesOf(menu.block === OUTSIDE_KEY ? null : menu.block), menu.block === null ? '' : blockName(menu.block === OUTSIDE_KEY ? null : menu.block), () => setMenu(null));
  return (
    <div className="commits-panel" data-folder={folder ?? undefined} data-graph={folder === null ? undefined : pending ? 'pending' : graph.root === null ? 'none' : 'ready'} data-view={view} data-lanes={model.lanes.length} data-blocks={model.blocks.length} data-columns={model.columns} data-drawn={drawnCount} data-draw={draw} data-orientation={prefs.orientation} data-reverse={prefs.reverse ? '' : undefined} data-controls={inPane ? (folded ? 'folded' : 'shown') : undefined} data-rows={rows ? 'on' : 'off'} data-remotes={withRemotes ? 'on' : 'off'} data-replay={run === null ? undefined : run.replay === null ? 'loading' : 'on'} data-replay-at={runReplay === null ? undefined : String(replayAtNow)} data-replay-length={runReplay === null ? undefined : String(runReplay.length)} data-replay-paused={run === null || runReplay === null || run.pausedAt === null ? undefined : ''}>
      {graph.root !== null && shownBranch !== null && !folded && (
        <div className="commits-branch" title={`The branch checked out in ${graph.root}`}>
          <span className="commits-branch-glyph">⑂</span>
          <span className="commits-branch-name">{branchText(shownBranch)}</span>
          <span className="commits-branch-folder" data-folder={graph.root}>{folderName(graph.root) || graph.root}</span>
        </div>
      )}
      {noRepo && !folded && (
        <div className="commits-norepo" data-error={initError ?? undefined}>
          <span className="commits-norepo-note">Not a git repository</span>
          <button className="files-button commits-init" title={`Run git init in ${folder}; the panel then draws its commits`} onClick={initRepo}>
            Initialise a repository
          </button>
          {initError !== null && (
            <span className="commits-norepo-error" title={initError}>
              {initError}
            </span>
          )}
        </div>
      )}
      {noRepo && !folded && writeInput !== null && writeInput.sessions.length > 0 && (
        <div className="commits-ledger">
          {writeInput.sessions.map((ws) => {
            const s = sessions.get(ws.id) ?? removed.get(ws.id);
            if (s === undefined) return null;
            const label = describeState(s);
            const color = model.blocks.find((b) => b.sessionId === ws.id)?.color ?? s.color;
            const cost = s.costUsd === null || s.costUsd === undefined ? null : formatUsd(s.costUsd);
            const tokens = tokensRowText(s);
            const n = ws.commits.length;
            return (
              <div key={ws.id} className="commits-ledger-row" data-session={ws.id} data-tone={label.tone} style={color === null ? undefined : ({ '--lane': color } as React.CSSProperties)}>
                <span className="commits-ledger-name" title={s.name}>
                  {s.name}
                </span>
                {cost !== null && <span className="commits-ledger-cost">{cost}</span>}
                <span className="commits-ledger-state" data-tone={label.tone}>{`${label.text} ${formatDuration(s.stateSince, now)}`}</span>
                <span className="commits-ledger-writes">{`${n} ${n === 1 ? 'write' : 'writes'}`}</span>
                {/* The tokens last and the first to give way under a narrow rail: the name, the cost, the state and the count are what a glance wants. */}
                {tokens !== null && (
                  <span className="commits-ledger-tokens" title={tokens}>
                    {tokens}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {(graph.root !== null || noRepo) && !folded && (
        <div className="commits-tools">
          <span className="commits-switch" role="group" aria-label="Commits view">
            <button className="commits-chip" data-view="graph" data-active={view === 'graph' || undefined} title="Each session as its own graph, a lane per subagent worktree" onClick={() => chooseView('graph')}>
              Graph
            </button>
            <button className="commits-chip" data-view="list" data-active={view === 'list' || undefined} title="The same rows, one straight line per session" onClick={() => chooseView('list')}>
              List
            </button>
          </span>
          {/* Which blocks draw lanes (M72): every one, or the sessions with a sidebar row; `some` while a card or a row has hidden a block or shown one alone, and a click on it brings everything back. The rows never change. */}
          <span className="commits-switch commits-draw" role="group" aria-label="Which sessions draw lanes">
            {draw === 'some' ? (
              <button className="commits-chip" data-draw="some" data-active="" title="Some blocks are hidden or one is shown alone; click for every block" onClick={() => choosePrefs({ ...prefs, ...clearLines(prefs) })}>
                some
              </button>
            ) : (
              <>
                <button className="commits-chip" data-draw="all" data-active={draw === 'all' || undefined} title="Lanes for every block: the sessions, the conversations found on disk and the outside commits" onClick={() => choosePrefs({ ...prefs, draw: 'all' })}>
                  all
                </button>
                <button className="commits-chip" data-draw="active" data-active={draw === 'active' || undefined} title="Lanes for the sessions in the sidebar alone; the rows stay whole" onClick={() => choosePrefs({ ...prefs, draw: 'active' })}>
                  active
                </button>
              </>
            )}
          </span>
          {/* The remote branches (M9 fix 286): off by default, and while on the read carries every branch on the remote too, the outside card and the remote blocks' saying how old the fetch is. */}
          {remotesProp && (
            <button className="commits-chip commits-remotes" data-remotes={prefs.remotes ? 'on' : 'off'} data-active={prefs.remotes || undefined} title={prefs.remotes ? 'The remote branches are on the graph, as of the last fetch; click for the local branches alone' : 'Put every branch on the remote onto the graph too, as of the last fetch'} onClick={() => choosePrefs({ ...prefs, remotes: !prefs.remotes })}>
              remotes
            </button>
          )}
          <button
            className="files-button commits-orient"
            title={prefs.orientation === 'vertical' ? 'Draw the graph on its side, time left to right' : 'Draw the graph upright, time top to bottom'}
            onClick={() => choosePrefs({ ...prefs, orientation: prefs.orientation === 'vertical' ? 'horizontal' : 'vertical' })}
          >
            {prefs.orientation === 'vertical' ? '⇆' : '⇅'}
          </button>
          {/* The direction (M9 fix 162): the menu's Newest first and Oldest first as one button, its glyph the way time will run after the click. */}
          <button className="files-button commits-direction" title={directionTitle(prefs, !prefs.reverse)} onClick={() => choosePrefs({ ...prefs, reverse: !prefs.reverse })}>
            {directionGlyph(prefs)}
          </button>
          {onRows !== undefined && (
            <button className="files-button commits-rows" data-active={rows ? undefined : ''} title={rows ? 'The graph alone: hide the commit rows and label the lanes in the drawing' : 'Show the commit rows beside the graph'} onClick={() => onRows(!rows)}>
              ☰
            </button>
          )}
          <button className="files-button commits-centre" title={CENTRE_TITLE} onClick={() => centre.current?.()}>
            ◎
          </button>
          {onExpand !== undefined && folder !== null && (
            <button className="files-button commits-expand" title="Open the graph as a tab" onClick={() => onExpand(folder, snapshot())}>
              <TabIcon />
            </button>
          )}
          {onOpenPane !== undefined && folder !== null && (
            <button className="files-button commits-open-pane" title="Open the graph in a pane" onClick={() => onOpenPane(folder, snapshot())}>
              <PaneIcon />
            </button>
          )}
          {onFold !== undefined && (
            <button className="files-button commits-controls-fold" title="Hide the chrome, the title bar and these controls; right-click the pane to bring them back" onClick={onFold}>
              ▴
            </button>
          )}
        </div>
      )}
      {run !== null && runReplay !== null && (
        <ReplayStrip run={run} replay={runReplay} onToggle={toggleReplay} onScrub={scrubReplay} />
      )}
      <div className="files-list">
        {folder === null && <div className="files-empty">No session in this pane</div>}
        {noRepo && model.items.length === 0 && <div className="files-empty">No session has written a file here</div>}
        {graph.root !== null && graph.commits.length === 0 && <div className="files-empty">No commits yet</div>}
        {(graph.root !== null || noRepo) && model.items.length > 0 && (
          <GraphView model={run?.model ?? model} replay={replayShown} onStop={stopReplay} graph={graph} writes={writes} sessionList={sessionList} prefs={prefs} rows={rows} fresh={fresh} now={now} createdAt={createdAt} onMenu={folded ? null : (x, y, block, hash) => setMenu({ x, y, block, hash })} centre={centre} cardOf={cardOf} agentCard={agentCard} agentMark={agentMark} linesOf={linesOf} focusedSessionId={focusedSessionId} onScale={onScale} withRemotes={withRemotes} />
        )}
      </div>
      {menu !== null && (
        <Menu
          x={menu.x}
          y={menu.y}
          className="commits-menu"
          onClose={() => setMenu(null)}
          items={[
            ...menuBlockItems,
            // A folder with no repository draws writes, not commits, so
            // it offers no replay (M9 fix 869).
            ...(menuHash === null || graph.root === null
              ? []
              : [
                  {
                    label: 'Replay from here',
                    title: "Replay the graph from this commit as it happened, faster: the later rows dim and come back as their commits land, and the agents' marks turn on and off as they did; Escape stops it",
                    separator: menuBlockItems.length > 0,
                    onClick: () => {
                      setMenu(null);
                      startReplay(menuHash);
                    },
                  },
                ]),
            ...directionItems(prefs, (reverse) => {
              choosePrefs({ ...prefs, reverse });
              setMenu(null);
            }).map((item, i) => (i === 0 && menuHash !== null && graph.root !== null ? { ...item, separator: true } : item)),
            {
              label: '  Centre the graph',
              title: CENTRE_TITLE,
              separator: true,
              onClick: () => {
                centre.current?.();
                setMenu(null);
              },
            },
          ]}
        />
      )}
    </div>
  );
}

// What the centre button and its menu item say (M9 fix 170).
const CENTRE_TITLE = 'Centre the graph in the pane';

// The graph's right-click menu: which way time runs, the current way
// ticked.
function directionItems(prefs: GraphPrefs, choose: (reverse: boolean) => void): MenuItem[] {
  const tick = (on: boolean) => (on ? '✓ ' : '  ');
  return [
    { label: `${tick(!prefs.reverse)}Newest first`, title: directionTitle(prefs, false), onClick: () => choose(false) },
    { label: `${tick(prefs.reverse)}Oldest first`, title: directionTitle(prefs, true), onClick: () => choose(true) },
  ];
}

// Where the newest commit sits under a direction, for the menu items
// and the button (M9 fix 162), which names the result of its click.
function directionTitle(prefs: GraphPrefs, reverse: boolean): string {
  const upright = prefs.orientation === 'vertical';
  if (upright) return reverse ? 'The newest commit at the bottom' : 'The newest commit at the top';
  return reverse ? 'The newest commit at the left' : 'The newest commit at the right';
}

// The button's glyph is the way time runs now: down or up upright,
// right or left on its side.
function directionGlyph(prefs: GraphPrefs): string {
  if (prefs.orientation === 'vertical') return prefs.reverse ? '↑' : '↓';
  return prefs.reverse ? '←' : '→';
}

// The items for the block of the row a right click opened on (M72):
// its lines alone, and hide or show its lines, named after the block.
// Once a block's lines are hidden no lane is left to hover, so the row
// is the way back to them.
function blockItems(block: string | null, lines: CardLines | null, name: string, close: () => void): MenuItem[] {
  if (block === null || lines === null) return [];
  return [
    { label: `Show only ${name}'s lines`, title: 'Lanes for this block alone; the rows stay whole', onClick: () => { close(); lines.solo(); } },
    { label: lines.drawn ? 'Hide its lines' : 'Show its lines', title: lines.drawn ? 'No lanes for this block; its rows stay' : 'Lanes for this block again', onClick: () => { close(); lines.toggle(); } },
  ];
}

function readPrefs(): GraphPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPH_KEY) ?? '{}') as Partial<GraphPrefs>;
    const layout: Record<string, BlockLayout> = {};
    if (raw.layout !== undefined && raw.layout !== null && typeof raw.layout === 'object') {
      for (const [k, v] of Object.entries(raw.layout)) if (v === 'graph' || v === 'line') layout[k] = v;
    }
    const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((h): h is string => typeof h === 'string') : [];
    return { orientation: raw.orientation === 'horizontal' ? 'horizontal' : 'vertical', reverse: raw.reverse === true, layout, draw: raw.draw === 'active' ? 'active' : 'all', hidden, solo: typeof raw.solo === 'string' ? raw.solo : null, rows: raw.rows !== false, scale: isGraphScale(raw.scale) ? raw.scale : 1, remotes: raw.remotes === true };
  } catch {
    return { orientation: 'vertical', reverse: false, layout: {}, draw: 'all', hidden: [], solo: null, rows: true, scale: 1, remotes: false };
  }
}

// M9 fix 178: the prefs a handed-in state stands for, and back. The
// state keeps only the fields away from their defaults, so a pane at the
// defaults has a bare record.
function prefsOf(state: GraphViewState, rows: boolean): GraphPrefs {
  return { orientation: state.orientation ?? 'vertical', reverse: state.reverse ?? false, layout: { ...(state.layout ?? {}) }, draw: state.draw ?? 'all', hidden: [...(state.hidden ?? [])], solo: state.solo ?? null, rows, scale: state.scale ?? 1, remotes: state.remotes === true };
}

function stateOf(prefs: GraphPrefs, view: GraphMode): GraphViewState {
  return cleanGraph({ mode: view, orientation: prefs.orientation, reverse: prefs.reverse, draw: prefs.draw, hidden: prefs.hidden, solo: prefs.solo, layout: prefs.layout, scale: prefs.scale, remotes: prefs.remotes });
}

function readView(): GraphMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'graph';
  } catch {
    return 'graph';
  }
}

// The card for a session's lane, or null for a session the store no
// longer lists.
type CardOf = (sessionId: string, agent?: LaneCardAgent) => LaneCardAnchor | null;

// The graph beside its rows when upright, a row per item of the model
// so a row's place is its index times the row height, the rows since
// the session started keeping their brighter text, a branch's pill on
// the commit it sits on. On its side the graph is the whole view,
// scrolled sideways, its labels drawn in the SVG. Either way the rows
// are in the model's order; the drawing turns them round when reversed.
// A right click offers the direction. With rows off (M9 fix 162, a
// pane's view record or the prefs) the upright view is the gutter alone,
// with no labels in it (M9 fix 173); the cards name the lanes.
// onMenu null (M9 fix 179): a chromeless pane's right-click is the pane
// menu's alone, the way back to the chrome, so the view's own menu
// yields and the event reaches the pane.
// onScale (M9 fix 213): Ctrl+wheel over the view steps the zoom through
// it, the point under the pointer kept where it is; null when the pane's
// daemon cannot keep the field, and the chord does nothing.
// replay and onStop (M9 fix 869): a replay's timing and the frame on
// show, drawn over the held model, and the way back to the live graph,
// which a click or a right-click on the view takes; null when none runs.
function GraphView({ model, replay, onStop, graph, writes, sessionList, prefs, rows, fresh, now, createdAt, onMenu, centre, cardOf, agentCard, agentMark: markOf, linesOf, focusedSessionId, onScale, withRemotes }: { model: SessionGraph; replay: { replay: Replay; frame: ReplayFrame } | null; onStop: (() => void) | null; graph: GitGraph; writes: ReadonlyMap<string, GraphWrite>; sessionList: readonly SessionInfo[]; prefs: GraphPrefs; rows: boolean; fresh: ReadonlySet<string>; now: number; createdAt: number | null; onMenu: ((x: number, y: number, block: string | null, hash: string | null) => void) | null; centre: React.MutableRefObject<(() => void) | null>; cardOf: CardOf; agentCard: (item: AgentItem) => LaneCardAnchor | null; agentMark: (item: AgentItem) => { kind: 'claude' | 'shell'; label: string; family: string | null }; linesOf: (sessionId: string | null) => CardLines | null; focusedSessionId: string | null; onScale: ((scale: number) => void) | null; withRemotes: boolean }) {
  const start = createdAt === null ? null : Math.floor(createdAt / 1000) * 1000;
  const merged = new Set(graph.merged);
  // The cards: one per session block (M60), and one per branch pill,
  // the session on the branch or the parent of the agent on it (M61,
  // fix 110).
  const cards = new Map<string, LaneCardAnchor>();
  for (const lane of model.lanes) {
    if (lane.sessionId === null || cards.has(lane.sessionId)) continue;
    const c = cardOf(lane.sessionId);
    if (c !== null) cards.set(lane.sessionId, c);
  }
  const branchNames = graph.commits.flatMap((c) => c.refs);
  const agents = laneAgents(branchNames, sessionList);
  const pillCards = new Map<string, LaneCardAnchor>();
  for (const [b, s] of laneSessions(branchNames, sessionList)) {
    const agent = agents.get(b);
    const c = cardOf(s.id, agent === undefined ? undefined : { label: agent.label, memberId: agent.memberId });
    if (c !== null) pillCards.set(b, c);
  }
  const nameOf = new Map(sessionList.map((s) => [s.id, s.name]));
  // A history lane's commits are named by the conversation (M70), and
  // an earlier span's block by the span's name (M9 fix 185, spanName).
  for (const b of model.blocks) {
    if (b.history !== null && b.sessionId !== null) nameOf.set(b.sessionId, b.history.title);
    else if (b.person !== null && b.sessionId !== null) nameOf.set(b.sessionId, b.person.name);
    else if (b.remote !== null && b.sessionId !== null) nameOf.set(b.sessionId, b.remote.branch);
    else if (b.sessionId !== null && !nameOf.has(b.sessionId)) {
      const span = spanIdOf(b.sessionId);
      const name = span === null ? undefined : nameOf.get(span.sessionId);
      if (span !== null && name !== undefined) nameOf.set(b.sessionId, spanName(name, span.ordinal));
    }
  }
  const sessionOf = new Map(sessionList.map((s) => [s.id, s]));
  // The record behind a block's id (M9 fix 252): an earlier span's
  // block draws under a stand-in id, and the price is read off the
  // record whole, which credits every span's commits.
  const recordOf = (id: string | null): SessionInfo | null => (id === null ? null : (sessionOf.get(spanIdOf(id)?.sessionId ?? id) ?? null));
  // A replayed agent row's record (M9 fix 869): a span part's id is not
  // in sessionOf, so the row reaches its record and wears the part's name.
  const replayRecord = (id: string): SessionInfo | null => {
    const r = recordOf(id);
    const name = nameOf.get(id);
    return r === null || name === undefined ? r : { ...r, name };
  };
  const ownerOf = new Map<string, string>();
  for (const it of model.items) if (it.kind === 'commit' && it.sessionId !== null) ownerOf.set(it.commit.hash, it.sessionId);
  const recordOfHash = (hash: string): SessionInfo | null => recordOf(ownerOf.get(hash) ?? null);
  // The transcripts' requests behind the rows' dollars cells and the
  // cards (fix 252), asked for once per change of the records' commits
  // or conversations for every conversation a session with commits
  // hosted; an unchanged transcript costs a stat. Keyed on the records
  // rather than the graph object (M9 fix 352): the poll's read is a
  // fresh object even when the log is unchanged, and every read used to
  // re-ask a hundred conversations and render the rows twice per
  // conversation on a long-lived home. The set asked is read off the
  // records alone, so the graph's own commits are not in the key: a
  // commit the graph shows before its record credits it would ask the
  // same set again and find nothing, and the members' commits count
  // beside the session's own so an agent's commit re-asks too.
  const { lists } = useConversationUsage();
  const conversationsKey = sessionList.map((s) => `${s.id}:${s.commits.length}+${(s.team ?? []).reduce((n, m) => n + m.commits.length, 0)}:${(s.spans ?? []).map((sp) => sp.conversation).join('+')}`).join(',');
  useEffect(() => {
    const asked = new Set<string>();
    for (const s of sessionList) {
      const commits = [...s.commits, ...(s.team ?? []).flatMap((m) => m.commits)];
      for (const c of commits) {
        const conversation = conversationAt(s, c.at);
        if (conversation !== null) asked.add(conversation);
      }
    }
    for (const c of asked) askUsage(c);
    // The key stands in for sessionList, whose identity moves on every
    // push.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationsKey]);
  const pricing: Pricing = { commits: graph.commits, recordOfHash, lists };
  // The model word an agent row wears in front of its state (fix 287):
  // the record's own model on the session's row, or the last request an
  // agent has made in the conversation the record is hosting now on a
  // member's; null (so the row draws nothing) until the status line or
  // that first request has landed.
  const agentModel = (item: AgentItem, session: SessionInfo | undefined): string | null => {
    if (session === undefined) return null;
    if (item.member === null) return modelWord(session.model);
    const conversation = conversationAt(session, now);
    const messages = conversation === null ? null : (lists.get(conversation) ?? null);
    const mine = (messages ?? []).filter((m) => m.agentId === item.member!.id);
    return mine.length === 0 ? null : modelWord(mine[mine.length - 1]!.model);
  };
  // The side label wears the same word (M9 fix 287), so a row's mark on
  // the graph reads the same as its upright row; the same word is the
  // family the marker's star reads (M9 fix 292), null on the session's
  // own row and on a member with no request yet.
  const agentMark = (item: AgentItem): { kind: 'claude' | 'shell'; label: string; family: string | null } => {
    const mark = markOf(item);
    const word = agentModel(item, sessionOf.get(item.sessionId));
    return { ...mark, family: word, label: word === null ? mark.label : `${word} ${mark.label}` };
  };
  // A row's colour is its block's (M71), by the session behind it, since
  // a slot is a column several blocks share.
  const blockColor = new Map(model.blocks.map((b) => [b.sessionId, b.color]));
  const colorOf = (sessionId: string | null) => blockColor.get(sessionId) ?? null;
  // Which branch a row's commit is on (M9 fix 214), as a depth off the
  // trunk the subject leans by, and its name (M9 fix 253) for the card
  // and the lean's tooltip; one walk per log read.
  const branches = useMemo(() => commitBranches(graph.commits, graph.defaultBranch), [graph]);
  // The branch a twin's row sits on (M9 fix 304), for the card's lines:
  // the ref pill's name when the row has one, else the branch fix 253
  // walked it onto, else the lane's session name, else the short hash.
  const itemOf = new Map(model.items.flatMap((it) => (it.kind === 'commit' ? [[it.commit.hash, it] as const] : [])));
  const branchOfHash = (hash: string): string => {
    const it = itemOf.get(hash);
    const ref = it?.commit.refs[0] ?? branches.get(hash)?.branch ?? null;
    if (ref !== null) return ref;
    const name = it?.sessionId === null || it === undefined ? undefined : nameOf.get(it.sessionId);
    return name ?? hash.slice(0, 7);
  };
  // The outside block's card (M68): the commits nobody here made, and
  // why, off the block's lines and nodes; none when there is no block.
  const outside = model.items.flatMap((it) => (it.kind === 'commit' && it.sessionId === null ? [it.commit] : []));
  const onHistory = model.items.filter((it) => it.kind === 'commit' && historyIdOf(it.sessionId) !== null).length;
  const outsideBars: CardBar[] = model.dots
    .filter((d) => d.shape === 'bar' && d.sessionId === null)
    .sort((a, b) => a.row - b.row)
    .flatMap((d) => {
      const it = model.items[d.row];
      return it !== undefined && it.kind === 'commit' ? [{ kind: d.kind, hash: it.commit.hash }] : [];
    });
  // The fetch line (M9 fix 286) while the remote branches are on.
  const fetched = withRemotes ? { at: graph.fetchedAt, now } : undefined;
  const outsideCard: LaneCardAnchor | null = outside.length === 0 ? null : { id: 'lane:outside', card: (props) => <OutsideCard outside={outside} history={onHistory} anchorId="lane:outside" lines={linesOf(null)} bars={outsideBars} fetched={fetched} {...props} /> };
  // The commit whose row is hovered or whose card is open (M9 fix 254):
  // the graph raises its node's leader. The row reports both, since the
  // card outlives the hover once pinned.
  const [raised, setRaised] = useState<string | null>(null);
  const onRaise = useCallback((hash: string, on: boolean) => setRaised((cur) => (on ? hash : cur === hash ? null : cur)), []);
  // The conflict forecast (M9 fix 320) against this graph: the ties
  // between the pairs' newest nodes; the
  // empty report reads as no ties, and a folder with no repository has
  // no branches to pair.
  const { conflicts, sessions: liveSessions } = useStore('conflicts', 'sessions');
  const forecast = conflicts.conflicts.length === 0 && Object.keys(conflicts.base).length === 0 ? null : conflictReading(model, conflicts, conflictPeers(liveSessions), now);
  // During a replay (M9 fix 869) the picture is the frame's: no flash,
  // since several commits can land at once and the flash animates a
  // node's radius on the main thread, and no forecast or focus band,
  // both readings of now rather than of the record.
  const picture =
    replay === null ? (
      <CommitGraph graph={model} orientation={prefs.orientation} reverse={prefs.reverse} merged={merged} fresh={fresh} cards={cards} labelCards={pillCards} agentCard={agentCard} agentMark={agentMark} outsideCard={outsideCard} now={now} bare={!rows} focusedSessionId={focusedSessionId} scale={prefs.scale} raisedHash={raised} forecast={forecast} />
    ) : (
      <CommitGraph graph={replayGraph(model, replay.frame)} hidden={replay.frame.hidden} orientation={prefs.orientation} reverse={prefs.reverse} merged={merged} fresh={NO_FRESH} cards={cards} labelCards={pillCards} agentCard={agentCard} agentMark={agentMark} outsideCard={outsideCard} now={now} bare={!rows} focusedSessionId={null} scale={prefs.scale} raisedHash={raised} forecast={null} />
    );
  // The rows' clock: the record's time on show during a replay.
  const rowNow = replay === null ? now : replay.frame.record;
  // A click on the graph ends a replay and pins no card on the same
  // click; a right-click ends it and goes on, so the menu opens on the
  // live graph.
  const stopHandlers =
    onStop === null
      ? {}
      : {
          onClickCapture: (ev: React.MouseEvent) => {
            ev.stopPropagation();
            onStop();
          },
          onContextMenuCapture: () => onStop(),
        };
  // The zoom's variable (fix 213): the CSS reads the scale for the stroke
  // weights, the dot radii, the marks and the rows.
  const zoomStyle = { '--commits-scale': prefs.scale } as React.CSSProperties;
  const onContextMenu = (ev: React.MouseEvent) => {
    if (onMenu === null) return;
    ev.preventDefault();
    onMenu(ev.clientX, ev.clientY, null, null);
  };
  const viewRef = useRef<HTMLDivElement>(null);
  // The room past the ends (fixes 129 and 169): on its side, and upright
  // with the rows off; upright with rows the list ends at its last row.
  const roomAxis: RoomAxis = prefs.orientation === 'horizontal' ? 'x' : rows ? null : 'y';
  // The rows the picture spans (M9 fix 211): with the rows off the
  // drawn range, whose newest end is the tip the room is parked from.
  useRoom(viewRef, roomAxis, prefs.reverse, drawnRange(model, roomAxis !== null).count);
  // The centre action (fix 170) for the tools row and the menu, which
  // live in the panel: set after each render, since it reads this view's
  // box; upright with rows it centres the drawn blocks in the list.
  const acrossAxis: 'x' | 'y' = prefs.orientation === 'horizontal' ? 'x' : 'y';
  const hold = useCentred(viewRef, acrossAxis, roomAxis !== null);
  useLayoutEffect(() => {
    centre.current = () => {
      if (viewRef.current === null) return;
      centreGraph(viewRef.current, acrossAxis, prefs.reverse, roomAxis !== null);
      hold();
    };
    return () => {
      centre.current = null;
    };
  });
  // The offset across the axis (fix 175) is one variable read as a
  // margin on whichever side leads, so a turn of the view or the rows
  // coming back drops it rather than carrying a top margin over as a
  // left one.
  useLayoutEffect(() => {
    viewRef.current?.style.removeProperty('--commits-centre');
  }, [prefs.orientation, rows]);
  // Ctrl+wheel steps the zoom (fix 213), the way the terminal's steps its
  // text size: capture and not passive, so the box never scrolls on it.
  // The point under the pointer along the time axis is noted as a
  // distance into the SVG and its place in the box, and once the scaled
  // picture has rendered the scroll is set so that point is back under
  // the pointer; the box is the view on its side and the panel's list
  // upright, the same as the rooms read.
  const zoomAxis: 'x' | 'y' = prefs.orientation === 'horizontal' ? 'x' : 'y';
  const pendingZoom = useRef<{ offset: number; into: number; from: number } | null>(null);
  useEffect(() => {
    const el = viewRef.current;
    if (el === null || onScale === null) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const next = stepScale(prefs.scale, ev.deltaY < 0 ? 1 : -1);
      if (next === prefs.scale) return;
      const box = zoomAxis === 'x' ? el : el.parentElement;
      const svg = el.querySelector<SVGSVGElement>('.commits-graph');
      if (box !== null && svg !== null) {
        const br = box.getBoundingClientRect();
        const sr = svg.getBoundingClientRect();
        pendingZoom.current = zoomAxis === 'x' ? { offset: ev.clientX - br.left, into: ev.clientX - sr.left, from: prefs.scale } : { offset: ev.clientY - br.top, into: ev.clientY - sr.top, from: prefs.scale };
      }
      onScale(next);
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [onScale, prefs.scale, zoomAxis]);
  useLayoutEffect(() => {
    const z = pendingZoom.current;
    pendingZoom.current = null;
    const el = viewRef.current;
    if (z === null || el === null) return;
    const box = zoomAxis === 'x' ? el : el.parentElement;
    const svg = el.querySelector<SVGSVGElement>('.commits-graph');
    if (box === null || svg === null) return;
    const br = box.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const k = prefs.scale / z.from;
    if (zoomAxis === 'x') box.scrollLeft = sr.left - br.left + box.scrollLeft + z.into * k - z.offset;
    else box.scrollTop = sr.top - br.top + box.scrollTop + z.into * k - z.offset;
  }, [prefs.scale, zoomAxis]);
  const gutterRef = useRef<HTMLDivElement>(null);
  useCutFades(viewRef, gutterRef, prefs.orientation === 'vertical');
  // On its side the view is the scroller and the box around it carries
  // the fades (fix 187).
  const boxRef = useRef<HTMLDivElement>(null);
  useCutFades(boxRef, viewRef, prefs.orientation === 'horizontal');
  // The spacers in DOM order along the axis: the one past the newest end
  // first when the newest row is at the low end (upright unless reversed,
  // on its side when reversed), else last.
  const newestFar = prefs.orientation === 'horizontal' ? !prefs.reverse : prefs.reverse;
  const roomBefore = roomAxis === null ? null : <div className={newestFar ? 'commits-room-old' : 'commits-room'} />;
  const roomAfter = roomAxis === null ? null : <div className={newestFar ? 'commits-room' : 'commits-room-old'} />;
  if (prefs.orientation === 'horizontal') {
    return (
      <div ref={boxRef} className="commits-view-box">
        <div ref={viewRef} className="commits-graph-view" data-orientation="horizontal" data-reverse={prefs.reverse ? '' : undefined} data-scale={prefs.scale} style={zoomStyle} onContextMenu={onContextMenu} {...stopHandlers}>
          {roomBefore}
          {picture}
          {roomAfter}
        </div>
      </div>
    );
  }
  // Reversed, the rows read oldest first to match the gutter.
  const ordered = [...model.items];
  if (prefs.reverse) ordered.reverse();
  return (
    <div ref={viewRef} className="commits-graph-view" data-orientation="vertical" data-reverse={prefs.reverse ? '' : undefined} data-rows={rows ? 'on' : 'off'} data-scale={prefs.scale} style={zoomStyle} onContextMenu={onContextMenu} {...stopHandlers}>
      {roomBefore}
      {/* The box carries the fades at the cut edges (M9 fix 141); the gutter inside it is the scrolling one. */}
      <div className="commits-gutter-box">
        <div ref={gutterRef} className="commits-gutter">
          {picture}
        </div>
      </div>
      {roomAfter}
      {rows && (
      <div className="commits-graph-rows">
        {ordered.map((it) =>
          it.kind === 'agent' ? (
            <AgentRow key={`agent-${it.sessionId}-${it.member?.id ?? 'own'}`} item={it} session={replay === null ? (sessionOf.get(it.sessionId) ?? null) : replayRecord(it.sessionId)} color={colorOf(it.sessionId)} model={agentModel(it, sessionOf.get(it.sessionId))} now={now} card={agentCard(it)} replay={replay === null ? undefined : agentReplay(replay, it.row)} />
          ) : (
            <CommitRow key={it.commit.hash} item={it} write={writes.get(it.commit.hash) ?? null} ownerName={it.sessionId === null ? null : (nameOf.get(it.sessionId) ?? null)} color={colorOf(it.sessionId)} branch={branches.get(it.commit.hash) ?? null} defaultBranch={graph.defaultBranch} now={rowNow} recent={start !== null && it.commit.at >= start} lines={linesOf(it.sessionId)} record={recordOf(it.sessionId)} pricing={pricing} twins={twinInfo(it.commit, graph.commits, branchOfHash)} lit={raised !== null && (it.commit.twins?.includes(raised) ?? false)} onMenu={onMenu === null ? undefined : (x, y) => onMenu(x, y, blockKey(it.sessionId), it.commit.hash)} onRaise={onRaise} replay={replay === null ? undefined : { dim: replay.frame.hidden.has(it.row), lands: replay.replay.lands.get(it.row) ?? null }}>
              {it.commit.refs.map((b) => (
                <Pill key={b} branch={b} color={colorOf(it.sessionId)} merged={merged.has(b)} agent={agents.get(b) ?? null} card={replay === null ? (pillCards.get(b) ?? null) : null} />
              ))}
              {(it.commit.remoteRefs ?? []).map((b) => (
                <Pill key={`remote:${b}`} branch={b} color={colorOf(it.sessionId)} merged={merged.has(b)} agent={null} card={null} remote />
              ))}
            </CommitRow>
          ),
        )}
      </div>
      )}
    </div>
  );
}

// The branch name on the commit it sits on, in the row's session colour;
// a merged branch's draws dim. A branch a session is on opens that
// session's card (M60) on hover and on a click; a subagent's branch (M61)
// opens the parent's card with the agent named (fix 110), its tooltip
// saying whose branch it is.
// remote (M9 fix 286): a branch on the remote with no local branch of
// its name on the commit, dashed, its tooltip saying so.
function Pill({ branch, color, merged, agent, card, remote = false }: { branch: string; color: string | null; merged: boolean; agent: LaneAgent | null; card: LaneCardAnchor | null; remote?: boolean }) {
  const style = color === null ? undefined : ({ '--lane': color } as React.CSSProperties);
  const title = remote ? `${branch}, on the remote as of the last fetch${merged ? ', merged' : ''}` : merged ? `${branch}, merged` : agent === null ? branch : `${branch}: ${agent.label}, ${agent.working ? 'working' : 'returned'}`;
  const data = { 'data-branch': branch, 'data-merged': merged ? 'true' : undefined, 'data-agent': agent === null ? undefined : '', 'data-member': agent?.memberId, 'data-remote': remote ? '' : undefined };
  if (card === null) {
    return (
      <span className="commits-pill" {...data} style={style} title={title}>
        <span className="commits-pill-text">{branch}</span>
      </span>
    );
  }
  return (
    <PillAnchor card={card} data={data} style={style} title={title}>
      <span className="commits-pill-text">{branch}</span>
    </PillAnchor>
  );
}

function PillAnchor({ card, data, style, title, children }: { card: LaneCardAnchor; data: Record<string, string | undefined>; style: React.CSSProperties | undefined; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = usePopoverAnchor();
  return (
    <>
      <span ref={ref} className="commits-pill" {...data} style={style} title={title} role="button" data-popover-for={card.id} data-popover-open={state.open} {...state.handlers}>
        {children}
      </span>
      {state.card(ref.current, card.card)}
    </>
  );
}

// An agent row's reading during a replay (M9 fix 869).
interface AgentReplay {
  shown: boolean;
  working: boolean;
  prompt: string | null;
  spans: string;
}

function agentReplay(replay: { replay: Replay; frame: ReplayFrame }, row: number): AgentReplay {
  const { frame } = replay;
  const spans = (replay.replay.marks.get(row)?.spans ?? []).map((sp) => `${sp.from}-${sp.to}`).join(' ');
  return { shown: !frame.hidden.has(row), working: frame.working.has(row), prompt: frame.prompts.get(row) ?? null, spans };
}

// No flash during a replay.
const NO_FRESH: ReadonlySet<string> = new Set();

// An agent's row (M65): not a commit. The status word, the activity line
// shimmering while the agent works (the M40 sweep) and still once it
// has returned, the branch as a dashed pill when the worktree holds
// nothing yet (the only place that name exists), the elapsed at the
// right, and behind the text a wash of the session's colour from the
// gutter to the edge, which is what tells a live agent's row from a
// landed commit's. The marker and the leader are the picture's. A
// session's own row (M68) reads as its sidebar row does: the badge's
// word with its tone, the agent line, the time in its state. Which row
// is the session's and which an agent's (M9 fix 132): the session's
// row carries its name after the state word, in the lane colour, and a
// member's a `subagent` chip in the same place, so a block of a session
// and three agents reads `working · Batch 126 · Read the log` over
// `idle · subagent · Check no daemon is left`. The model word (M9 fix
// 287) leads the status when one is known, so a batch of forks on two
// families reads `Opus working · Batch 126` beside `Sonnet idle ·
// subagent · Check no daemon is left`.
// The row opens the same card its marker does (M9 fix 325), off the
// anchor agentCard(item) hands it: hover after the delay, a click pins,
// Escape or a press outside closes, Popover.tsx's usual manners. An
// item with no session behind it (agentCard returns null) opens
// nothing, the row's own click and hover left inert.
// replay (M9 fix 869): during a replay, whether the row is out yet,
// whether the record says it works at this moment and on what prompt,
// and its mark's spans in replay ms for the script; the row then reads
// working or idle off the record, and no age, since the record keeps no
// state times to age from.
function AgentRow({ item, session, color, model, now, card, replay }: { item: AgentItem; session: SessionInfo | null; color: string | null; model: string | null; now: number; card: LaneCardAnchor | null; replay?: AgentReplay | undefined }) {
  const { member } = item;
  const style = color === null ? undefined : ({ '--lane': color } as React.CSSProperties);
  const ref = useRef<HTMLDivElement>(null);
  const state = usePopoverAnchor(card !== null && replay === undefined);
  const handlers = card === null ? {} : state.handlers;
  const popoverData = { 'data-popover-for': card?.id, 'data-popover-open': state.open };
  if (member === null) {
    if (session === null) return null;
    const live = describeState(session);
    const working = replay === undefined ? workingMotion(session) !== null : replay.working;
    const label = replay === undefined ? live : replay.working ? { text: 'working', tone: 'working' as const } : { text: 'idle', tone: 'idle' as const };
    return (
      <>
        <div ref={ref} className="commits-row commits-agent-row" data-session={item.sessionId} data-working={working ? '' : undefined} data-start={item.startRow !== null ? '' : undefined} data-tone={label.tone} data-replay={replay === undefined ? undefined : replay.shown ? 'shown' : 'dim'} data-replay-spans={replay?.spans} style={style} {...popoverData} {...handlers}>
          <span className="commits-wash" />
          {model !== null && <span className="commits-agent-model">{model}</span>}
          <span className="commits-agent-status" data-tone={label.tone}>
            {label.text}
          </span>
          <span className="commits-agent-name" title={session.name}>
            {session.name}
          </span>
          <span className="commits-agent-activity" data-working={working ? '' : undefined} ref={observeBand}>
            {replay === undefined ? agentLineText(session) : (replay.prompt ?? '')}
          </span>
          {replay === undefined && (
            <span className="commits-age" title={`${label.text} for ${formatDuration(session.stateSince, now)}`}>
              {formatDuration(session.stateSince, now)}
            </span>
          )}
        </div>
        {card !== null && replay === undefined && state.card(ref.current, card.card)}
      </>
    );
  }
  const working = replay === undefined ? member.outcome === 'running' : replay.working;
  const elapsed = working ? formatDuration(member.startedAt, now) : formatDuration(member.startedAt, member.endedAt ?? now);
  return (
    <>
      <div ref={ref} className="commits-row commits-agent-row" data-member={member.id} data-session={item.sessionId} data-working={working ? '' : undefined} data-pending={item.pending ? '' : undefined} data-replay={replay === undefined ? undefined : replay.shown ? 'shown' : 'dim'} data-replay-spans={replay?.spans} style={style} {...popoverData} {...handlers}>
        <span className="commits-wash" />
        {model !== null && <span className="commits-agent-model">{model}</span>}
        <span className="commits-agent-status">{working ? 'working' : 'idle'}</span>
        <span className="commits-agent-role" data-role="subagent" data-type={member.type ?? undefined} title={`${agentLabel(member)}, a subagent of this session${member.type === null ? '' : ` of type ${member.type}`}`}>
          {agentRole(member)}
        </span>
        <span className="commits-agent-activity" data-working={working ? '' : undefined} ref={observeBand}>
          {replay === undefined ? (member.activity ?? agentLabel(member)) : agentLabel(member)}
        </span>
        {item.pending && member.branch !== null && (
          <span className="commits-pill" data-branch={member.branch} data-pending="" title={`${member.branch}: ${agentLabel(member)}'s worktree, nothing committed yet`}>
            <span className="commits-pill-text">{member.branch}</span>
          </span>
        )}
        {replay === undefined && (
          <span className="commits-age" title={working ? `out for ${elapsed}` : `returned after ${elapsed}`}>
            {elapsed}
          </span>
        )}
      </div>
      {card !== null && replay === undefined && state.card(ref.current, card.card)}
    </>
  );
}

// The colours the history blocks have been given (M9 fix 139), for the
// life of the renderer: a conversation has no record to keep one, and a
// pick made afresh on every build moved a lane's colour whenever a
// session block appeared or was recoloured. Every graph on show shares
// it, so one conversation is one colour across panels too.
const HISTORY_COLORS = new Map<string, string>();

// Room past the ends of the graph (M9 fix 129 on its side, M9 fix 169
// upright with the rows off): the view used to end at the newest tip,
// so the tip sat against the edge and there was nowhere to scroll. Now
// a spacer the scrolling box's length less 48px sits past the newest end
// (`.commits-room`) and another past the oldest (`.commits-room-old`, so
// a short graph has somewhere to go when centred, fix 170), measured
// here with a ResizeObserver into a CSS variable on the view, so the tip
// can reach 48px from the leading edge. The old room is sized to what a
// centre needs (M9 fix 211), half of what the box has over the drawing,
// so a long picture has no room before it and a short one exactly
// enough to sit in the middle; with the rows off the picture is the
// drawn range long, so a hidden block's rows are not scroll space
// either. On the first show, and again
// when the view is turned round, the scroll goes to that position; after
// that nothing here moves the scroll but the growth compensation below,
// so a commit that lands pushes the tip one row further into the room
// under a view that stays put and the person watches the work grow. The
// live marks stay in view on that first show (M9 fix 142): with two
// outside commits newer than a session, the tip at 48px put the
// session's marks past the leading edge and their labels read cut, so
// when the oldest mark lies within the view's length of the tip it is
// the mark that sits at 48px, the tip and the room past it further in.
//
// After the first show the scroll is anchored to a commit (M9 fix 210):
// after every render, and after every resize of the box, the drawn
// commit nearest the leading edge on screen is noted with where its
// node sits in the box's content coordinates, and on the next render or
// resize the scroll moves by however far that node moved, so the node
// stays where the person sees it. That covers the three things that
// moved the picture under a scroll that stayed: the log's window (200
// commits) filling, after which every commit that lands drops one off
// the old end and shifts every column a pitch that way, which the
// growth compensation of fix 129, counting rows, never saw; a change of
// the box's width moving the spacer before the SVG and the SVG's start
// with it; and the newest row landing at the low end, fix 129's own
// case. A node gone off the window falls back to the SVG's start. A
// hand scroll, or the centre button, re-reads the anchor on the scroll
// event, and a turn drops it before the tip is parked again.
//
// The axis says which way the graph scrolls: `x` on its side, where the
// view is the box that scrolls, `y` upright with the rows off, where the
// box is the panel's list around the view; null (upright with rows)
// draws no room and does nothing. The newest row is at the far end of
// the SVG on its side and at its near end upright, and the reverse of
// each when reversed; the leading edge is the one on the old side, so
// the room lies where the growth goes.
const EDGE = 48;

type RoomAxis = 'x' | 'y' | null;

// Where the newest end and the box are for an axis, read on every call
// since the box's size and the SVG's move.
function roomGeometry(el: HTMLDivElement, axis: 'x' | 'y', reverse: boolean) {
  const box = axis === 'x' ? el : (el.parentElement as HTMLElement);
  const svg = el.querySelector<SVGSVGElement>('.commits-graph');
  // The pitch at the zoom (fix 213), off the SVG; the unscaled one before
  // the first draw.
  const pitch = Number(svg?.dataset['pitch']) || (axis === 'x' ? COL_PX : ROW_PX);
  const along = (r: DOMRect) => (axis === 'x' ? r.left : r.top);
  const length = axis === 'x' ? box.clientWidth : box.clientHeight;
  const scroll = () => (axis === 'x' ? box.scrollLeft : box.scrollTop);
  const setScroll = (v: number) => {
    if (axis === 'x') box.scrollLeft = v;
    else box.scrollTop = v;
  };
  // The SVG's start in the box's content coordinates.
  const start = svg === null ? 0 : along(svg.getBoundingClientRect()) - along(box.getBoundingClientRect()) + scroll();
  // Whether the newest row sits at the far end of the SVG (right or
  // bottom), which is so on its side unless reversed and upright when
  // reversed; the old rows then lie at the low end, where the tip is
  // parked EDGE from, and the room past the newest end at the other.
  const newestFar = axis === 'x' ? !reverse : reverse;
  return { box, svg, pitch, along, length, scroll, setScroll, start, newestFar };
}

type RoomGeometry = ReturnType<typeof roomGeometry>;

// The two rooms as CSS variables on the view: past the newest end the
// box's length less EDGE (fix 129); past the oldest end (fix 211) half
// of what the box has over the SVG's length along the axis, so the
// centre of a short picture is reachable and a long one has none.
function setRooms(el: HTMLDivElement, box: HTMLElement, axis: 'x' | 'y'): void {
  const length = axis === 'x' ? box.clientWidth : box.clientHeight;
  el.style.setProperty('--commits-room', `${Math.max(0, length - EDGE)}px`);
  const svg = el.querySelector<SVGSVGElement>('.commits-graph');
  const drawn = svg === null ? 0 : Number(svg.getAttribute(axis === 'x' ? 'width' : 'height')) || 0;
  el.style.setProperty('--commits-room-old', `${Math.max(0, (length - drawn) / 2)}px`);
}

// The commit the scroll is anchored to (fix 210): its hash, its node's
// centre along the axis in the box's content coordinates, and the SVG's
// start at the time, the fallback when the node is gone. Behind it (M9
// fix 211) the nearest node of each other block, since hiding a block
// takes its nodes with it and the picture would jump when the leading
// node was one of them.
interface AnchorNode {
  hash: string;
  at: number;
}

interface Anchor extends AnchorNode {
  alts: AnchorNode[];
  start: number;
}

// The drawn commit nearest the leading edge and on screen, else the
// nearest to the edge at all, with the nearest of every other block
// behind it; null before anything is drawn.
function readAnchor(g: RoomGeometry, axis: 'x' | 'y'): Anchor | null {
  if (g.svg === null) return null;
  const edge = g.along(g.box.getBoundingClientRect());
  const best = new Map<string, AnchorNode & { d: number }>();
  for (const node of g.svg.querySelectorAll<SVGCircleElement>('.commits-node[data-hash]')) {
    const r = node.getBoundingClientRect();
    const mid = g.along(r) + (axis === 'x' ? r.width : r.height) / 2;
    const off = mid - edge;
    // On screen, the distance past the edge; off screen, that distance
    // pushed behind every on-screen one.
    const d = off >= 0 && off <= g.length ? off : g.length + Math.abs(off);
    const block = node.dataset['block'] ?? '';
    const had = best.get(block);
    if (had === undefined || d < had.d) best.set(block, { hash: node.dataset['hash'] ?? '', at: off + g.scroll(), d });
  }
  const ranked = [...best.values()].sort((a, b) => a.d - b.d).map(({ hash, at }) => ({ hash, at }));
  const lead = ranked[0];
  return lead === undefined ? null : { ...lead, alts: ranked.slice(1), start: g.start };
}

// Move the scroll by however far the anchored node has moved in the
// box's content, so it stays where it was on screen; by the first
// alternative still drawn when the node is gone, and by the SVG's start
// when every one is.
function restoreAnchor(g: RoomGeometry, axis: 'x' | 'y', anchor: Anchor | null): void {
  if (anchor === null || g.svg === null) return;
  let delta = g.start - anchor.start;
  for (const a of [anchor, ...anchor.alts]) {
    const node = g.svg.querySelector<SVGCircleElement>(`.commits-node[data-hash="${a.hash}"]`);
    if (node === null) continue;
    const r = node.getBoundingClientRect();
    const mid = g.along(r) + (axis === 'x' ? r.width : r.height) / 2;
    delta = mid - g.along(g.box.getBoundingClientRect()) + g.scroll() - a.at;
    break;
  }
  // Sub-pixel drift from the reads is not a move.
  if (Math.abs(delta) >= 0.5) g.setScroll(g.scroll() + delta);
}

function useRoom(ref: React.RefObject<HTMLDivElement | null>, axis: RoomAxis, reverse: boolean, n: number): void {
  const anchor = useRef<Anchor | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || axis === null) return;
    const box = axis === 'x' ? el : (el.parentElement as HTMLElement);
    const room = () => setRooms(el, box, axis);
    // The room is set before anything is measured: the spacer before the
    // SVG moves the SVG's start.
    room();
    // A turn or a reversal parks the tip below; the anchor from before it
    // is in the other axis's coordinates and is dropped first, so the
    // render's pass after this records rather than restores.
    anchor.current = null;
    const g = roomGeometry(el, axis, reverse);
    if (g.svg !== null && n > 0) {
      const tipIndex = g.newestFar ? n - 1 : 0;
      const tip = g.start + tipIndex * g.pitch + g.pitch / 2;
      // The marks' centres within the box's length of the tip, the oldest
      // of them leading; a mark farther off than that (another session's,
      // weeks older) is left where it is.
      const span = g.length - EDGE;
      const markAt = (m: SVGForeignObjectElement) => (axis === 'x' ? Number(m.getAttribute('x')) + Number(m.getAttribute('width')) / 2 : Number(m.getAttribute('y')) + Number(m.getAttribute('height')) / 2);
      const near = [...g.svg.querySelectorAll<SVGForeignObjectElement>('.commits-agent-node foreignObject')].map((m) => g.start + markAt(m)).filter((m) => Math.abs(m - tip) < span);
      const lead = near.length === 0 ? tip : g.newestFar ? Math.min(...near) : Math.max(...near);
      g.setScroll(g.newestFar ? lead - EDGE : lead - span);
    }
    // A resize of the box moves the spacer, and the SVG's start with
    // it; the anchor is put back under the new room and read again at
    // once, since a render may land before the scroll event does.
    const observer = new ResizeObserver(() => {
      room();
      const now = roomGeometry(el, axis, reverse);
      restoreAnchor(now, axis, anchor.current);
      anchor.current = readAnchor(now, axis);
    });
    observer.observe(g.box);
    return () => observer.disconnect();
    // n is read at the moment of the turn only; a change in the rows must
    // not move the scroll, so it is not a dependency.
  }, [ref, axis, reverse]);
  // After every render: put the anchored node back where it was, then
  // note the anchor for the next. Chromium's scroll anchoring does some
  // of this on its own for some content and not for an SVG's, so the
  // box is told not to and this is the one thing that moves the scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || axis === null) {
      anchor.current = null;
      return;
    }
    // The old room follows the drawing's length (fix 211), so a block
    // hidden or shown resizes it here, before the anchor is put back
    // under the SVG's new start.
    setRooms(el, axis === 'x' ? el : (el.parentElement as HTMLElement), axis);
    const g = roomGeometry(el, axis, reverse);
    g.box.style.overflowAnchor = 'none';
    restoreAnchor(g, axis, anchor.current);
    anchor.current = readAnchor(g, axis);
  });
  // A scroll by hand or by the centre button changes which node leads;
  // the anchor follows the scroll event.
  useEffect(() => {
    const el = ref.current;
    if (el === null || axis === null) return;
    const box = axis === 'x' ? el : el.parentElement;
    if (box === null) return;
    const onScroll = () => {
      anchor.current = readAnchor(roomGeometry(el, axis, reverse), axis);
    };
    box.addEventListener('scroll', onScroll);
    return () => {
      box.removeEventListener('scroll', onScroll);
      box.style.overflowAnchor = '';
    };
  }, [ref, axis, reverse]);
}

// Centre the graph (M9 fix 170): the drawn extent, the SVG's own bounding
// box along the time axis (what M72 leaves undrawn has no box), in the
// middle of the scrolling box; the rooms past both ends are what give a
// short graph somewhere to go. Called from the tools row's button and
// the right-click menu through a ref, since the refs live in the view.
//
// Across the axis too (M9 fix 175): the drawn extent sits at the leading
// edge of its box (the left of the gutter upright, the top of the view
// on its side), so a lone lane in a wide pane read as parked in a
// corner. When the drawing is narrower than the box an offset,
// `--commits-centre` on the view, is the margin before the SVG that
// puts it in the middle; when wider, the box scrolls to the middle of
// it instead. The drawn extent is whatever the SVG holds at the time,
// so under the `active` filter it is the one block that is centred and
// under `all` every block together. Skipped with the rows on, where the
// gutter is its drawing's width and a margin would push the rows aside.
function centreGraph(el: HTMLDivElement, axis: 'x' | 'y', reverse: boolean, across: boolean): void {
  const g = roomGeometry(el, axis, reverse);
  if (g.svg === null) return;
  const b = g.svg.getBBox();
  const middle = g.start + (axis === 'x' ? b.x + b.width / 2 : b.y + b.height / 2);
  g.setScroll(Math.max(0, middle - g.length / 2));
  if (across) centreAcross(el, axis);
}

// The box that scrolls across the axis: on its side the view scrolls
// both ways (fix 187); upright the gutter is the box that scrolls
// sideways. Null before the first render has drawn one.
function acrossBox(el: HTMLDivElement, axis: 'x' | 'y'): HTMLElement | null {
  return axis === 'x' ? el : el.querySelector<HTMLElement>('.commits-gutter');
}

const acrossScroll = (box: HTMLElement, axis: 'x' | 'y') => (axis === 'x' ? box.scrollTop : box.scrollLeft);
const acrossLength = (box: HTMLElement, axis: 'x' | 'y') => (axis === 'x' ? box.clientHeight : box.clientWidth);

// The across half of the centre on its own (fix 175), run again by
// useCentred while the centre is held (fix 188).
function centreAcross(el: HTMLDivElement, axis: 'x' | 'y'): void {
  const svg = el.querySelector<SVGSVGElement>('.commits-graph');
  const box = acrossBox(el, axis);
  if (svg === null || box === null) return;
  const b = svg.getBBox();
  const length = acrossLength(box, axis);
  const scroll = acrossScroll(box, axis);
  const had = parseFloat(el.style.getPropertyValue('--commits-centre')) || 0;
  const svgRect = svg.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  // The SVG's start across the box in its content coordinates with no
  // offset in place, so the reading is the same whatever the last click
  // set.
  const start = (axis === 'x' ? svgRect.top - boxRect.top : svgRect.left - boxRect.left) + scroll - had;
  const drawnMiddle = start + (axis === 'x' ? b.y + b.height / 2 : b.x + b.width / 2);
  const offset = length / 2 - drawnMiddle;
  el.style.setProperty('--commits-centre', `${Math.max(0, offset)}px`);
  if (axis === 'x') box.scrollTop = Math.max(0, -offset);
  else {
    box.scrollLeft = Math.max(0, -offset);
    // The gutter's fades read on its scroll and on a resize of the SVG;
    // a margin changes neither, so tell them to read again.
    box.dispatchEvent(new Event('scroll'));
  }
}

// The centre kept (M9 fix 188): fix 175's centre was a one-shot, so a
// pane made narrower after the bullseye left the drawing off centre
// until the next press. Now the centre is a state the view holds,
// `data-centred` on it, set by the bullseye and the menu's Centre
// through `hold` and dropped when the person scrolls the box across
// by hand or the view turns or the rows come back. While it holds, the
// box's ResizeObserver runs the across half again, so a resize, a fold
// of the controls and a sibling pane closing all keep the drawing in
// the middle; the scroll along the axis is the person's and is never
// touched. A hand scroll is one that moves the across scroll while the
// box is the size it was at the last centring; a scroll the resize
// itself clamps arrives before the observer's callback with the box
// already another size, so that one is left to the observer.
function useCentred(ref: React.RefObject<HTMLDivElement | null>, axis: 'x' | 'y', across: boolean): () => void {
  const held = useRef<{ scroll: number; length: number } | null>(null);
  const hold = useCallback(() => {
    const el = ref.current;
    const box = el === null ? null : acrossBox(el, axis);
    if (el === null || box === null) return;
    held.current = { scroll: acrossScroll(box, axis), length: acrossLength(box, axis) };
    el.dataset['centred'] = '';
  }, [ref, axis]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    held.current = null;
    delete el.dataset['centred'];
    const box = acrossBox(el, axis);
    if (box === null) return;
    const onResize = () => {
      if (held.current === null) return;
      if (across) centreAcross(el, axis);
      held.current = { scroll: acrossScroll(box, axis), length: acrossLength(box, axis) };
    };
    const onScroll = () => {
      const h = held.current;
      if (h === null || acrossLength(box, axis) !== h.length) return;
      if (Math.abs(acrossScroll(box, axis) - h.scroll) <= 1) return;
      held.current = null;
      delete el.dataset['centred'];
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(box);
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      box.removeEventListener('scroll', onScroll);
    };
  }, [ref, axis, across]);
  return hold;
}

// The upright gutter's floor (M71 task 3): the rows keep at least 120px
// (the CSS) and a gutter wider than the rest scrolls sideways in a box
// of its own under rows that stay put. `data-gutter` on the view says
// when it does, read on every resize of the box and every scroll of
// the gutter: `scrolls` while there is more past the right edge, `end`
// once the gutter is scrolled to its end, and `data-gutter-back` beside
// either while there is more past the left edge. The CSS draws a fade
// at each edge that hides something (M9 fix 141), since a 21px gutter
// showing lane 0 alone with its scrollbar under the last row gave no
// sign of the columns it hid. The sideways view takes the same pair
// (M9 fix 187), the flags on the box around it and the view the
// scroller, so `flag` is whichever element the CSS reads them off.
function useCutFades(flag: React.RefObject<HTMLDivElement | null>, scroller: React.RefObject<HTMLDivElement | null>, on: boolean): void {
  useLayoutEffect(() => {
    const v = flag.current;
    const g = scroller.current;
    if (v === null || g === null || !on) return;
    const read = () => {
      if (g.scrollWidth > g.clientWidth + 1) {
        v.dataset['gutter'] = g.scrollLeft + g.clientWidth < g.scrollWidth - 1 ? 'scrolls' : 'end';
        if (g.scrollLeft > 0) v.dataset['gutterBack'] = '';
        else delete v.dataset['gutterBack'];
      } else {
        delete v.dataset['gutter'];
        delete v.dataset['gutterBack'];
      }
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(g);
    // The SVG's width changes with the model while the box's may not;
    // watch the picture too.
    const svg = g.querySelector('.commits-graph');
    if (svg !== null) observer.observe(svg);
    g.addEventListener('scroll', read, { passive: true });
    return () => {
      observer.disconnect();
      g.removeEventListener('scroll', read);
    };
  }, [flag, scroller, on]);
}

// The hashes the latest fetch added, kept for a moment so the graph can
// flash them; nothing on the first fetch, which is not news.
function useFresh(graph: GitGraph): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const hashes = new Set(graph.commits.map((c) => c.hash));
    const before = known.current;
    known.current = hashes;
    if (before === null || before.size === 0) return;
    const added = new Set([...hashes].filter((h) => !before.has(h)));
    if (added.size === 0) return;
    setFresh(added);
    const timer = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(timer);
  }, [graph]);
  return fresh;
}

// The daemon reads a detached HEAD as its short id (git-branch.ts), which
// the row shows as it is; here the word says what that is.
function branchText(branch: string): string {
  return /^[0-9a-f]{7}$/.test(branch) ? `detached at ${branch}` : branch;
}

// A commit's row. The hash, coloured by the block, is the block's handle
// (M72): a click on it hides the block's lines or shows them again, and
// a right click on the row offers the same and Show only this above the
// direction items; a row whose block draws no lanes says so in
// `data-lines` and draws its hash dim. The row itself never goes. The
// depth (M9 fix 214) is how many branches off the trunk the commit is,
// read by the CSS as the subject's lean and a hairline in the row's
// colour at the lean's edge; 0 is the trunk, flush.
// What the rows and the cards price with (M9 fix 252): the log, for a
// merge's walk to the commits it brought in, the record behind any hash
// on the graph, and the transcripts' requests by conversation.
interface Pricing {
  commits: readonly GraphCommit[];
  recordOfHash: (hash: string) => SessionInfo | null;
  lists: ReadonlyMap<string, UsageMessage[] | null>;
}

// A write's row (M9 fix 255) is the same row over the file's path, a
// pen where the hash goes, and its card says the file, the time and who
// wrote it. A cherry-picked twin (M9 fix 304) wears a pill after the
// hash, `×3` on the original and `picked` on a copy, carries the other
// copies' hashes in data-twins, and is lit (data-lit) while another
// copy's row is hovered or its card open, off the same raised hash the
// graph's leaders read.
// replay (M9 fix 869): during a replay, whether the row is dimmed until
// its commit lands and the replay ms it lands at, for the script, and no
// card opens while a replay runs (M9 fix 906): the replay is a thing to
// watch, and a card left open by a resting pointer covered the rows
// landing under it.
function CommitRow({ item, write, ownerName, color, branch, defaultBranch, now, recent, lines, record, pricing, twins, lit, onMenu, onRaise, replay, children }: { item: CommitItem; write: GraphWrite | null; ownerName: string | null; color: string | null; branch: CommitBranch | null; defaultBranch: string | null; now: number; recent: boolean; lines: CardLines | null; record: SessionInfo | null; pricing: Pricing; twins: TwinInfo | null; lit: boolean; onMenu: ((x: number, y: number) => void) | undefined; onRaise: (hash: string, on: boolean) => void; replay?: { dim: boolean; lands: number | null } | undefined; children?: React.ReactNode }) {
  const { commit } = item;
  const depth = branch?.depth ?? 0;
  // The lean's tooltip (M9 fix 253) names the branch and how far off the
  // trunk it is; the trunk's rows keep none.
  const lean = branch === null ? null : leanTitle(branch, defaultBranch);
  const history = historyIdOf(item.sessionId) !== null;
  // The slice the record credits this hash with (M9 fix 252), null on a
  // commit made outside emerald or on a history lane, which has no record
  // and so no price; a merge also carries the lines it brought in.
  // Memoized on the record (M9 fix 353), whose identity moves only when
  // the daemon pushes the session: the walk over the record's commits
  // and spans used to run on every render of every row, 200 rows on
  // every poll, hover and 30 s tick.
  const slice = useMemo(() => (record === null ? null : commitSlice(record, commit.hash)), [record, commit.hash]);
  const price: CommitPrice | null = useMemo(() => {
    if (record === null || slice === null) return null;
    const agent = slice.commit.agent ?? null;
    const member = agent === null ? null : ((record.team ?? []).find((m) => m.id === agent.id) ?? null);
    return { session: record, slice, branch: commit.parents.length > 1 ? branchGroups(commit, pricing.commits, pricing.recordOfHash) : [], agentBranch: member?.branch ?? agent?.branch ?? null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, commit, pricing.commits, slice?.from, slice?.to, slice?.conversation]);
  // Who made it, as the card says it (M73 task 4; the row's tooltip until
  // then); a subagent's commit names the session and then the agent (fix
  // 252, `emerald · explore`), the way M61 draws its lane.
  const agentOf = slice?.commit.agent ?? null;
  const agentName = agentOf === null ? null : ((record?.team ?? []).find((m) => m.id === agentOf.id)?.description ?? agentOf.description ?? agentOf.type ?? 'agent');
  const person = personNameOf(item.sessionId);
  const remoteBranch = remoteBranchOf(item.sessionId);
  const by = ownerName === null ? outsideKind(commit) : history ? `${ownerName}, a conversation emerald did not host` : person !== null ? `${person}, by the commit's author` : remoteBranch !== null ? `only on ${remoteBranch}, as of the last fetch` : agentName === null ? ownerName : `${ownerName} · ${agentName}`;
  // The row's dollars (the board's 3d): the slice's estimate, in the pane
  // alone, the first cell the width drops; none when not known. On the
  // slice and the store's map (fix 353), whose identity holds while no
  // conversation's list changed, so a render for any other reason costs
  // the row no walk over the conversation's requests.
  const cost = useMemo(() => (slice === null ? null : rowCost(slice, pricing.lists)), [slice, pricing.lists]);
  const hidden = item.lane === null;
  const card = usePopoverAnchor(replay === undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  // Hovered, for the node's leader (M9 fix 254): the graph raises it
  // while the pointer is on the row or the card is open, and the row
  // says so in data-hover for the scripts.
  const [hover, setHover] = useState(false);
  const raised = hover || card.open !== undefined;
  useEffect(() => {
    onRaise(commit.hash, raised);
    return () => onRaise(commit.hash, false);
  }, [commit.hash, raised, onRaise]);
  const onHash = (ev: React.MouseEvent) => {
    if (lines === null) return;
    ev.stopPropagation();
    lines.toggle();
  };
  return (
    <div
      className="commits-row"
      data-hash={commit.hash}
      data-write={write === null ? undefined : ''}
      data-path={write?.path}
      data-recent={recent || undefined}
      data-owner={item.sessionId ?? 'none'}
      data-history={history ? '' : undefined}
      data-person={person ?? undefined}
      data-remote={remoteBranch ?? undefined}
      data-member={item.memberId ?? undefined}
      data-lines={hidden ? 'hidden' : undefined}
      data-depth={depth}
      data-twins={twins === null ? undefined : twins.others.join(' ')}
      data-lit={lit ? '' : undefined}
      data-replay={replay === undefined ? undefined : replay.dim ? 'dim' : 'shown'}
      data-replay-lands={replay === undefined || replay.lands === null ? undefined : String(replay.lands)}
      style={{ ...(color === null ? {} : { '--lane': color }), '--depth': depth } as React.CSSProperties}
      // The row opens the commit card on a hover (M73 task 4); a click pins it, the hash's own click still folding the block's lines.
      ref={rowRef}
      data-popover-for={`commit:${commit.hash}`}
      data-popover-open={card.open}
      data-hover={hover ? '' : undefined}
      onClick={() => card.pin()}
      onMouseEnter={() => {
        setHover(true);
        card.handlers.onMouseEnter();
      }}
      onMouseLeave={() => {
        setHover(false);
        card.handlers.onMouseLeave();
      }}
      // A chromeless pane (M9 fix 179) has no row menu: the right-click
      // is the pane's, so the event goes on up.
      onContextMenu={(ev) => {
        if (onMenu === undefined) return;
        ev.preventDefault();
        ev.stopPropagation();
        onMenu(ev.clientX, ev.clientY);
      }}
    >
      {children}
      <span className="commits-hash" role={lines === null ? undefined : 'button'} title={lines === null ? undefined : hidden ? 'Show its lines' : 'Hide its lines'} onClick={onHash}>
        {write === null ? commit.hash.slice(0, 7) : '✎'}
      </span>
      {twins !== null && (
        <span className="commits-twin" data-twin={twins.original ? 'original' : 'pick'} title={twinPillTitle(twins)}>
          {twinPillText(twins)}
        </span>
      )}
      <span className="commits-subject" title={write === null ? (lean ?? undefined) : write.path}>
        {commit.subject}
      </span>
      {cost !== null && slice !== null && (slice.group.index === 0 ? (
        <span className="commits-cost" title={costTitle(cost)}>
          {`~${formatUsd(cost.usd)}`}
        </span>
      ) : (
        // A commit credited with others at one instant (M9 fix 276)
        // shares the first one's figure; its cell is a dot that says so.
        <span className="commits-cost" data-group="" title={`${groupText(slice.group.size, slice.to)}, priced on ${slice.group.first.slice(0, 7)}`}>
          ·
        </span>
      ))}
      {replay?.dim !== true && <span className="commits-age">{formatDuration(commit.at, now)}</span>}
      {replay === undefined && card.card(rowRef.current, (props) => (write === null ? <CommitCard commit={commit} by={by} hidden={hidden} price={price} agent={agentName !== null} color={color} branch={branch} twins={twins} {...props} /> : <WriteCard write={write} now={now} hidden={hidden} {...props} />))}
    </div>
  );
}

// The dollars cell's tooltip: the estimate's source and, when agents
// ran in the slice, the two parts the card's notes name (M9 fix 275).
function costTitle(cost: RowCost): string {
  const parts = ['what the stretch of work up to this commit cost, an estimate from our rate table'];
  if (cost.agents !== null) parts.push(`of which ${cost.agents.count} ${cost.agents.count === 1 ? 'agent' : 'agents'}${cost.agents.usd === null ? '' : ` ~${formatUsd(cost.agents.usd)}`}`);
  if (cost.elsewhere !== null) parts.push(elsewhereText(cost.elsewhere));
  return parts.join('; ');
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

// The session on the focused pane of the current tab (M9 fix 186), or
// null for a view pane, an empty one, or no layout yet.
function focusedSessionIn(layout: Layout | null): string | null {
  if (layout === null) return null;
  try {
    const tab = currentTab(layout);
    return findPane(tab, tab.focusedPaneId)?.sessionId ?? null;
  } catch {
    return null;
  }
}
