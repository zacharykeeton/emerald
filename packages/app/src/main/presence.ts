// Presence (M9 fix 245): whether anyone is at the box, read off Electron's
// powerMonitor in index.ts and posted to the daemon as presence.away and
// presence.back, so the waiting stretches the activity view counts are
// docked by the time nobody could have answered. Three things say away:
// the screen locked, the box asleep, and nothing touched for
// EMERALD_AWAY_AFTER_MS (ten minutes, polled every minute). This tracker
// keeps the three apart and speaks only at the edges, so a lock during
// an idle stretch is one absence and the unlock alone does not end it.

export const AWAY_AFTER_MS = 10 * 60_000;
export const IDLE_POLL_MS = 60_000;

export type PresenceReason = 'locked' | 'asleep' | 'idle';

export class PresenceTracker {
  private readonly reasons = new Set<PresenceReason>();

  get away(): boolean {
    return this.reasons.size > 0;
  }

  // Returns the edge the change made, or null when it made none.
  set(reason: PresenceReason, on: boolean): 'away' | 'back' | null {
    const was = this.away;
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    const is = this.away;
    if (was === is) return null;
    return is ? 'away' : 'back';
  }
}

// The idle floor, ms, or null for no presence watching at all. The real
// box's lock screen, sleep and idle clock belong to the real home, as
// the chime does (M9 fix 47): a window on a private EMERALD_HOME is a
// verify script's or a click-through's, and on a box left to run
// overnight its idle poll was posting away a minute in and docking
// every live ask the script then read, so it watches nothing unless the
// run names a floor with EMERALD_AWAY_AFTER_MS.
export function awayAfterMs(): number | null {
  const raw = process.env['EMERALD_AWAY_AFTER_MS'];
  const ms = raw === undefined ? NaN : Number(raw);
  if (Number.isFinite(ms) && ms > 0) return ms;
  return process.env['EMERALD_HOME'] === undefined ? AWAY_AFTER_MS : null;
}
