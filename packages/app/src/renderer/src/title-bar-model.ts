import type { FolderRollup, Layout, SessionInfo } from '@emerald/shared';
import { currentTab, folderRollup, listPanes } from '@emerald/shared';

// The summary at the end of the title bar (M43): how many sessions are
// alive and how many panes of the tab on show hold one, and (M46, then
// M9 fix 88) the four units the folder headings carry, totalled over
// every folder, so the whole box reads at a glance with the sidebar
// collapsed. An exited session still has a row, but it is not a session
// anyone is running, so it is left out of both, as the headings leave
// the exited group out; a pane with nothing in it is a hole in the grid,
// not a pane on screen.
export interface TitleCounts {
  sessions: number;
  panes: number;
  roll: FolderRollup;
}

export function titleCounts(sessions: Iterable<SessionInfo>, layout: Layout | null, runningShells?: ReadonlySet<string>): TitleCounts {
  const alive = [...sessions].filter((s) => s.state !== 'exited');
  const panes = layout === null ? 0 : listPanes(currentTab(layout)).filter((p) => p.sessionId !== null).length;
  return { sessions: alive.length, panes, roll: folderRollup({ sessions: alive }, runningShells) };
}

// The words; the units beside them are drawn, not said (fix 88 dropped
// the "N agents out" phrase M46 put here, since the active-agents unit
// says it).
export function titleSummary(counts: Pick<TitleCounts, 'sessions' | 'panes'>): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(counts.sessions, 'session')}, ${plural(counts.panes, 'pane')} on screen`;
}
