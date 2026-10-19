import { describeState, findPane } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import type { AttentionRequest } from '../../preload/api.ts';
import { ackIfDone, showSessionAuto, shownTab } from './actions.ts';
import { answeringSession, attentionState, chiming, isRecentInput, taskbarCounts } from './attention-model.ts';
import { chime, syncRepeat } from './attention-sound.ts';
import { isLookFirstKey } from './keys.ts';
import { isPulse } from './pulse-sync-model.ts';
import { getState, isFrontWindow, subscribe } from './store.ts';
import { PANES } from './tabs-model.ts';
import { acknowledgeAttention, getUiState, hushAttention, observeAttention, setChimeMode, subscribeUi } from './ui.ts';

// Wires the attention model to the world: every sessions push from the
// daemon goes through observeAttention, an arrival chimes unless the sound
// is off and asks the main process for a system notification unless that
// is off (the main process decides whether one goes out, since it knows
// whether the window is focused), the repeat runs while the set has
// something in it and the setting says so, and a click or key on a session
// acknowledges it. The speaker button that changes the settings, and
// the menu it opens, are the presses that do not count, since reaching
// for them is not looking at a session. A click on a notification shows
// the session, which is looking at it.
//
// M9 fix 189: the acknowledge is per session. A mousedown on a pane
// acknowledges that pane's session, one on a sidebar row that row's, a
// keydown the focused pane's, and each of those hushes the chimes of
// every other pulsing session, since the person is plainly here. A press
// that names no session (the tab strip, the rail, a blank bit of the
// sidebar) and a key that switches tabs hush every chime and acknowledge
// nothing, so a pulse on another tab survives the click that goes to
// look at it and still says which of eight panes wanted someone. Before
// this one press anywhere emptied the whole set.
//
// M31: the same click or key tells the daemon too. A done session was
// held at done until the pane showing it took focus (M1), and the pulse
// then took the same job with a looser gesture (M14), so a click anywhere
// stopped the pulse and left the badge saying done, which read as stuck.
// One gesture now means seen for both: the pulse clears here and every
// done session gets session.ack, so the badge goes to idle with the reply
// still on the row's bottom line. The daemon ignores an ack on a session
// that is not done, so a state change racing the click is harmless.
//
// M9 fix 30: the time of the last key or click is kept here as well, for
// the pane's own ack. A done session in the focused pane used to be acked
// the moment it landed, so a reply nobody was there for never pulsed;
// now the pane asks hadRecentInput first, and a reply into an empty room
// waits for the gesture above like any other.
//
// M9 fix 701: a question that comes into the pane the person is typing in
// is settled as it arrives, with no chime, taskbar flash, toast or pulse;
// the badge and the state word still change, since they read the daemon.
// "Typing in" is per pane: the panes are in front, the shown tab's focused
// pane holds the session, and the last real press or key that landed in a
// pane landed in that one within RECENT_INPUT_MS. The record is fed only
// by the window's own mousedown and keydown, so a scripted click (a shade
// lifted by .click()) does not count, and window focus is not read.

let lastInputAt: number | null = null;
// M9 fix 701: the pane the last real press or key landed in, and when.
let lastPaneInput: { paneId: string; at: number } | null = null;

// What the main process was last told about the attention set (M9 fix
// 104), so a sessions push that changed nothing sends nothing; an arrival
// the renderer chimed for is sent even at the same count, since the
// taskbar flashes with every chime, and since M9 fix 870 a change of the
// working or live count is a change too.
let lastSent: AttentionRequest | null = null;
// One send per tick (M9 fix 125): an arrival reaches here twice in the
// same call stack, from the UI listener when the set grows (no flash) and
// from the sessions listener that chimes for it (flash), which wrote two
// taskbar lines a millisecond apart. The last count wins and a flash from
// either is kept, sent once the stack unwinds.
let pending: { wanting: number; flash: boolean } | null = null;

function sendAttention(wanting: number, flash: boolean): void {
  if (pending !== null) {
    pending = { wanting, flash: pending.flash || flash };
    return;
  }
  pending = { wanting, flash };
  queueMicrotask(flushAttention);
}

function flushAttention(): void {
  if (pending === null) return;
  const next: AttentionRequest = { ...pending, ...taskbarCounts(getState().sessions.values()) };
  pending = null;
  if (lastSent !== null && lastSent.wanting === next.wanting && lastSent.working === next.working && lastSent.live === next.live && !next.flash) return;
  lastSent = next;
  window.emerald.notify.attention(next);
}

export function hadRecentInput(now = Date.now()): boolean {
  return isRecentInput(lastInputAt, now);
}

// M9 fix 670: a press or a key in a browser pane's page, which the
// window's own listeners never hear, still counts as someone at the
// keyboard. It acknowledges no session: a key in a page is not a look
// at a session.
export function noteGuestInput(now = Date.now()): void {
  lastInputAt = now;
}

export function installAttention(): () => void {
  const onSessions = () => {
    const sessions = getState().sessions;
    const { arrived, settled } = observeAttention(sessions.values(), answeringNow());
    const ui = getUiState();
    // The chime, the toast and the repeat are the front window's (M9 fix
    // 867), so two windows chime once for an arrival; every window's own
    // taskbar button still wears the count.
    const front = isFrontWindow();
    const sounding = front && arrived.length > 0 && ui.attentionSound !== 'off';
    const stateOf = (id: string): string => {
      const s = sessions.get(id);
      return s === undefined ? 'gone' : attentionState(s);
    };
    // One line per arrival so a chime that did not come can be traced
    // from the renderer console (M9 fix 41: a plan prompt was missed once
    // and the daemon's log showed the transition, so the miss was here or
    // later).
    for (const id of arrived) {
      console.log(`[emerald] attention ${id.slice(0, 8)} ${stateOf(id)}: sound ${ui.attentionSound}, chime ${sounding ? `scheduled (${ui.chimeMode})` : 'no'}`);
    }
    for (const id of settled) {
      console.log(`[emerald] attention ${id.slice(0, 8)} ${stateOf(id)}: answering in the focused pane, no chime, flash or toast`);
    }
    if (sounding) chime(ui.chimeMode);
    // The taskbar follows the chime's own gate, not the notification
    // setting: whenever it beeps it flashes, and with the sound off the
    // badge alone says how many are wanting.
    sendAttention(ui.attention.wanting.size, sounding);
    if (front && ui.attentionNotify) {
      for (const id of arrived) {
        const session = sessions.get(id);
        if (session !== undefined) window.emerald.notify.post({ sessionId: id, title: session.name, body: notificationBody(session) });
      }
    }
    syncRepeat(isFrontWindow() && chiming(ui.attention) && ui.attentionSound === 'repeat', ui.chimeMode);
  };
  // The setting can change while something is pulsing: off must stop the
  // repeat and repeat must start it. So can the hushed set (fix 189).
  const onUi = () => {
    const ui = getUiState();
    syncRepeat(isFrontWindow() && chiming(ui.attention) && ui.attentionSound === 'repeat', ui.chimeMode);
    // An acknowledge empties the set here, which is what clears the badge.
    sendAttention(ui.attention.wanting.size, false);
  };
  // Which chime this window may play (M9 fix 47) is a fact of the home
  // the app runs on, so the main process says; real until it answers,
  // which is long before any session can change state.
  void window.emerald
    .info()
    .then((info) => setChimeMode(info.chime))
    .catch((err: unknown) => console.warn('[emerald] could not read the chime mode', err));
  const onInput = (ev: Event) => {
    // A press on the speaker button is not looking at a session, but it is
    // still someone at the keyboard, so it counts as input. Nor is a press
    // on a filter chip (M44): a click on Done that acked every done row
    // would empty the list it was asked to show. Nor the row's hush
    // button (fix 190), which is for one chime and must leave the pulse
    // under it and the other chimes alone.
    lastInputAt = Date.now();
    notePaneInput(ev, lastInputAt);
    if (ev.target instanceof Element && ev.target.closest('.attention-sound, .attention-menu, .sidebar-filters, .context-popover, .roster-popover, .answer-popover, .activity-card, [data-action="hush"]') !== null) return;
    const sessionId = ev instanceof KeyboardEvent ? (isLookFirstKey(ev) ? null : focusedSessionId()) : pressedSessionId(ev);
    if (sessionId === null) {
      hushAttention();
      return;
    }
    acknowledgeAttention(sessionId);
    void ackIfDone(sessionId).catch((err: unknown) => console.warn('[emerald] ack failed', err));
  };
  const onClicked = (sessionId: string) => {
    acknowledgeAttention(sessionId);
    void showSessionAuto(sessionId)
      .then(() => ackIfDone(sessionId))
      .catch((err: unknown) => console.warn('[emerald] show from notification failed', err));
  };
  const unsubStore = subscribe(onSessions);
  const unsubUi = subscribeUi(onUi);
  const unsubClicked = window.emerald.notify.onClicked(onClicked);
  const unsubGuest = window.emerald.keys.onGuestInput(() => noteGuestInput());
  window.addEventListener('mousedown', onInput, { capture: true });
  window.addEventListener('keydown', onInput, { capture: true });
  const pulses = new MutationObserver(queueSync);
  pulses.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-attention', 'data-working', 'data-tone'] });
  document.addEventListener('animationstart', onPulseStart, { capture: true });
  return () => {
    pulses.disconnect();
    document.removeEventListener('animationstart', onPulseStart, { capture: true });
    unsubStore();
    unsubUi();
    unsubClicked();
    unsubGuest();
    window.removeEventListener('mousedown', onInput, { capture: true });
    window.removeEventListener('keydown', onInput, { capture: true });
    syncRepeat(false, getUiState().chimeMode);
  };
}

// The pulse on a row, a pane title and the pane's ring and wash is one CSS animation
// each, and each starts when its element gets data-attention, so a title
// that appears later than its row (a pane opened on a done session, a
// reload) beats out of step with it and the two read as two signals. Every
// pulse is started from the document's time zero instead, so they all
// share one clock. M39 puts the working rows on the same clock: the band
// (fix 535, the sheen before it) and the
// needs-pulse run inside the rows, the titles and the tabs, so every
// element is read with its subtree, and [data-working] joins the list,
// or two working sessions would pulse out of phase with each other, as
// does a needs-input mark, whose breathing outlives the pulse a click
// ends, and a shell's blinking caret; the roster's units sit under the
// rows and titles, so a whole team beats as one. The mark's step has its
// own clock in mark-clock.ts since M9 fix 767, an attribute on the root
// that every mark reads, so it needs no sync. Since fix 729 the pass
// runs on a pulse's animationstart and on a change of those attributes,
// no longer on every insert into the page, and it is one walk over the
// document's animations in place of a subtree read under every pulsing
// element; an animation already at zero is left alone.
//
// M9 fix 268: a pulse can also restart with no such mutation, when its
// element comes back from display: none (a split half hidden by the
// zoom, the sidebar folded and unfolded, a pane hidden and shown), and
// then it beats from the moment it reappeared until the next mutation
// happened to land. So every animationstart is heard too, on the
// document in the capture phase (it fires for a pseudo-element's
// animation as well, the pane's ::before ring and wash and the band's
// ::after included), and
// one that starts a pulse runs the sync in a microtask, so a burst of
// starts in one frame costs one pass.
function onPulseStart(ev: AnimationEvent): void {
  if (!isPulse(ev.animationName)) return;
  queueSync();
}
let syncQueued = false;

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    syncPulses();
  });
}

// The pass syncs the sheet's pulses by name (pulse-sync-model.ts) and
// leaves every other animation on its own clock: the sheet's one-shots
// (the focus flash, the row's stalled flash, the graph's fresh node, a
// figure's roll, each over before it was seen on time zero), its two
// endless non-pulses, and Monaco's and xterm's own, which the whole
// document reaches. document.getAnimations() includes the pseudo-elements
// (the pane's ::before ring and wash, the row's ::after band).
function syncPulses(): void {
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSAnimation) || !isPulse(animation.animationName)) continue;
    if (animation.startTime !== 0) animation.startTime = 0;
  }
}

// The session a mousedown lands on: a pane's (a view pane or an empty one
// has none) or a sidebar row's. The row's own buttons (Resume, the menu)
// sit inside the row and count as the row, which is what a click on them
// is looking at.
function pressedSessionId(ev: Event): string | null {
  if (!(ev.target instanceof Element)) return null;
  const pane = ev.target.closest('[data-pane-id]');
  if (pane instanceof HTMLElement && pane.dataset['paneId'] !== undefined) {
    const tab = shownTab();
    return tab === null ? null : (findPane(tab, pane.dataset['paneId'])?.sessionId ?? null);
  }
  const row = ev.target.closest('.sidebar-row[data-session-id]');
  return row instanceof HTMLElement ? (row.dataset['sessionId'] ?? null) : null;
}

// M9 fix 701: which pane a real press or key landed in. A key that is not
// look-first lands in the shown tab's focused pane; a press in the pane it
// is inside. Anything else (a look-first key, a press outside every pane)
// leaves the record alone.
function notePaneInput(ev: Event, at: number): void {
  let paneId: string | null = null;
  if (ev instanceof KeyboardEvent) {
    if (!isLookFirstKey(ev)) paneId = shownTab()?.focusedPaneId ?? null;
  } else if (ev.target instanceof Element) {
    const pane = ev.target.closest('[data-pane-id]');
    if (pane instanceof HTMLElement) paneId = pane.dataset['paneId'] ?? null;
  }
  if (paneId !== null) lastPaneInput = { paneId, at };
}

// M9 fix 701: the session the person is answering right now, or null when
// the panes are not in front.
function answeringNow(): string | null {
  if (getUiState().tabs.active !== PANES) return null;
  const tab = shownTab();
  if (tab === null) return null;
  const focused = { paneId: tab.focusedPaneId, sessionId: findPane(tab, tab.focusedPaneId)?.sessionId ?? null };
  return answeringSession(focused, lastPaneInput, Date.now());
}

// The session a keydown is for: the focused pane's, if it shows one.
function focusedSessionId(): string | null {
  const tab = shownTab();
  return tab === null ? null : (findPane(tab, tab.focusedPaneId)?.sessionId ?? null);
}

// The badge text, and for a finished turn the first line of the reply, so
// the toast says what came back without opening the window.
function notificationBody(session: SessionInfo): string {
  const text = describeState(session).text;
  if (session.state !== 'done' || session.lastReply === null) return text;
  const line = session.lastReply.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';
  return line === '' ? text : `${text}: ${line}`;
}
