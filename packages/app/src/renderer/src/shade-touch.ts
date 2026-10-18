import type { SessionInfo } from '@emerald/shared';
import { liftPane } from './ui.ts';

// The idle shade's memory (M63), per pane and per window: when a key or
// a click last went into the pane, and the session's stateSince when a
// person last lifted its shade, which holds the shade up until the
// session's state moves again. Outside the store, since the sidebar has
// no use for it and a keystroke must not re-render every consumer. Its
// own module since M9 fix 844, so keys.ts can lift a pane the way a
// person's click does without importing Pane.tsx, which imports it.
export const paneTouched = new Map<string, number>();
export const paneLifted = new Map<string, number>();

export function touchPane(paneId: string): void {
  paneTouched.set(paneId, Date.now());
}

// A person lifting the shade, by a click, a key or a focus into the pane:
// the pane counts as touched and the lift is remembered against the
// session's state, so the idle timer leaves it up.
export function liftByPerson(paneId: string, session: SessionInfo | undefined): void {
  touchPane(paneId);
  if (session !== undefined) paneLifted.set(paneId, session.stateSince);
  liftPane(paneId);
}
