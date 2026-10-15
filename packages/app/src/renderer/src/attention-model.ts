import { formatDuration } from '@emerald/shared';
import type { SessionState } from '@emerald/shared';

// Which sessions want a person, as renderer state on top of the daemon's
// session states. The daemon says when a session enters needs-input, done
// or errored; this keeps the ones nobody has acknowledged yet, so the row
// and the pane title can pulse and a chime can play until a click or a key
// in the window says someone is looking. Pure and unit tested; ui.ts holds
// the current value and attention.ts feeds it every sessions update.

// M9 fix 232: a stall is the fourth thing that wants a person. The daemon
// flags a working session `stale` when it has posted no hook for longer
// than its turn's pace allows; here that is its own attention state,
// `quiet`, with its own tone (the muted grey, never the needs-input
// teal: nothing is asking, something has stopped) and word (`quiet 12m`,
// describeState's), pulsing, chiming and notifying like the rest and
// hushable like them, and cleared by the next hook, which puts the
// session back to plain working.
export type AttentionState = SessionState | 'quiet';

export const ATTENTION_STATES: ReadonlySet<AttentionState> = new Set(['needs-input', 'done', 'errored', 'quiet']);

export function attentionState(session: { state: SessionState; stale?: boolean }): AttentionState {
  return session.state === 'working' && session.stale === true ? 'quiet' : session.state;
}

export type AttentionSound = 'off' | 'once' | 'repeat';
export const ATTENTION_SOUNDS: readonly AttentionSound[] = ['repeat', 'once', 'off'];

export interface AttentionModel {
  // Sessions whose row pulses.
  wanting: ReadonlySet<string>;
  // M9 fix 189: wanting sessions whose chime is stopped while the pulse
  // goes on. A press that acknowledges one session hushes the rest (the
  // person is here, no need to keep beeping for the others), and the row's
  // hush button (fix 190) does it for one by hand. Always a subset of
  // wanting: an id that leaves the set leaves this one too, and a fresh
  // arrival is never hushed, so it chimes and restarts the repeat.
  hushed: ReadonlySet<string>;
  // The state each session was in at the last observe. Only a change into
  // one of the three states counts as an arrival, so a session that is
  // already done when the window opens does not pulse for a turn nobody
  // watched it finish, and a repeated needs-input for the same prompt
  // does not chime twice. A change from one of the three to another does
  // count, wanting or not (M9 fix 41): a question after a finished reply
  // is more urgent than the reply, so done to needs-input chimes again.
  seen: ReadonlyMap<string, AttentionState>;
}

export interface Observed {
  model: AttentionModel;
  // Sessions that joined the set in this observe, for the chime.
  arrived: readonly string[];
  // M9 fix 701: sessions that changed into an attention state while the
  // person was answering in the pane showing them. They are settled as
  // they arrive: not wanting, not hushed, no chime, flash, toast or pulse.
  settled: readonly string[];
}

export function emptyAttention(): AttentionModel {
  return { wanting: new Set(), hushed: new Set(), seen: new Map() };
}

// Whether the repeat should run: something wants attention and is not hushed.
export function chiming(model: AttentionModel): boolean {
  for (const id of model.wanting) if (!model.hushed.has(id)) return true;
  return false;
}

// Runs over the current session list. Returns the very same model when
// nothing changed, so a caller can skip a store update. `answering` is the
// session the person is typing into (fix 701, answeringSession), whose
// arrival is settled rather than announced.
export function observe(model: AttentionModel, sessions: Iterable<{ id: string; state: SessionState; stale?: boolean }>, answering: string | null = null): Observed {
  const seen = new Map<string, AttentionState>();
  const wanting = new Set(model.wanting);
  const hushed = new Set(model.hushed);
  const arrived: string[] = [];
  const settled: string[] = [];
  for (const session of sessions) {
    const { id } = session;
    const state = attentionState(session);
    seen.set(id, state);
    const before = model.seen.get(id);
    if (ATTENTION_STATES.has(state)) {
      // A session still pulsing for done that goes to needs-input arrives
      // again: the set already has it, but the chime is for the change.
      if (before !== undefined && before !== state) {
        if (id === answering) {
          // Someone is typing into this very pane: they see it, so it is
          // seen, and a pulse it carried from before ends with it.
          wanting.delete(id);
          hushed.delete(id);
          settled.push(id);
        } else {
          wanting.add(id);
          // A change of state is news, so a hush on the old state is over.
          hushed.delete(id);
          arrived.push(id);
        }
      }
    } else if (before !== state) {
      // Only a change out of the three states drops the session, so one
      // marked unread while idle or exited stays until the next change.
      wanting.delete(id);
      hushed.delete(id);
    }
  }
  // A session that is gone from the list wants nothing.
  for (const id of wanting) {
    if (!seen.has(id)) {
      wanting.delete(id);
      hushed.delete(id);
    }
  }
  if (arrived.length === 0 && settled.length === 0 && sameSet(wanting, model.wanting) && sameSet(hushed, model.hushed) && sameMap(seen, model.seen)) return { model, arrived, settled };
  return { model: { wanting, hushed, seen }, arrived, settled };
}

// Someone clicked or typed on one session (M9 fix 189): its pulse stops,
// and every other pulse keeps going with its chime hushed, since the
// person is plainly at the keyboard and will get to them. Before fix 189
// one press anywhere emptied the whole set, which with eight panes on a
// tab left no way to tell which one had wanted them. The states seen
// stay, so the next observe does not read the same states as new
// arrivals.
export function acknowledge(model: AttentionModel, id: string): AttentionModel {
  const wanting = new Set(model.wanting);
  wanting.delete(id);
  const hushed = new Set(wanting);
  if (sameSet(wanting, model.wanting) && sameSet(hushed, model.hushed)) return model;
  return { ...model, wanting, hushed };
}

// A press that names no session (the rail, the tab strip, a blank bit of
// the sidebar, a key that switches tabs): nothing is acknowledged and
// every chime stops, the pulses staying until each session is looked at.
export function hushAll(model: AttentionModel): AttentionModel {
  return sameSet(model.wanting, model.hushed) ? model : { ...model, hushed: new Set(model.wanting) };
}

// The row's hush button (fix 190): this one's chime stops or comes back,
// the pulse untouched. Only a wanting session can be hushed.
export function setHushed(model: AttentionModel, id: string, on: boolean): AttentionModel {
  if (!model.wanting.has(id) || model.hushed.has(id) === on) return model;
  const hushed = new Set(model.hushed);
  if (on) hushed.add(id);
  else hushed.delete(id);
  return { ...model, hushed };
}

// Mark unread from the row menu: the session pulses again as if it had
// just arrived, except that it is not an arrival, so no chime and no
// notification. A session that is working or starting cannot be marked,
// since its next transition would clear the mark anyway. A hush on it is
// cleared, so the repeat runs for it again.
export function markUnread(model: AttentionModel, id: string): AttentionModel {
  if (model.wanting.has(id) && !model.hushed.has(id)) return model;
  const wanting = new Set(model.wanting);
  wanting.add(id);
  const hushed = new Set(model.hushed);
  hushed.delete(id);
  return { ...model, wanting, hushed };
}

export function canMarkUnread(state: SessionState): boolean {
  return state !== 'working' && state !== 'starting';
}

// M9 fix 201: the wanting sessions in the order a person should get to
// them: a question first (needs-input), then a finished reply (done), then
// an error, and within each the one that has waited longest first, off
// stateSince. The jump key walks this list and the picker's empty query
// puts it at the top, so both agree on who is next.
const WAIT_RANK: Readonly<Record<string, number>> = { 'needs-input': 0, done: 1, errored: 2, quiet: 3 };

export function waitingOrder<S extends { id: string; state: SessionState; stale?: boolean; stateSince: number }>(sessions: Iterable<S>, wanting: ReadonlySet<string>): S[] {
  const out: S[] = [];
  for (const s of sessions) if (wanting.has(s.id) && attentionState(s) in WAIT_RANK) out.push(s);
  out.sort((a, b) => {
    const byState = WAIT_RANK[attentionState(a)]! - WAIT_RANK[attentionState(b)]!;
    return byState !== 0 ? byState : a.stateSince - b.stateSince;
  });
  return out;
}

export function nextSound(sound: AttentionSound): AttentionSound {
  const at = ATTENTION_SOUNDS.indexOf(sound);
  return ATTENTION_SOUNDS[(at + 1) % ATTENTION_SOUNDS.length] ?? 'repeat';
}

export function isAttentionSound(value: unknown): value is AttentionSound {
  return typeof value === 'string' && (ATTENTION_SOUNDS as readonly string[]).includes(value);
}

// M9 fix 30: whether a key or a click landed in the window recently enough
// that a reply into the focused pane counts as seen without a gesture. The
// pane used to ack a done session the moment it had focus (M1), so a reply
// into an empty room never pulsed or chimed, since nothing checked that
// anyone was typing. Ten seconds after the last key or click is the window
// in which someone is taken to still be sitting there. M9 fix 701 reads the
// same window, per pane, for a question that comes into the pane being
// typed in: it gets no chime, flash, toast or pulse.
export const RECENT_INPUT_MS = 10_000;

export function isRecentInput(lastInputAt: number | null, now: number): boolean {
  return lastInputAt !== null && now - lastInputAt <= RECENT_INPUT_MS;
}

// M9 fix 701: the session the person is answering, if any: the focused
// pane's, when the last real press or key that landed in a pane landed in
// that one within RECENT_INPUT_MS. A key into another pane does not count
// for this one, and a focused pane with no session names nothing.
export function answeringSession(
  focused: { paneId: string; sessionId: string | null } | null,
  lastPaneInput: { paneId: string; at: number } | null,
  now: number,
): string | null {
  if (focused === null || focused.sessionId === null || lastPaneInput === null) return null;
  if (lastPaneInput.paneId !== focused.paneId) return null;
  return isRecentInput(lastPaneInput.at, now) ? focused.sessionId : null;
}

// M9 fix 247: the counter laid over a pulsing pane and lit on its row,
// `waiting 12s` for a question and `done 40s` for a finished reply, the
// figure climbing a second at a time off stateSince on the shared clock
// so the wait reads in front of the person and not only in the row's
// age. Only the two states a person is meant to answer: quiet carries
// its own `quiet 22s` word and errored an age on the row.
export interface WaitOverlay {
  word: 'waiting' | 'done';
  figure: string;
}

export function waitOverlay(state: AttentionState | undefined, stateSince: number, now: number): WaitOverlay | null {
  if (state !== 'needs-input' && state !== 'done') return null;
  return { word: state === 'needs-input' ? 'waiting' : 'done', figure: formatDuration(stateSince, now) };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function sameMap(a: ReadonlyMap<string, AttentionState>, b: ReadonlyMap<string, AttentionState>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
