import type { LayoutTab, SessionInfo } from '@emerald/shared';
import type { AttentionState } from './attention-model.ts';
import { listPanes, markKind, teamCounts, workingMotion } from '@emerald/shared';

// The pure half of the tab strip: what mark a layout tab wears. Moved out
// of TabStrip.tsx by M9 fix 220 so a test can read it.

export interface TabMark {
  kind: 'claude' | 'shell';
  tone: string;
  working: boolean;
}

// M39, M46: the tab's mark is in the tone of its most urgent session,
// the one the tab pulses for, still. M9 fix 627: otherwise the mark says
// what the tab holds and whether any of it is active, the first of these
// that holds: a Claude working steps the Claude mark in the working
// colour (stale is not motion, as on the row); a Claude with an agent out
// steps it in the idle tone (M9 fix 362, so the strip does not look asleep
// while the roster card is live); a shell running output blinks the shell
// mark, even beside an idle Claude; any Claude, exited included, is the
// still Claude mark; and a tab of shells alone is the still shell mark.
// M9 fix 220: a tab whose panes name no session the store has wears no
// mark at all, since the idle grey would say an idle session is in there
// (an exited session is still a session and keeps its mark).
export function tabMark(
  tab: LayoutTab,
  sessions: ReadonlyMap<string, SessionInfo>,
  wanting: AttentionState | undefined,
  runningShells: ReadonlySet<string>,
): TabMark | null {
  // A stalled session's pulse (M9 fix 232) is quiet; its mark is the
  // stale dot the row and the title draw, still.
  if (wanting !== undefined) return { kind: 'claude', tone: wanting === 'quiet' ? 'stale' : wanting, working: false };
  let any = false;
  let claude = false;
  let claudeWorking = false;
  let agentOut = false;
  let shellRunning = false;
  for (const pane of listPanes(tab)) {
    const session = pane.sessionId === null ? undefined : sessions.get(pane.sessionId);
    if (session === undefined) continue;
    any = true;
    if (markKind(session) === 'claude') {
      claude = true;
      if (workingMotion(session) !== null) claudeWorking = true;
      if (teamCounts(session).out > 0) agentOut = true;
    } else if (runningShells.has(session.id)) {
      shellRunning = true;
    }
  }
  if (claudeWorking) return { kind: 'claude', tone: 'working', working: true };
  if (agentOut) return { kind: 'claude', tone: 'idle', working: true };
  if (shellRunning) return { kind: 'shell', tone: 'idle', working: true };
  if (claude) return { kind: 'claude', tone: 'idle', working: false };
  if (any) return { kind: 'shell', tone: 'idle', working: false };
  return null;
}

// M9 fix 616: the pure half of the strip's scroll arrows.

export type StripCut = 'start' | 'end' | 'both' | null;

export const ARROW_REPEAT_DELAY_MS = 400;
export const ARROW_REPEAT_MS = 150;

// Which edges of the scroller hide something. reserve is the width of the
// arrows in the row: a strip that would fit once its arrows went reads as
// fitting, and one that overflows reads the same with or without them, so
// the arrows do not flicker in and out at the boundary.
export function stripCut(scrollLeft: number, clientWidth: number, scrollWidth: number, reserve: number): StripCut {
  if (scrollWidth - 1 <= clientWidth + reserve) return null;
  const end = scrollLeft + clientWidth < scrollWidth - 1;
  const start = scrollLeft > 0;
  return end && start ? 'both' : end ? 'end' : start ? 'start' : null;
}

// Where a page click scrolls to: the tab the edge cuts comes to the other
// edge whole, or a whole view when no tab can (one wider than the view).
export function pageTarget(
  slots: readonly { left: number; right: number }[],
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  side: 'start' | 'end',
): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  let target: number;
  if (side === 'end') {
    const slot = slots.find((s) => s.right > scrollLeft + clientWidth + 1);
    target = slot !== undefined && slot.left > scrollLeft + 1 ? slot.left : scrollLeft + clientWidth;
  } else {
    let slot: { left: number; right: number } | undefined;
    for (const s of slots) if (s.left < scrollLeft - 1) slot = s;
    target = slot !== undefined && slot.right - clientWidth < scrollLeft - 1 ? slot.right - clientWidth : scrollLeft - clientWidth;
  }
  return Math.round(Math.min(max, Math.max(0, target)));
}

// How far a wheel over the strip row scrolls the tabs. The scroller scrolls
// itself natively on a horizontal delta, so deltaX counts only outside it.
export function wheelStep(deltaX: number, deltaY: number, shift: boolean, inScroller: boolean): number {
  if (deltaY !== 0 && (!shift || deltaX === 0)) return deltaY;
  if (deltaX !== 0 && !inScroller) return deltaX;
  return 0;
}
