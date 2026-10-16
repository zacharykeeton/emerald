import { useEffect, useMemo, useState } from 'react';
import { ACTIVITY_UNITS, activityLoad, activityStats, dayBounds, dayKey, debtLoad, fiveHourKey, folderTitle, liveSpans, packTracks, runningText, statsText, unitBounds, unitKey, unitLabel, unitWord, weekProfiles, weekStats, weekStatsText } from '@emerald/shared';
import type { ActivityUnit } from '@emerald/shared';
import { openViewBeside } from './actions.ts';
import { owedIds, useActivity, workingIds } from './activity-data.ts';
import { scopeWords, scopedSessions } from './activity-scope.ts';
import type { ActivityScope } from './activity-scope.ts';
import { bandHeight, stripAxis } from './activity-strip.ts';
import { readLayers, showsBand, showsLanes, writeLayers } from './activity-layers.ts';
import type { ActivityLayers } from './activity-layers.ts';
import { LayersButton } from './ActivityLayers.tsx';
import { PaneIcon, TabIcon } from './icons.tsx';
import { ActivityDebt } from './ActivityDebt.tsx';
import { ActivityLoad } from './ActivityLoad.tsx';
import { ActivityRidges } from './ActivityRidges.tsx';
import { ActivityStrip } from './ActivityStrip.tsx';
import { activityViewSupported, viewStateSupported } from './daemon-model.ts';
import { useStore } from './store.ts';
import { useFiveHourWindow } from './usage-reading.ts';
import { ActivityTextAnchor } from './SweepCards.tsx';
import { activityPath } from './tabs-model.ts';
import { openFileTab, toggleActivityFold, useUi } from './ui.ts';
import { activityQuery, activityView } from './view-state.ts';
import type { ActivitySnapshot } from './view-state.ts';

// The day's activity as the first section of the rail's Activity tab
// (M66), above the commits: one line per session across the day's hours,
// packed onto as few tracks as keep them apart, so it stays a row or two
// tall, with the numbers on its head line. It was the card at the top of
// the sidebar (M54); the sidebar keeps to the sessions now and the two
// readings of what the agents did, time and commits, sit together. The
// strip keeps to the folder the rail is on, as the commits below it do,
// with `all` a toggle on the head; the pane form (ViewPane) passes the
// scope it stores, `panes` (M9 fix 250, M66's `tab`) meaning the sessions
// on a pane of any tab. A chevron folds it to the head line, the tab icon opens the day as
// a tab and (M69) the pane icon beside it opens the same view in a pane
// beside the focused one (M9 fix 219 drew both as icons, since the two
// glyphs read alike); the pane form shows neither, being in a pane already.
//
// M9 fix 121: the rail's section can show the current hour or minute
// as well as the day (M67's windows), a pill on the head cycling the
// unit; the section always follows the clock, since it has no paging,
// so there is no now button to press. The unit is the rail's, kept with
// its scope; the pane form keeps to the day.
// The class names are the card's, so what read the card reads this.
//
// M74: the load band above the tracks, condensed: 16px in the rail's
// narrow column and 22px in a pane, heavier as it gets shorter, with no
// legend, no peak caption and no crosshair, the head line's `1.7× · peak
// 5` being its legend. The band and the tracks share one left edge and
// the now line runs through both.

// The tracks are tight: a 2px line in a 5px row. The activity view's
// condensed form (M9 fix 120) packs at the same height.
export const TRACK_HEIGHT = 5;
const SCOPE_KEY = 'emerald.activityScope';
const UNIT_KEY = 'emerald.activityUnit';
// The card's controls line (M9 fix 168), shown unless folded away, and
// its layers, the band, the tracks or both, a key of the card's own.
const TOOLS_KEY = 'emerald.activityCardTools';
const LAYERS_KEY = 'emerald.activityCardLayers';

interface Props {
  folder: string | null;
  scope: ActivityScope;
  // Absent when the scope cannot be changed here (an older daemon holding
  // the pane's view); the head then shows no toggle.
  onScope?: ((scope: ActivityScope) => void) | undefined;
  // The sessions on the panes, for the panes scope; the rail passes none.
  paneIds?: ReadonlySet<string> | undefined;
  place: 'rail' | 'pane';
  // The window's unit (M9 fix 121), the day when absent; the pill shows
  // when a caller takes the change.
  unit?: ActivityUnit | undefined;
  onUnit?: ((unit: ActivityUnit) => void) | undefined;
}

export function ActivitySection({ folder, scope, onScope, paneIds, place, unit: chosenUnit = 'day', onUnit }: Props) {
  const { sessions, daemon } = useStore('sessions', 'daemon');
  // The five-hour unit (M9 fix 321) is the account's current usage
  // window off the strip's reading; with no reading (signed out,
  // loading) a kept choice of it reads as the day and the pill's cycle
  // skips it, so the card never shows a window it cannot place.
  const fiveHour = useFiveHourWindow();
  const unit = chosenUnit === 'five-hour' && fiveHour === null ? 'day' : chosenUnit;
  const { activityFolded } = useUi();
  const [tools, setTools] = useState<boolean>(loadCardTools);
  const toggleTools = () => {
    const next = !tools;
    setTools(next);
    try {
      localStorage.setItem(TOOLS_KEY, next ? 'shown' : 'folded');
    } catch {
      // The choice just will not survive the restart.
    }
  };
  const [layers, setLayers] = useState<ActivityLayers>(() => readLayers(LAYERS_KEY));
  const chooseLayers = (next: ActivityLayers) => {
    setLayers(next);
    writeLayers(LAYERS_KEY, next);
  };
  const now = useNow();
  const today = dayKey(now);
  // The window holding now: the key changes once a day, hour or minute,
  // and a memo on it keeps the fetch from re-running on every tick of
  // the clock.
  const windowKey = unit === 'five-hour' ? fiveHourKey(fiveHour!.from) : unitKey(unit, now);
  const day = useMemo(() => unitBounds(windowKey) ?? dayBounds(today) ?? { from: now, to: now }, [windowKey, today]);
  const activity = useActivity(day);
  const source = useMemo(
    () => ({
      folders: new Map([...sessions].map(([id, s]) => [id, { groupCwd: s.groupCwd, cwd: s.cwd }])),
      paneIds: paneIds ?? new Set<string>(),
    }),
    [sessions, paneIds],
  );
  if (activity === null) return null;
  // The section's window follows the clock, so the count running now
  // (M9 fix 207) is always read, and a working row's last span reaches
  // it (M9 fix 228) for the band, the line and the strip alike.
  const working = workingIds(sessions);
  const owed = owedIds(sessions);
  const shown = liveSpans(scopedSessions(activity.sessions, scope, folder, source), working, now, owed);
  const stats = activityStats(shown, day.from, Math.min(day.to, now), working);
  const load = activityLoad(shown, day.from, Math.min(day.to, now));
  // The mirror under the card's band (M9 fix 231), 14px, only while the
  // day has debt.
  const debt = debtLoad(shown, day.from, Math.min(day.to, now));
  const tracks = packTracks(shown);
  const axis = stripAxis(shown, day, now, unit);
  const words = scopeWords(scope, folder, folderTitle);
  const when = unit === 'day' ? 'today' : `this ${unitWord(unit)}`;
  // The week (M9 fix 230) draws its ridges at a third of the tab's scale
  // in place of the band and the strip, and its line is the week's.
  const ridges = unit === 'week' ? weekProfiles(shown, day.from, now) : null;
  const weekLine = ridges === null ? null : [weekStatsText(weekStats(ridges)), runningText(stats)].filter((p) => p !== null).join(' · ');
  const text = `${when} · ${words === null ? '' : `${words} · `}${weekLine ?? statsText(stats)}`;
  const units = fiveHour === null ? ACTIVITY_UNITS.filter((u) => u !== 'five-hour') : ACTIVITY_UNITS;
  const nextUnit = units[(units.indexOf(unit) + 1) % units.length]!;
  // The toggle shows where a choice exists: a folder to keep to, and a
  // caller that takes the change.
  const canToggle = onScope !== undefined && (folder !== null || scope === 'panes');
  const cycle = () => {
    if (onScope === undefined) return;
    onScope(scope === 'all' ? (paneIds === undefined ? 'folder' : 'panes') : 'all');
  };
  // What the tab and the pane open with (M9 fix 178): this section as it
  // stands; the view's pill (M9 fix 250) reaches the panes scope itself.
  const snapshot = (): ActivitySnapshot => ({ scope: scope === 'folder' && folder !== null ? 'folder' : scope === 'panes' ? 'panes' : 'all', folder, layers, usage: true });
  return (
    <div className="activity-card" data-place={place} data-scope={scope} data-unit={unit} data-window={windowKey} data-folded={activityFolded || undefined} data-sessions={shown.length} data-peak={stats.peak} data-median={load.median} data-tools={tools ? 'shown' : 'folded'} data-layers={layers}>
      <div className="activity-card-head">
        <button className="activity-fold" title={activityFolded ? `Show the ${unitWord(unit)}` : 'Fold to one line'} onClick={toggleActivityFold}>
          {activityFolded ? '▸' : '▾'}
        </button>
        {/* The line opens its card (M73 task 4), each number with its meaning; the tooltip said the same in one breath. */}
        <ActivityTextAnchor id={`${place}:${windowKey}`} text={text} stats={stats} sessions={shown.length} className="activity-text">
          {text}
        </ActivityTextAnchor>
        {/* The controls line (M9 fix 168): the head line was full, its text
            ellipsizing at the rail's width under four buttons, so the
            pills and the open buttons sit on a line of their own that
            this folds away; the flag is the card's, not the pane's
            controls flag, which a pane title bar brings back. */}
        <button className="activity-card-tools-toggle" data-active={tools || undefined} title={tools ? 'Hide the controls' : 'Show the controls'} onClick={toggleTools}>
          ⋯
        </button>
      </div>
      {tools && !activityFolded && (
      <div className="activity-card-tools">
        {onUnit !== undefined && (
          <button className="activity-unit-pick" data-unit={unit} title={`The current ${unitWord(unit)}; click for the ${unitWord(nextUnit)}`} onClick={() => onUnit(nextUnit)}>
            {unitLabel(unit)}
          </button>
        )}
        {canToggle && (
          <button className="activity-scope" data-scope={scope} title={scope === 'all' ? (paneIds === undefined ? 'Every session of the day; click for this folder only' : 'Every session of the day; click for the sessions on the panes only') : scope === 'panes' ? 'The sessions on the panes only; click for every session of the day' : 'This folder only; click for every session of the day'} onClick={cycle}>
            {scope === 'all' ? 'all' : scope === 'panes' ? 'panes' : 'folder'}
          </button>
        )}
        {place === 'rail' && (
          <button className="activity-expand" title={`Open the ${unitWord(unit)} as a tab`} onClick={() => openFileTab(activityPath(windowKey, activityQuery(snapshot())))}>
            <TabIcon />
          </button>
        )}
        {place === 'rail' && activityViewSupported(daemon) && (
          <button className="activity-expand activity-open-pane" title={`Open the ${unitWord(unit)} in a pane`} onClick={() => void openViewBeside(activityView(windowKey, viewStateSupported(daemon) ? snapshot() : null)).catch((err: unknown) => console.warn('[emerald] activity in a pane failed', err))}>
            <PaneIcon />
          </button>
        )}
        <LayersButton value={layers} onChange={chooseLayers} className="activity-card-layers" />
      </div>
      )}
      {!activityFolded && ridges !== null && <ActivityRidges rows={ridges.rows} peak={ridges.peak} now={now} running={stats.running} form="card" />}
      {!activityFolded && ridges === null && showsBand(layers) && <ActivityLoad axis={axis} load={load} now={now} running={stats.running} height={bandHeight(tracks.length, TRACK_HEIGHT, place === 'rail' ? 16 : 22)} fillOpacity={place === 'rail' ? 0.2 : 0.18} rules={false} />}
      {!activityFolded && ridges === null && showsBand(layers) && load.peak > 0 && debt.all.peak > 0 && <ActivityDebt axis={axis} debt={debt} now={now} height={14} />}
      {!activityFolded && ridges === null && showsLanes(layers) && <ActivityStrip rows={tracks} axis={axis} now={now} rowHeight={TRACK_HEIGHT} working={working} owed={owed} capped={activity.capped ?? []} />}
    </div>
  );
}

// The rail's scope, kept across a restart; the pane's lives on its view.
export function useRailScope(): [ActivityScope, (scope: ActivityScope) => void] {
  const [scope, setScope] = useState<ActivityScope>(loadScope);
  const set = (next: ActivityScope) => {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // The choice just will not survive the restart.
    }
  };
  return [scope, set];
}

// The rail's unit (M9 fix 121), kept the same way.
export function useRailUnit(): [ActivityUnit, (unit: ActivityUnit) => void] {
  const [unit, setUnit] = useState<ActivityUnit>(loadUnit);
  const set = (next: ActivityUnit) => {
    setUnit(next);
    try {
      localStorage.setItem(UNIT_KEY, next);
    } catch {
      // The choice just will not survive the restart.
    }
  };
  return [unit, set];
}

function loadUnit(): ActivityUnit {
  try {
    const stored = localStorage.getItem(UNIT_KEY);
    return stored === 'hour' || stored === 'minute' || stored === 'week' || stored === 'five-hour' ? stored : 'day';
  } catch {
    return 'day';
  }
}

function loadCardTools(): boolean {
  try {
    return localStorage.getItem(TOOLS_KEY) !== 'folded';
  } catch {
    return true;
  }
}

function loadScope(): ActivityScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'folder';
  } catch {
    return 'folder';
  }
}

// A clock for the growing ends of the live spans and the reset of the
// day, coarse enough to cost nothing.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
