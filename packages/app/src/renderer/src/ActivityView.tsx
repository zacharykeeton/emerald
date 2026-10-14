import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ACTIVITY_UNITS, activityLoad, activityRowKey, activityStats, cappedStats, cappedStatsTitle, cappedWallMs, clockTime, commitsStats, commitsStatsTitle, compareKeys, dayKey, debtLoad, debtStats, debtStatsTitle, drawnSessions, fiveHourKey, folderTitle, formatSpanLength, historyFromText, GRAPH_SCALE_STEPS, isGraphScale, liveSpans, loadAt, mergeStats, packTracks, pickHead, pickRows, runningText, sessionDebt, sessionsOnPanes, sessionsOnTab, statsFigures, stepWindow, tabHolding, tokensStats, tokensStatsTitle, unitBounds, unitKey, unitLabel, unitWord, weekProfiles, weekStats, weekStatsHead, weekStatsText, windowName } from '@emerald/shared';
import type { ActivitySession, ActivityUnit, DebtKind, SessionInfo } from '@emerald/shared';
import { BAR_FLOOR, BUCKET_MS, barHeight, barsTitle, emptyRing, feedRing, newestTokens, readOutputs } from './activity-bars.ts';
import type { OutputReading, TokenRing } from './activity-bars.ts';
import { owedIds, useActivity, workingIds } from './activity-data.ts';
import { nextScope, scopeWords, scopedSessions } from './activity-scope.ts';
import type { ActivityScope } from './activity-scope.ts';
import { TRACK_HEIGHT } from './ActivitySection.tsx';
import { LayersButton } from './ActivityLayers.tsx';
import { showsBand, showsLanes } from './activity-layers.ts';
import type { ActivityLayers } from './activity-layers.ts';
import { stripAxis } from './activity-strip.ts';
import { ActivityDebt } from './ActivityDebt.tsx';
import { ActivityLoad } from './ActivityLoad.tsx';
import { ActivityRidges } from './ActivityRidges.tsx';
import { ActivityStrip, OUTSIDE_WORD, outsideNote } from './ActivityStrip.tsx';
import type { StripOrientation } from './ActivityStrip.tsx';
import { activityPath, activityWindow, tabQuery } from './tabs-model.ts';
import { useStore } from './store.ts';
import { closeFileTab, openFileTab, setDocumentQuery, useUi } from './ui.ts';
import { TokensArrow } from './TokensText.tsx';
import { UsageBar } from './UsageCard.tsx';
import { CARD_BAR_PX, paceBar, usageWindowName } from './usage-model.ts';
import { fiveHourBounds, useFiveHourUsage } from './usage-reading.ts';
import { activityFromQuery, activityQuery } from './view-state.ts';
import type { ActivitySnapshot } from './view-state.ts';

// The activity card's Expand (M54): the same day as a tab, the strip at
// full width with a named row per session and the prompts under hover,
// ◀ ▶ stepping the day (a new tab path, the old one closed, so the strip
// has one tab per day and the day is in the tab's name), and ⇅ turning
// time downwards with the sessions across. A document tab, not a file:
// nothing is read from disk, the daemon is asked as the card asks.
//
// M67: the window can be an hour or a minute as well (the picker in the
// header), ◀ ▶ page by the unit, and a view opened on the current unit
// follows the clock across the rollover, so a minute view left open
// keeps showing the live minute; paging back pins it, and the now
// button (or Home while the view has focus) returns it to the clock.
//
// M69: the same view sits in a layout pane (ViewPane). The view takes
// the window and says where it wants to go through onShow; the tab
// opens a new path and closes the old, the pane rewrites its own view,
// and the header's close is the tab's alone, since a pane title has one.
//
// M9 fix 120: a density button packs the sessions onto the rail card's
// tight tracks (packTracks, no names column, the hover naming a span's
// session as it does on the card) and back to a named row each; the
// choice is kept under its own key so every window, tab or pane, draws
// the same way.
//
// M9 fix 128: in a pane the header can be folded away once the window,
// the unit, the density and the orientation are set, leaving the stats
// line and the strip; the pane's title bar menu brings it back. The tab
// never folds, its header being its only title and its controls its
// point.
//
// M9 fix 178: the view opens as a snapshot of the rail's section, its
// scope (every session, or the folder the rail was on), the folder and
// its layers, and keeps them as its own from then on: a tab in the query
// on its path, a pane on its view record, each handed in as `state` and
// written back through onState. The scope pill on the header toggles
// between the folder and all when the view has a folder; a view opened
// without one shows every session and no pill. The orientation and the
// density stay the view's own under their keys, having no counterpart
// on the section.
//
// M9 fix 218: what landed over the window after the peak, `14 commits,
// 3 merges`, the commits the sessions' records credit, the tooltip
// naming the rows with the most.
//
// M9 fix 217: the window's tokens and cost after the peak, `↑3.2M ↓84k ·
// $12.40`, summed over the request points the daemon folds from every
// session's status lines, the arrows in the row's face; a status line
// is a session change the view already refetches after, so the totals
// move at each request's end.
//
// M9 fix 216: the token bars on the stats line, before the count running
// now: twenty-four buckets of output tokens summed over the drawn
// sessions that were working, fed from the store's pushes (each status
// line moves a session's `tokens.output`), the ring the view's own and
// reset when its scope changes. On the tab and the pane alone; the rail
// card keeps its words, since 71px is a third of its width. M9 fix 229
// made the bucket a second and slides the ring on a clock of its own at
// that pace, the newest bar growing as each delta lands.
//
// M74: the load band above the lanes, on the same axis: how many sessions
// were working at each instant, with the peak and the busy median in the
// names gutter beside it, and a crosshair that follows the pointer over
// band and lanes together, reading the time and the count in the tick
// row. The crosshair is hover state alone, a percent of the axis so a
// resize does not strand it; nothing is stored. Horizontal only, in both
// densities; the vertical form has no design for it and draws none.
//
// M9 fix 230: the week unit. One activity.spans request over the whole
// week, the renderer splitting the answer into seven day profiles on one
// shared peak (weekProfiles) and drawing them as ridges (ActivityRidges)
// in place of the band and the lanes: no lanes, always time across, so
// the layers, orientation and density buttons wait for another unit.
// The stats line carries the week's peak with its day and clock time,
// the busiest hour of the day across the week and the agent-hours; the
// ridges' own crosshair reads an hour across the days.
//
// M9 fix 231: attention debt, the time the sessions spent waiting on
// the person, everywhere in the waiting tone. The stats line gains one
// part after the peak, absent at zero, which leads the second line
// where the line wraps (a container query on the view's width); under
// the band a mirrored teal strip on its own peak while the window has
// any, with a third legend line; the lanes carry each session's asked
// and unread stretches by weight (ActivityStrip); the name gutter the
// session's window debt, right aligned; the crosshair a third clause
// and, where there is room, a second line naming the sessions waiting
// at that instant longest first; and the header a live figure with the
// app's needs-input pulse while any drawn session is asking, the
// longest current wait, which at rail width sits on the stats line's
// second line instead. The vertical form and the week draw no mirror.
//
// M9 fix 280: picking days to compare on the week's ridges. The pick is
// this view's own state, a set of day keys, empty meaning no pick (show
// all seven): a click on a row's label toggles that day, a double-click
// solos it, and a click on the stats line's head or Escape clears the
// pick. It clears itself on a unit or a window change too, since the
// pick is keyed to this week; nothing persisted, nothing on the wire.
// While a pick is on, `pickRows` filters the week's rows to it and
// recomputes the peak over them alone, so a quiet pair is not flattened
// by a busier day left out; ActivityRidges draws the picked rows as
// ridges and the rest as a dimmed list under them.
//
// M9 fix 281: a condensed form for the week, on the density button
// (disabled on the week until now): a short gutter with the day names
// alone, half the full form's scale, no floor lines and no textual
// readout (the crosshair's per-dot figures stand in), the stats line
// cut to its head with the rest in a tooltip. Kept under its own key,
// since the day's density and the week's are unrelated choices.

const ROW_HEIGHT = 18;
// The load band's height in the tab and the pane (M74).
const LOAD_HEIGHT = 64;
// Packed (M9 fix 165), the band follows the strip it profiles, a track's
// height per track between the rail card's 16 and the mock's condensed
// strip's 22, so it never stands taller than the tracks from four up.
const PACKED_LOAD_MIN = 16;
const PACKED_LOAD_MAX = 22;
// The mirror under the band (M9 fix 231): 22px under the tab's and the
// pane's 64px band, 14px under the packed one and the card's.
const DEBT_HEIGHT = 22;
export const DEBT_HEIGHT_PACKED = 14;
// Pixels per tick step on the vertical axis (an hour of a day, five
// minutes of an hour, ten seconds of a minute).
const TICK_LENGTH = 40;
const ORIENTATION_KEY = 'emerald.activityView';
const DENSITY_KEY = 'emerald.activityDensity';
// The week's own density choice (M9 fix 281): the day's key packs
// tracks, which the week has none of, so a choice of its own.
const WEEK_DENSITY_KEY = 'emerald.activityWeekDensity';
// M9 fix 213: the activity strip's zoom, a width factor on its box, kept
// like the orientation and the density.
const STRIP_SCALE_KEY = 'emerald.activityScale';

const DEFAULT_STATE: ActivitySnapshot = { scope: 'all', folder: null, layers: 'both' };

interface Props {
  // The window's key, as activityPath takes it.
  window: string;
  onShow: (key: string) => void;
  // Absent in a pane, which has a close of its own on its title.
  onClose?: (() => void) | undefined;
  // The tab's path, for the scripts that find the view by it.
  path?: string | undefined;
  // The scope, folder and layers (M9 fix 178), the defaults when absent;
  // a caller that takes the change keeps them, else the view keeps its
  // own for its life (a pane on an older daemon).
  state?: ActivitySnapshot | undefined;
  onState?: ((state: ActivitySnapshot) => void) | undefined;
  // The pane's chrome flag (M9 fix 179), folding the header away with
  // the pane's title bar; the ▴ button asks the pane to fold through
  // onFold, absent on a daemon too old for the flag.
  folded?: boolean | undefined;
  onFold?: (() => void) | undefined;
  // Whether the caller can keep the panes scope (M9 fix 250): a pane on
  // a daemon below level 48 cannot, so its pill skips the step; a tab
  // always can.
  panesScope?: boolean | undefined;
  // The pane holding the view (M9 fix 261), for the here scope, the
  // sessions on the panes of the tab holding it; absent on the tab form,
  // which skips the step. hereScope is whether the daemon keeps the
  // value (level 49).
  paneId?: string | undefined;
  hereScope?: boolean | undefined;
}

// The scope pill's tooltip (M9 fix 250): what the pill holds and what
// the next click brings, the folder step named by its folder and skipped
// without one, the here step (M9 fix 261) by the pane's tab.
function scopeTitle(scope: ActivityScope, folder: string | null, unit: string, panes: boolean, here: boolean, tabName: string | null): string {
  const next = nextScope(scope, folder, panes, here);
  const words = (s: ActivityScope) => (s === 'all' ? `every session of the ${unit}` : s === 'panes' ? 'the sessions on the panes' : s === 'here' ? `the sessions ${scopeWords(s, folder, folderTitle, tabName)}` : `${folderTitle(folder ?? '')} only`);
  const held = scope === 'all' ? `Every session of the ${unit}` : scope === 'panes' ? 'The sessions on the panes only' : scope === 'here' ? `The sessions ${scopeWords(scope, folder, folderTitle, tabName)} only` : `${scopeWords(scope, folder, folderTitle) ?? ''} only`;
  return `${held}; click for ${words(next)}`;
}

// The pill's word for the scope; `here` reads as the tab it means.
function scopePill(scope: ActivityScope): string {
  return scope === 'here' ? 'this tab' : scope;
}

// The document tab (M54): the window off the path, a step opening the
// next window's tab and closing this one, carrying the state along.
export function ActivityTab({ path }: { path: string }) {
  const { tabs } = useUi();
  const query = tabQuery(tabs, path);
  const state = activityFromQuery(query);
  // A window the path cannot name (a hand-typed key) reads as today.
  const key = activityWindow(path) ?? dayKey(Date.now());
  const onShow = (next: string) => {
    openFileTab(activityPath(next, activityQuery(state)));
    closeFileTab(path);
  };
  return <ActivityView window={key} path={path} onShow={onShow} onClose={() => closeFileTab(path)} state={state} onState={(next) => setDocumentQuery(path, activityQuery(next))} />;
}

export function ActivityView({ window: key, path, onShow, onClose, state: stateProp, onState, folded: foldedProp = false, onFold, panesScope = true, paneId, hereScope = false }: Props) {
  const { sessions, layout } = useStore('sessions', 'layout');
  const window = useMemo(() => unitBounds(key) ?? unitBounds(dayKey(Date.now()))!, [key]);
  const bounds = window;
  const day = dayKey(window.from);
  const activity = useActivity(bounds);
  const now = useNow(window.unit);
  const historyFrom = activity?.historyFrom ?? null;
  const [orientation, setOrientation] = useState<StripOrientation>(loadOrientation);
  const [condensed, setCondensed] = useState<boolean>(loadCondensed);
  const [weekCondensed, setWeekCondensed] = useState<boolean>(loadWeekCondensed);
  const [stripScale, setStripScale] = useState<number>(loadStripScale);
  // The week's pick (M9 fix 280): the day keys drawn as ridges, empty
  // meaning no pick (every day shown); cleared on a unit or a window
  // change, since a Tuesday from last week means nothing this week.
  const [weekPick, setWeekPick] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setWeekPick(new Set()), [key]);
  const [ownState, setOwnState] = useState<ActivitySnapshot>(stateProp ?? DEFAULT_STATE);
  const state = onState === undefined ? ownState : (stateProp ?? DEFAULT_STATE);
  const chooseState = (next: ActivitySnapshot) => {
    if (onState === undefined) setOwnState(next);
    else onState(next);
  };
  const { layers, folder } = state;
  // The folder scope needs a folder; the panes scope (M9 fix 250) does
  // not; the here scope (M9 fix 261) needs a pane, so a tab whose query
  // carries it reads as panes.
  const scope = folder === null && state.scope === 'folder' ? 'all' : paneId === undefined && state.scope === 'here' ? 'panes' : state.scope;
  const inPane = onClose === undefined;
  const folded = foldedProp && inPane;
  // The folder scope reads each session's folder off the store, as the
  // rail's section does; the panes scope reads the sessions on a pane of
  // any tab off the layout (sessionsOnPanes, M9 fix 249), agents
  // following their parent since a row carries the parent's id.
  const paneIds = useMemo(() => (layout === null ? new Set<string>() : sessionsOnPanes(layout)), [layout]);
  // The here scope (M9 fix 261) reads the panes of the tab holding this
  // pane, and names it; a pane no tab holds (mid-edit) reads as none.
  const ownTab = useMemo(() => (layout === null || paneId === undefined ? null : tabHolding(layout, paneId)), [layout, paneId]);
  const hereIds = useMemo(() => (ownTab === null ? new Set<string>() : sessionsOnTab(ownTab)), [ownTab]);
  const tabName = ownTab?.name ?? null;
  const source = useMemo(() => ({ folders: new Map([...sessions].map(([id, s]) => [id, { groupCwd: s.groupCwd, cwd: s.cwd }])), paneIds, hereIds }), [sessions, paneIds, hereIds]);
  const scoped = useMemo(() => scopedSessions(activity?.sessions ?? [], scope, folder, source), [activity, scope, folder, source]);
  // The five-hour unit (M9 fix 321) is the account's current usage
  // window off the strip's reading (usage-reading.ts): the current
  // window is the only one, its key the reading's, so the arrows are
  // off and now moves to it; with no reading the button is off. A key
  // from before the reading's window (an old tab path after a relaunch)
  // opens on the window it names, and now is live to the current one.
  const fiveHourUsage = useFiveHourUsage();
  const fiveHour = fiveHourBounds(fiveHourUsage === null ? null : [fiveHourUsage]);
  const fiveHourNow = fiveHour === null ? null : fiveHourKey(fiveHour.from);
  const currentKey = window.unit === 'five-hour' ? fiveHourNow : unitKey(window.unit, now);
  const onNow = currentKey === null || compareKeys(key, currentKey) >= 0;
  const week = window.unit === 'week';
  const fiveHourUnit = window.unit === 'five-hour';
  // The pace bar under the axis, the strip's own reading drawn the
  // axis's full width, on the current window alone. The width only
  // coarsens the ticks (usage-model.ts), and at any width the axis takes
  // the hour ticks stay, so the card's constant serves.
  const axisBar = fiveHourUnit && fiveHourUsage !== null && key === fiveHourNow ? paceBar(fiveHourUsage, now, CARD_BAR_PX) : null;
  // The count running now (M9 fix 207) is read while the window is on
  // the clock; a past unit has no instant to read it at.
  const working = useMemo(() => workingIds(sessions), [sessions]);
  // The sessions owed now (M9 fix 231), so a live waiting stretch grows
  // to the clock as a working span does.
  const owed = useMemo(() => owedIds(sessions), [sessions]);
  // The rows with a working one's last span drawn to the clock (M9 fix
  // 228), so the band, the stats line and the lanes end at one place
  // between two answers from the daemon.
  const list = useMemo(() => liveSpans(scoped, working, now, owed), [scoped, working, now, owed]);
  // The window's own stats, always over the whole window; the debt part
  // and the capped part read this one below (M9 fix 297), since they are
  // the account's, not the days'.
  const windowStats = activityStats(list, bounds.from, Math.min(bounds.to, now), onNow ? working : undefined);
  // The week's seven profiles (M9 fix 230), on the day's window null,
  // read before the stats line since a pick prices only the picked days
  // (M9 fix 297). The picked rows (M9 fix 280): a pick reachable only
  // while there are still seven rows to pick from, and never below one
  // (the view never lets the last row go, but a pick left over from a
  // window with fewer rows is the same guard).
  const ridges = week ? weekProfiles(list, bounds.from, now) : null;
  const pickedRidges = ridges === null || weekPick.size === 0 ? ridges : pickRows(ridges, weekPick);
  // The stats line (M9 fix 297): with days picked, the tally, the tokens
  // and the price after them are the picked days' alone, one activityStats
  // call per picked row merged, not the whole week's; the day's window
  // and an unpicked week read as today (windowStats, unchanged).
  const stats = week && weekPick.size > 0 && pickedRidges !== null ? mergeStats(pickedRidges.rows.map((r) => activityStats(list, r.from, Math.min(r.to, now), onNow ? working : undefined))) : windowStats;
  const load = activityLoad(list, bounds.from, Math.min(bounds.to, now));
  // The mirror's two profiles (M9 fix 231); the part on the line and
  // the longest current wait, read off the store while the window is on
  // the clock.
  const debt = debtLoad(list, bounds.from, Math.min(bounds.to, now));
  const debtPart = debtStats(windowStats);
  const asking = onNow ? longestAsk(list, sessions, owed, now) : null;
  // The capped bands (M9 fix 285), the account's, so no scope filters
  // them; the part on the line is their union inside the window.
  const capped = activity?.capped ?? [];
  const cappedPart = cappedStats(capped, bounds.from, Math.min(bounds.to, now));
  const offRidgeRows = ridges === null || weekPick.size === 0 ? [] : ridges.rows.filter((r) => !weekPick.has(r.key));
  const weekFigures = pickedRidges === null ? null : weekStats(pickedRidges);
  // The stats line's head (M9 fix 280): `2 of 7 days` while a pick is on,
  // clickable to clear it; and (M9 fix 281) the condensed form's own
  // text, weekStatsText's output with the busiest-hour clause cut, the
  // full line kept as its tooltip.
  const weekPickHead = ridges === null ? '' : pickHead(ridges.rows.length, pickedRidges!.rows.length);
  const weekFullText = weekFigures === null ? null : weekStatsText(weekFigures);
  const weekText = weekFullText === null ? null : weekCondensed ? weekStatsHead(weekFullText) : weekFullText;
  // A click on a label toggles it: the first click starts the pick with
  // that day alone, a click on a day already picked drops it (unless it
  // is the last one, which would leave nothing to compare), a click on
  // an unpicked day while picking adds it.
  const toggleWeekDay = (dayKey: string) => {
    setWeekPick((prev) => {
      if (prev.size === 0) return new Set([dayKey]);
      if (prev.has(dayKey)) {
        if (prev.size === 1) return prev;
        const next = new Set(prev);
        next.delete(dayKey);
        return next;
      }
      const next = new Set(prev);
      next.add(dayKey);
      return next;
    });
  };
  const soloWeekDay = (dayKey: string) => setWeekPick(new Set([dayKey]));
  const resetWeekPick = () => setWeekPick(new Set());
  const tokens = tokensStats(stats);
  const tally = commitsStats(stats);
  // The token ring (M9 fix 216): a push feeds it the working rows' output
  // counts; a change of what the view shows starts it over. A clock of
  // its own at the bucket's pace (M9 fix 229) slides it between pushes
  // with the last reading again, which moves no count; a quiet ring
  // (every bucket empty, nothing new read) is handed back as it is, so
  // an idle tab does not redraw every second.
  const [ring, setRing] = useState<TokenRing>(() => emptyRing(Date.now()));
  const readings = useRef<OutputReading[]>([]);
  useEffect(() => {
    setRing(emptyRing(Date.now()));
  }, [key, scope, folder]);
  useEffect(() => {
    readings.current = readOutputs(list, sessions);
    const read = readings.current;
    setRing((r) => feedRing(r, Date.now(), read));
  }, [sessions, list]);
  useEffect(() => {
    // Armed to each bucket's boundary rather than a plain interval, so a
    // new bar starts as the second turns and not some way into it.
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        setRing((r) => {
          const next = feedRing(r, Date.now(), readings.current);
          return quietRing(r) && quietRing(next) && r.seen.size === next.seen.size && r.read.size === next.read.size && [...next.read].every((k) => r.read.has(k)) ? r : next;
        });
        arm();
      }, BUCKET_MS - (Date.now() % BUCKET_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, []);
  const axis = stripAxis(list, bounds, now, window.unit);
  // The week is always time across; the choice waits for another unit.
  const vertical = orientation === 'vertical' && !week;
  // The vertical length: forty pixels per tick step, so an hour and a
  // minute draw as long as a twelve-hour day.
  const ticks = Math.max(1, axis.ticks.length - 1);
  // Whether the view follows the clock: true from an open on the current
  // unit, false once ◀ has paged back, true again on now or a ▶ that
  // reaches the current unit. A ref, not state: the rollover effect
  // reads it and nothing draws it but a data attribute.
  const following = useRef(onNow);
  const show = (next: string, follow: boolean) => {
    following.current = follow;
    if (next === key) return;
    onShow(next);
  };
  const step = (delta: number) => {
    if (currentKey === null || fiveHourUnit) return;
    const next = stepWindow(window, delta);
    show(next, compareKeys(next, currentKey) >= 0);
  };
  const toNow = () => {
    if (currentKey !== null) show(currentKey, true);
  };
  // A new unit keeps the clock when the window has it, else the unit
  // holding the window's start, still pinned; the five-hour unit is the
  // current window whatever this one was.
  const chooseUnit = (unit: ActivityUnit) => {
    if (unit === 'five-hour') {
      if (fiveHourNow !== null) show(fiveHourNow, true);
      return;
    }
    const inside = now >= window.from && now < window.to;
    show(unitKey(unit, inside ? now : window.from), inside);
  };
  useEffect(() => {
    if (following.current && !onNow && currentKey !== null) show(currentKey, true);
  });
  // The scroll kept across a change of shape (M9 fix 192): the place,
  // not the pixel. Before a density toggle the box's scroll is read as a
  // fraction of its scrollable extent on each axis and written back after
  // the paint, so the row under the middle of the box stays near it; a
  // form that does not scroll leaves the fraction as it was, so rows to
  // packed and back lands where the rows were. An orientation flip has no
  // shared axis, so it lands at the end the form reads from: the now end
  // downwards while the view follows the clock, else the start.
  const body = useRef<HTMLDivElement>(null);
  const time = useRef<HTMLDivElement>(null);
  // Ctrl+wheel over the time container zooms the strip (M9 fix 213): a
  // width factor on its box under the body's sideways scroll, the axis
  // and the tick row stretching with it, the point under the pointer
  // kept where it is the way the commits graph's zoom does. Vertical
  // only when time runs across.
  const pendingScale = useRef<{ offset: number; into: number; from: number } | null>(null);
  useEffect(() => {
    const el = time.current;
    const box = body.current;
    if (el === null || box === null || vertical) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      const next = stepStripScale(stripScale, ev.deltaY < 0 ? 1 : -1);
      if (next === stripScale) return;
      const br = box.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      pendingScale.current = { offset: ev.clientX - br.left, into: ev.clientX - er.left, from: stripScale };
      setStripScale(next);
      try {
        localStorage.setItem(STRIP_SCALE_KEY, String(next));
      } catch {
        // The choice just will not survive the restart.
      }
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [stripScale, vertical]);
  useLayoutEffect(() => {
    const z = pendingScale.current;
    pendingScale.current = null;
    const el = time.current;
    const box = body.current;
    if (z === null || el === null || box === null) return;
    const br = box.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const k = stripScale / z.from;
    box.scrollLeft = er.left - br.left + box.scrollLeft + z.into * k - z.offset;
  }, [stripScale]);
  const kept = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const shaped = useRef(false);
  const keepPlace = () => {
    const el = body.current;
    if (el === null) return;
    const roomY = el.scrollHeight - el.clientHeight;
    const roomX = el.scrollWidth - el.clientWidth;
    kept.current = { y: roomY > 0 ? el.scrollTop / roomY : kept.current.y, x: roomX > 0 ? el.scrollLeft / roomX : kept.current.x };
    shaped.current = true;
  };
  useLayoutEffect(() => {
    const el = body.current;
    if (el === null || !shaped.current) return;
    shaped.current = false;
    el.scrollTop = kept.current.y * (el.scrollHeight - el.clientHeight);
    el.scrollLeft = kept.current.x * (el.scrollWidth - el.clientWidth);
  }, [condensed]);
  const flipped = useRef(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (el === null || !flipped.current) return;
    flipped.current = false;
    el.scrollTop = vertical && following.current ? el.scrollHeight : 0;
    el.scrollLeft = 0;
  }, [vertical]);
  const flip = () => {
    const next: StripOrientation = vertical ? 'horizontal' : 'vertical';
    flipped.current = true;
    setOrientation(next);
    try {
      localStorage.setItem(ORIENTATION_KEY, next);
    } catch {
      // The choice just will not survive the restart.
    }
  };
  const chooseLayers = (next: ActivityLayers) => chooseState({ ...state, layers: next });
  const hereStep = paneId !== undefined && hereScope;
  const toggleScope = () => chooseState({ ...state, scope: nextScope(scope, folder, panesScope, hereStep) });
  const toggleDensity = () => {
    const next = !condensed;
    keepPlace();
    setCondensed(next);
    try {
      localStorage.setItem(DENSITY_KEY, next ? 'condensed' : 'rows');
    } catch {
      // The choice just will not survive the restart.
    }
  };
  // The week's own density (M9 fix 281): the ridges have no tracks to
  // pack, so the button toggles the condensed form instead.
  const toggleWeekDensity = () => {
    const next = !weekCondensed;
    setWeekCondensed(next);
    try {
      localStorage.setItem(WEEK_DENSITY_KEY, next ? 'condensed' : 'full');
    } catch {
      // The choice just will not survive the restart.
    }
  };
  // The crosshair's position as a percent of the strip's width, null off
  // it; the strip's box is read on each move rather than kept, since the
  // legend and the names sit beside it and a pointer over them is off.
  // The pointer's y inside the box and the box's width ride along (M9
  // fix 251) for the floating readout: negative over the band, past the
  // tracks over the tick row, the strip sorts out which.
  const [crossing, setCrossing] = useState<{ percent: number; y: number; width: number } | null>(null);
  const cross = crossing === null ? null : crossing.percent;
  const stripBox = useRef<HTMLDivElement>(null);
  const onCrossMove = (ev: ReactPointerEvent) => {
    const rect = stripBox.current?.getBoundingClientRect();
    if (rect === undefined || rect.width === 0 || ev.clientX < rect.left || ev.clientX > rect.right) {
      setCrossing(null);
      return;
    }
    setCrossing({ percent: Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * 100, y: ev.clientY - rect.top, width: rect.width });
  };
  const crossAt = cross === null ? null : axis.from + (cross / 100) * (axis.to - axis.from);
  // The third clause and the second line (M9 fix 231) only while anyone
  // was waiting at that instant.
  const crossWaiting = crossAt === null ? 0 : loadAt(debt.all, crossAt);
  const crossText = crossAt === null ? null : `${clockTime(crossAt)} · ${loadAt(load, crossAt)} running${crossWaiting > 0 ? ` · ${crossWaiting} waiting on you` : ''}`;
  const crossSub = crossAt === null || crossWaiting === 0 ? null : waitingNames(list, crossAt);
  const crossProps = crossing === null || crossAt === null || crossText === null ? null : { ...crossing, at: crossAt, text: crossText, sub: crossSub };
  // The rows the strip draws: every session with working time, a
  // shell's lifetime row left out (M9 fix 191).
  const drawn = drawnSessions(list);
  const names = drawn.map(rowName);
  // Each row's window debt for the name gutter (M9 fix 231), on the
  // rows that have any.
  const gutterDebt = drawn.map((s) => sessionDebt(s, bounds.from, Math.min(bounds.to, now)).debtMs);
  // Packed, the rows are the card's tracks at its height; a row each
  // otherwise, at a height that fits a name beside it.
  const rows = condensed ? packTracks(drawn) : drawn.map((s) => [s]);
  const rowHeight = condensed ? TRACK_HEIGHT : ROW_HEIGHT;
  const loadHeight = condensed ? Math.min(PACKED_LOAD_MAX, Math.max(PACKED_LOAD_MIN, rows.length * TRACK_HEIGHT)) : LOAD_HEIGHT;
  return (
    <div
      className="file-view activity-view"
      style={{ "--strip-scale": stripScale } as CSSProperties}
      data-path={path}
      data-place={onClose === undefined ? 'pane' : 'tab'}
      data-window={key}
      data-unit={window.unit}
      data-day={day}
      data-following={following.current || undefined}
      data-orientation={orientation}
      data-density={(week ? weekCondensed : condensed) ? 'condensed' : 'rows'}
      data-strip-scale={stripScale}
      data-layers={layers}
      data-scope={scope}
      data-tab-name={scope === 'here' ? (tabName ?? undefined) : undefined}
      data-folder={folder ?? undefined}
      data-controls={folded ? 'folded' : 'shown'}
      data-tracks={rows.length}
      data-state={activity === null ? 'loading' : 'ready'}
      data-sessions={list.length}
      data-cross={cross === null ? undefined : cross.toFixed(2)}
      data-cross-y={crossing === null ? undefined : Math.round(crossing.y)}
      tabIndex={-1}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' && week && weekPick.size > 0) {
          ev.preventDefault();
          resetWeekPick();
          return;
        }
        if (ev.key !== 'Home' || onNow) return;
        ev.preventDefault();
        toNow();
      }}
    >
      {!folded && (
        <div className="file-header">
          {/* The tab's only title (M9 fix 126); a pane's title bar names the window already, and at a half pane the span was what gave way. */}
          {onClose !== undefined && (
            <span className="file-path activity-view-title" title={week ? `The activity of the ${windowName(window)}` : `The activity of ${window.unit === 'day' ? 'the day' : `the ${unitWord(window.unit)}`} ${windowName(window)}${window.unit === 'day' ? '' : ` on ${day}`}`}>
              Activity · {windowName(window)}
            </span>
          )}
          <button className="files-button activity-day-prev" title={fiveHourUnit ? NO_PAST_WINDOWS : `The ${window.unit} before`} disabled={fiveHourUnit} onClick={() => step(-1)}>
            ◀
          </button>
          <button className="files-button activity-day-next" title={fiveHourUnit ? NO_PAST_WINDOWS : `The ${window.unit} after`} disabled={onNow || fiveHourUnit} onClick={() => step(1)}>
            ▶
          </button>
          <button className="files-button activity-now-button" title={onNow ? `On the current ${unitWord(window.unit)}` : `Back to the current ${unitWord(window.unit)} (Home)`} disabled={onNow} onClick={toNow}>
            now
          </button>
          <span className="file-view-switch activity-units" role="group" aria-label="Window">
            {ACTIVITY_UNITS.map((u) => (
              <button key={u} className="files-button activity-unit" data-unit={u} data-active={window.unit === u || undefined} disabled={u === 'five-hour' && fiveHourNow === null} title={u === 'five-hour' ? (fiveHourNow === null ? NO_FIVE_HOUR_READING : 'The current five-hour usage window') : `One ${u} at a time`} onClick={() => chooseUnit(u)}>
                {unitLabel(u)}
              </button>
            ))}
          </span>
          {/* The live figure (M9 fix 231): the longest current wait while any drawn session is asking, with the needs-input pulse; at rail width the CSS moves it to the stats line's second line. */}
          {asking !== null && (
            <span className="activity-view-live-debt" data-ms={asking.ms} title={`${asking.name} has been waiting on you the longest of the sessions asking now`}>
              <i className="activity-debt-pulse" />
              waiting on you {formatSpanLength(asking.ms)}
            </span>
          )}
          {/* The scope (M9 fix 178): every session, the folder the view was opened on, (M9 fix 250) the sessions on the panes, or (M9 fix 261) the panes of this pane's tab, cycled; the folder step is skipped without a folder, and the pill is not drawn while no other step can be taken. */}
          {(folder !== null || panesScope) && (
            <button className="files-button activity-scope" data-scope={scope} title={scopeTitle(scope, folder, unitWord(window.unit), panesScope, hereStep, tabName)} onClick={toggleScope}>
              {scopePill(scope)}
            </button>
          )}
          <button className="files-button activity-density" data-active={(week ? weekCondensed : condensed) || undefined} title={week ? (weekCondensed ? 'The ridges alone' : 'One ridge per day, the figures') : condensed ? 'One row per session' : 'Pack the sessions onto tracks'} onClick={week ? toggleWeekDensity : toggleDensity}>
            ≡
          </button>
          {/* The layers (M9 fix 166): the band, the lanes or both, cycled; the vertical form draws no band, so the button waits for the turn back; the week (M9 fix 230) draws its ridges and no lanes. */}
          <LayersButton value={layers} onChange={chooseLayers} disabled={vertical || week} title={week ? 'The week draws one ridge per day, no lanes' : 'Time across has the band'} />
          <button className="files-button activity-orientation" disabled={week} title={week ? 'The week is always time across' : vertical ? 'Time across' : 'Time downwards'} onClick={flip}>
            ⇅
          </button>
          {onClose !== undefined && (
            <button className="files-button" title="Close (Ctrl+W)" onClick={onClose}>
              ×
            </button>
          )}
          {onFold !== undefined && (
            <button className="files-button activity-controls-fold" title="Hide the chrome, the title bar and these controls; right-click the pane to bring them back" onClick={onFold}>
              ▴
            </button>
          )}
        </div>
      )}
      {/* M9 fix 607: how far back the daemon's history reaches, one muted line under the header; it folds away with the header. */}
      {!folded && historyFrom !== null && (
        <div className="activity-view-history" data-from={historyFrom} title={`The oldest line the daemon read from its hook log, ${dayKey(historyFrom)} ${clockTime(historyFrom)}. The log is kept by size, so a busy week reaches back less far than a quiet one.`}>
          {historyFromText(historyFrom, now)}
        </div>
      )}
      <div className="file-body activity-view-body" ref={body}>
        {/* The agent time in ms for the scripts (M9 fix 228): the words round to the minute. */}
        <div className="activity-view-stats" data-agent-ms={stats.agentMs}>
          {onNow ? (window.unit === 'day' ? 'today · ' : week ? 'this week · ' : 'now · ') : ''}
          {/* M9 fix 280: the pick's head, clickable to show every day again. */}
          {weekPickHead !== '' && (
            <span className="activity-view-week-pick" title="Show every day again" onClick={resetWeekPick}>
              {weekPickHead}
              {' · '}
            </span>
          )}
          {weekText !== null ? (
            <span title={weekCondensed ? weekFullText! : undefined}>{weekText}</span>
          ) : stats.agentMs === 0 ? (
            (scope === 'panes' || scope === 'here') && list.length === 0 ? `nothing ${scopeWords(scope, folder, folderTitle, tabName)}` : 'nothing yet'
          ) : (
            statsFigures(stats)
          )}
          {/* The debt part (M9 fix 231), after the peak and absent at zero; where the line wraps it leads the second line, its separator dropped and the live pulse on it in place of the header's figure. */}
          {!week && stats.agentMs > 0 && debtPart !== null && (
            <span className="activity-view-debt-part" title={debtStatsTitle(stats) ?? undefined} data-debt-ms={stats.debtMs} data-asked-ms={stats.askedMs} data-union-ms={stats.debtWallMs} data-away-ms={stats.awayMs} data-live={asking === null ? undefined : ''}>
              <span className="activity-view-sep">{' · '}</span>
              {asking !== null && <i className="activity-debt-pulse" data-place="line" />}
              {debtPart}
            </span>
          )}
          {/* The capped part (M9 fix 285), after the waiting part: how long the account was cut off from Claude in the window, the tooltip naming each window and its reset. */}
          {!week && cappedPart !== null && (
            <span className="activity-view-capped-part" title={cappedStatsTitle(capped, bounds.from, Math.min(bounds.to, now), usageWindowName) ?? undefined} data-capped-ms={cappedWallMs(capped, bounds.from, Math.min(bounds.to, now))} data-bands={capped.length}>
              {' · '}
              {cappedPart}
            </span>
          )}
          {/* The tally and the totals read on the week too (M9 fix 265): the stats run on the view's window whatever the unit, and the week's line wants its price as the day's has it. */}
          {stats.agentMs > 0 && tally !== null && (
            <span className="activity-view-tally" title={commitsStatsTitle(stats) ?? undefined} data-commits={stats.commits} data-merges={stats.merges}>
              {' · '}
              {tally}
            </span>
          )}
          {stats.agentMs > 0 && tokens !== null && (
            <span className="activity-view-totals" title={tokensStatsTitle(stats) ?? undefined} data-requests={stats.requests} data-estimated={stats.estimated || undefined}>
              {' · '}
              <span className="activity-view-tokens">
                <TokensArrow dir="up" />
                {tokens.up} <TokensArrow dir="down" />
                {tokens.down}
              </span>
              {' · '}
              <span className="activity-view-usd">{tokens.usd}</span>
            </span>
          )}
          {stats.running !== null && stats.agentMs > 0 && (
            <>
              {' · '}
              <TokenBars ring={ring} running={stats.running} />
              {runningText(stats)}
            </>
          )}
        </div>
        {activity !== null && drawn.length === 0 && <div className="files-empty">No session worked in this {unitWord(window.unit)}.</div>}
        {drawn.length > 0 && pickedRidges !== null && (
          <ActivityRidges rows={pickedRidges.rows} peak={pickedRidges.peak} offRows={offRidgeRows} now={now} running={stats.running} form={weekCondensed ? 'condensed' : 'full'} onToggleDay={toggleWeekDay} onSoloDay={soloWeekDay} />
        )}
        {drawn.length > 0 && !vertical && !week && (
          <div ref={time} className="activity-view-time" onPointerMove={onCrossMove} onPointerLeave={() => setCrossing(null)}>
            {load.peak > 0 && showsBand(layers) && (
              <div className="activity-view-load">
                {/* Packed, the rows have no names column, so the band takes the strip's full width too and the stats line above is its legend. */}
                {!condensed && (
                  <div className="activity-view-load-legend">
                    <span className="activity-view-load-label">agents at once</span>
                    <span className="activity-view-load-peak">peak {load.peak}</span>
                    <span className="activity-view-load-median">median {load.median} while busy</span>
                    {debt.all.peak > 0 && <span className="activity-view-load-waiting">{debt.all.peak} waiting at once</span>}
                  </div>
                )}
                <div className="activity-view-load-band">
                  {/* Packed, the mock's condensed strip: the fill and its line at .18 with the peak line alone, no grey rules (M9 fix 165). */}
                  <ActivityLoad axis={axis} load={load} now={now} running={stats.running} height={loadHeight} fillOpacity={condensed ? 0.18 : 0.15} rules={!condensed} crossPercent={cross} />
                  {/* The mirror (M9 fix 231), under the band's bottom rule, which is its zero line; only while the window has debt. */}
                  {debt.all.peak > 0 && <ActivityDebt axis={axis} debt={debt} now={now} height={condensed ? DEBT_HEIGHT_PACKED : DEBT_HEIGHT} crossPercent={cross} capped={capped} />}
                </div>
              </div>
            )}
            {/* The band alone (M9 fix 166) keeps the strip's tick row, the time axis and the crosshair readout, with no tracks on it; the names column stays as an empty gutter so the axis keeps the band's left edge. */}
            <div className="activity-view-rows">
              {!condensed && (
                <div className="activity-view-names">
                  {showsLanes(layers) && drawn.map((s, i) => (
                    <div key={activityRowKey(s)} className="activity-view-name" style={{ height: ROW_HEIGHT }} data-session-id={s.sessionId} data-agent-id={s.agentId ?? undefined} data-agent={isAgent(s) ? '' : undefined} data-outside={s.outside === true ? '' : undefined} title={rowTitle(s.spans) + outsideNote(s)}>
                      <span className="activity-view-name-text">{names[i]}</span>
                      {(gutterDebt[i] ?? 0) > 0 && (
                        <span className="activity-view-name-debt" data-ms={gutterDebt[i]} title={`${formatSpanLength(gutterDebt[i]!)} waiting on you in this ${unitWord(window.unit)}`}>
                          {formatSpanLength(gutterDebt[i]!)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="activity-view-strip" ref={stripBox}>
                <ActivityStrip rows={showsLanes(layers) ? rows : []} axis={axis} now={now} rowHeight={rowHeight} working={working} owed={owed} cross={crossProps} capped={capped} />
                {/* M9 fix 321: the usage window's pace bar under the axis, the strip's reading at the axis's width, so the view says how much of the window being paid for has gone and how fast. */}
                {axisBar !== null && (
                  <div className="activity-view-axis-bar" title={`The five-hour usage window: ${fiveHourUsage!.percent}% used, the mark where the fill would end at an even pace`}>
                    <UsageBar bar={axisBar} form="axis" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {drawn.length > 0 && vertical && (
          <div className="activity-view-columns">
            {!condensed && (
              <div className="activity-view-names" data-vertical="">
                {drawn.map((s, i) => (
                  <div key={activityRowKey(s)} className="activity-view-name" style={{ width: ROW_HEIGHT }} data-session-id={s.sessionId} data-agent-id={s.agentId ?? undefined} data-agent={isAgent(s) ? '' : undefined} data-outside={s.outside === true ? '' : undefined} title={`${names[i]}\n${rowTitle(s.spans)}` + outsideNote(s)}>
                    <span>{names[i]}</span>
                  </div>
                ))}
              </div>
            )}
            <ActivityStrip rows={rows} axis={axis} now={now} rowHeight={rowHeight} working={working} owed={owed} orientation="vertical" length={ticks * TICK_LENGTH} capped={capped} />
          </div>
        )}
      </div>
    </div>
  );
}

// The bars (M9 fix 216): M39's geometry, one bar per bucket, the newest
// at the right, each scaled from the box's bottom on M41's curve; the
// tooltip gives the newest bucket in words, and `data-total` the ring's
// sum for the scripts. M9 fix 229: a bar that rose since the last draw
// carries `data-rise`, and the CSS gives it no transition, a meter's
// attack, while a falling bar eases down; the height itself lands at
// once and nothing reads the transition.
function TokenBars({ ring, running }: { ring: TokenRing; running: number }) {
  const heights = ring.buckets.map(barHeight);
  const before = useRef<{ heights: number[]; rising: boolean[] }>({ heights, rising: heights.map(() => false) });
  // A bar keeps its mark until it falls, so a redraw with the same
  // heights does not take the attack off a bar that just rose.
  const rising = heights.map((h, i) => {
    const was = before.current.heights[i] ?? BAR_FLOOR;
    return h > was + 1e-6 ? true : h < was - 1e-6 ? false : (before.current.rising[i] ?? false);
  });
  useEffect(() => {
    before.current = { heights, rising };
  });
  return (
    <span className="activity-bars" title={barsTitle(ring, running)} data-newest={newestTokens(ring)} data-total={Math.round(ring.buckets.reduce((a, b) => a + b, 0))} data-agents={ring.agents.size}>
      {heights.map((h, i) => (
        <i key={i} data-rise={rising[i] ? '' : undefined} style={{ transform: `scaleY(${h.toFixed(3)})` }} />
      ))}
    </span>
  );
}

// Whether the ring shows nothing: every bucket empty.
function quietRing(ring: TokenRing): boolean {
  return ring.buckets.every((b) => b === 0);
}

// An agent's row (M62) sits under its parent's, indented by the CSS, named
// by its description or its type; a session's by its name.
function isAgent(s: ActivitySession): boolean {
  return s.agentId !== null && s.agentId !== undefined;
}

// A track outside emerald (M9 fix 233) that the history scan could not
// name (no transcript under the Claude home) is named for what it is.
function rowName(s: ActivitySession): string {
  if (isAgent(s)) return s.name ?? 'agent';
  return s.name ?? (s.outside === true ? OUTSIDE_WORD : 'no longer listed');
}

// The longest current wait (M9 fix 231): over the drawn sessions the
// store lists at needs-input, the time since that state began; null
// while nobody is asking, so the figure's absence says so.
function longestAsk(list: readonly ActivitySession[], sessions: ReadonlyMap<string, SessionInfo>, owed: ReadonlyMap<string, DebtKind>, now: number): { name: string; ms: number } | null {
  let best: { name: string; ms: number } | null = null;
  for (const s of drawnSessions(list)) {
    if (isAgent(s) || owed.get(s.sessionId) !== 'asked') continue;
    const info = sessions.get(s.sessionId);
    if (info === undefined) continue;
    const ms = Math.max(0, now - info.stateSince);
    if (best === null || ms > best.ms) best = { name: rowName(s), ms };
  }
  return best;
}

// The sessions waiting at an instant (M9 fix 231), for the crosshair's
// second line: up to three, the longest wait at that instant first,
// each with how long it had been waiting by then, and the rest counted.
export function waitingNames(list: readonly ActivitySession[], at: number): string | null {
  const waiting: Array<{ name: string; ms: number }> = [];
  for (const s of drawnSessions(list)) {
    if (isAgent(s)) continue;
    for (const d of s.debt ?? []) {
      if (d.from <= at && at < d.to) {
        waiting.push({ name: rowName(s), ms: at - d.from });
        break;
      }
    }
  }
  if (waiting.length === 0) return null;
  waiting.sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name));
  const named = waiting.slice(0, 3).map((w) => `${w.name} ${formatSpanLength(w.ms)}`).join(' · ');
  return waiting.length > 3 ? `${named} +${waiting.length - 3} more` : named;
}

function rowTitle(spans: Array<{ from: number; to: number }>): string {
  return spans.map((s) => `${clockTime(s.from)} to ${clockTime(s.to)}`).join(', ');
}

function loadCondensed(): boolean {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'condensed';
  } catch {
    return false;
  }
}

function loadWeekCondensed(): boolean {
  try {
    return localStorage.getItem(WEEK_DENSITY_KEY) === 'condensed';
  } catch {
    return false;
  }
}

// The next zoom step up or down (M9 fix 213), the commits graph's steps.
function stepStripScale(scale: number, dir: 1 | -1): number {
  const i = (GRAPH_SCALE_STEPS as readonly number[]).indexOf(scale);
  const at = i === -1 ? GRAPH_SCALE_STEPS.indexOf(1) : i;
  return GRAPH_SCALE_STEPS[Math.max(0, Math.min(GRAPH_SCALE_STEPS.length - 1, at + dir))]!;
}

function loadStripScale(): number {
  try {
    const raw = Number(localStorage.getItem(STRIP_SCALE_KEY));
    return isGraphScale(raw) ? raw : 1;
  } catch {
    return 1;
  }
}

function loadOrientation(): StripOrientation {
  try {
    return localStorage.getItem(ORIENTATION_KEY) === 'vertical' ? 'vertical' : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

// The titles of the arrows on the five-hour unit and of its button with
// no reading (M9 fix 321).
const NO_PAST_WINDOWS = 'only the current window; past windows are not kept yet';
const NO_FIVE_HOUR_READING = 'no five-hour window; the usage strip has no reading';

// The view's clock: every five seconds, and every second on a minute
// window, where the now mark crosses a tick every ten.
function useNow(unit: ActivityUnit): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), unit === 'minute' ? 1000 : 5000);
    return () => clearInterval(timer);
  }, [unit]);
  return now;
}
