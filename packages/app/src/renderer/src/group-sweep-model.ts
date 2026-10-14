import { runningKind } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { CLAUDE_ENTER_DELAY_MS } from './prompt-model.ts';

// M9 fix 193: the folder heading's sweep over every session under it.
// Close all types the program's own exit into each pane (/exit into a
// Claude, exit into a plain shell) so a Claude's SessionEnd hook keeps
// its record tidy on the graph and the activity strip, and falls back
// to the kill for one that has not gone after CLOSE_GRACE_MS: a Claude
// mid-turn ignores /exit until the turn ends, and a shell inside a
// program does not read it. Kill all is the row's Kill, one by one.

export type SweepMode = 'close' | 'kill' | 'remove';

// How long a session gets to leave on its own before the kill.
export const CLOSE_GRACE_MS = 5000;

export interface CloseTyping {
  text: string;
  // The pause before the Enter, the prompt box's for a Claude session so
  // Claude Code does not take the two for one paste.
  enterDelayMs: number;
}

// What to type to close the session gently; null for one with no PTY.
export function closeTyping(session: Pick<SessionInfo, 'kind' | 'claudeSessionId' | 'state'>): CloseTyping | null {
  if (session.state === 'exited') return null;
  return runningKind(session) === 'claude' ? { text: '/exit', enterDelayMs: CLAUDE_ENTER_DELAY_MS } : { text: 'exit', enterDelayMs: 0 };
}

export interface SweepCounts {
  // Every session the sweep would take.
  count: number;
  // How many of them are mid-turn, so a sweep over a busy Claude is a
  // knowing one; the item's title says it.
  working: number;
}

export function sweepCounts(sessions: Iterable<Pick<SessionInfo, 'state'>>): SweepCounts {
  let count = 0;
  let working = 0;
  for (const s of sessions) {
    count += 1;
    if (s.state === 'working') working += 1;
  }
  return { count, working };
}

// The item's label: the verb and the count, "Close all 8".
export function sweepLabel(mode: SweepMode, counts: SweepCounts): string {
  const verb = mode === 'close' ? 'Close all' : 'Kill all';
  return mode === 'remove' ? `${verb} ${counts.count} and remove` : `${verb} ${counts.count}`;
}

// The item's title: what the sweep does and how many are working now.
export function sweepTitle(mode: SweepMode, counts: SweepCounts): string {
  const busy = counts.working === 0 ? '' : counts.working === 1 ? '; one of them is working now' : `; ${counts.working} of them are working now`;
  switch (mode) {
    case 'close':
      return `Type /exit into each Claude and exit into each shell, and kill any that has not gone after ${CLOSE_GRACE_MS / 1000} seconds${busy}`;
    case 'kill':
      return `End every session under this folder now; the rows move to Exited${busy}`;
    case 'remove':
      return `End every session under this folder now and forget each as it exits${busy}`;
  }
}
