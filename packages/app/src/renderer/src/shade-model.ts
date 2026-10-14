import type { LayoutTab, SessionInfo, SessionState } from '@emerald/shared';
import { agentLineText, listPanes } from '@emerald/shared';
import type { AttentionState } from './attention-model.ts';

// The shade's rules (M63), pure so they are tested without a pane.

// The choices on the shade button's menu, in minutes; 0 is off.
export const SHADE_AFTER_CHOICES: readonly number[] = [0, 2, 5, 15, 30];

export function shadeAfterLabel(minutes: number): string {
  return minutes <= 0 ? 'Off' : `${minutes} min`;
}

// How often a pane asks whether its shade should come down. Seconds
// rather than the minute the setting is counted in, so a fraction of a
// minute set by a verify script fires in seconds and a person's setting
// is late by a few seconds at most.
export const SHADE_TICK_MS = 5000;

// The states a session can sit in before the shade comes down by itself:
// nothing is happening and nobody is asked for anything. Working,
// waiting on background tasks and needs-input never shade themselves; a
// needs-input pane is asking for the person, and a working one is what
// they came to watch.
const RESTING: ReadonlySet<SessionState> = new Set(['idle', 'done', 'exited']);

export interface ShadeCandidate {
  focused: boolean;
  shaded: boolean;
  // When a key or a click last went into the pane, or null for never.
  lastInputAt: number | null;
  // The session's stateSince at the moment a person last lifted this
  // pane's shade, or null. While the session's stateSince still equals
  // it the shade does not come back: a pane lifted to read stays up
  // until something happens in it.
  liftedAtStateSince: number | null;
}

// Whether the idle timer should shade this pane now: the setting is on,
// the pane is not the focused one (a person is looking at it), not
// already shaded, its session is at rest and has been since the setting
// says, with no key into the pane in that time, and nobody lifted the
// shade during this rest.
export function shouldAutoShade(session: Pick<SessionInfo, 'state' | 'stateSince'>, pane: ShadeCandidate, shadeAfterMinutes: number, now: number): boolean {
  if (!(shadeAfterMinutes > 0)) return false;
  if (pane.focused || pane.shaded) return false;
  if (!RESTING.has(session.state)) return false;
  if (pane.liftedAtStateSince !== null && pane.liftedAtStateSince === session.stateSince) return false;
  const since = Math.max(session.stateSince, pane.lastInputAt ?? 0);
  return now - since >= shadeAfterMinutes * 60_000;
}

// The panes of a layout tab a shade can go over: the ones on a session.
// A view pane (M52) has no terminal and an empty pane shows its picker.
export function shadeablePanes(tab: LayoutTab): string[] {
  return listPanes(tab)
    .filter((p) => p.view === null && p.sessionId !== null)
    .map((p) => p.id);
}

// The lid's live wait row (M9 fix 231, redrawn by fix 434): a
// needs-input session always draws it, off the record's own state as
// fix 231 had it, so the row does not depend on whether this pane's
// pulse is still armed. A finished reply only draws while the pulse is
// (wanting === 'done', the same test the overlay uses), so the row goes
// the moment the session is acknowledged rather than counting up
// forever on a done pane nobody is watching for.
export interface ShadeWait {
  kind: 'waiting' | 'done';
}

export function shadeWait(session: Pick<SessionInfo, 'state'>, wanting: AttentionState | undefined): ShadeWait | null {
  if (session.state === 'needs-input') return { kind: 'waiting' };
  if (wanting === 'done') return { kind: 'done' };
  return null;
}

// The row's activity line on the shade's face (M9 fix 654): what the
// sidebar row says under its name (agentLineText), whole, the last reply
// included once the turn is over. Nothing before the first prompt, as
// the row has none; nothing when the line is empty; and nothing when it
// says what the state word above already does (at needs-input both are
// what is waited on), since the face never says one thing twice. A
// pinned comment does not replace it here: the comment is the row's.
export function shadeActivity(session: Parameters<typeof agentLineText>[0] & Pick<SessionInfo, 'lastPrompt'>, stateText: string | null): string | null {
  if (session.lastPrompt === null) return null;
  const text = agentLineText(session);
  if (text === '' || text === stateText) return null;
  return text;
}
