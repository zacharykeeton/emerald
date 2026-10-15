import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTENTION_STATES, RECENT_INPUT_MS, acknowledge, answeringSession, attentionState, canMarkUnread, chiming, emptyAttention, hushAll, isAttentionSound, isRecentInput, markUnread, nextSound, observe, setHushed, waitOverlay, waitingOrder } from './attention-model.ts';
import type { AttentionModel } from './attention-model.ts';
import type { SessionState } from '@emerald/shared';

const at = (pairs: Record<string, SessionState>) => Object.entries(pairs).map(([id, state]) => ({ id, state }));
const ids = (m: AttentionModel) => [...m.wanting].sort();

test('a change into needs-input, done or errored is an arrival; the first sighting is not', () => {
  let { model, arrived } = observe(emptyAttention(), at({ a: 'done', b: 'idle', c: 'working' }));
  assert.deepEqual(arrived, []);
  assert.deepEqual(ids(model), []);
  ({ model, arrived } = observe(model, at({ a: 'done', b: 'needs-input', c: 'errored' })));
  assert.deepEqual(arrived, ['b', 'c']);
  assert.deepEqual(ids(model), ['b', 'c']);
  ({ model, arrived } = observe(model, at({ a: 'working', b: 'needs-input', c: 'errored' })));
  assert.deepEqual(arrived, []);
  ({ model, arrived } = observe(model, at({ a: 'done', b: 'needs-input', c: 'errored' })));
  assert.deepEqual(arrived, ['a']);
  assert.deepEqual(ids(model), ['a', 'b', 'c']);
});

test('leaving the three states drops the session; so does leaving the list', () => {
  let { model } = observe(emptyAttention(), at({ a: 'working', b: 'working' }));
  ({ model } = observe(model, at({ a: 'done', b: 'needs-input' })));
  assert.deepEqual(ids(model), ['a', 'b']);
  ({ model } = observe(model, at({ a: 'idle', b: 'needs-input' })));
  assert.deepEqual(ids(model), ['b']);
  ({ model } = observe(model, at({})));
  assert.deepEqual(ids(model), []);
  assert.equal(model.seen.size, 0);
});

// M9 fix 41: a session still pulsing for done that then asks a question
// arrives again, so the chime plays for the question; the set holds it
// once either way.
test('a session that moves between the three states arrives again and stays in the set once', () => {
  let { model, arrived } = observe(emptyAttention(), at({ a: 'working' }));
  ({ model, arrived } = observe(model, at({ a: 'done' })));
  assert.deepEqual(arrived, ['a']);
  ({ model, arrived } = observe(model, at({ a: 'needs-input' })));
  assert.deepEqual(arrived, ['a']);
  assert.deepEqual(ids(model), ['a']);
  ({ model, arrived } = observe(model, at({ a: 'errored' })));
  assert.deepEqual(arrived, ['a']);
  assert.deepEqual(ids(model), ['a']);
});

test('the same needs-input seen twice is one arrival', () => {
  let { model, arrived } = observe(emptyAttention(), at({ a: 'working' }));
  ({ model, arrived } = observe(model, at({ a: 'needs-input' })));
  assert.deepEqual(arrived, ['a']);
  const before = model;
  ({ model, arrived } = observe(model, at({ a: 'needs-input' })));
  assert.deepEqual(arrived, []);
  assert.equal(model, before);
});

test('acknowledge drops the one session and keeps what was seen, so nothing re-arrives', () => {
  let { model, arrived } = observe(emptyAttention(), at({ a: 'working' }));
  ({ model } = observe(model, at({ a: 'done' })));
  const acked = acknowledge(model, 'a');
  assert.deepEqual(ids(acked), []);
  assert.equal(acked.seen.get('a'), 'done');
  ({ model, arrived } = observe(acked, at({ a: 'done' })));
  assert.equal(model, acked);
  assert.deepEqual(arrived, []);
  ({ model, arrived } = observe(model, at({ a: 'working' })));
  ({ model, arrived } = observe(model, at({ a: 'done' })));
  assert.deepEqual(arrived, ['a']);
  assert.equal(acknowledge(emptyAttention(), 'a').wanting.size, 0);
  assert.equal(acknowledge(acked, 'a'), acked, 'acking a session that is not wanting changes nothing');
});

// M9 fix 189: the acknowledge is per session, and hushes the rest.
test('acknowledging one session leaves the others pulsing with their chimes hushed', () => {
  let { model } = observe(emptyAttention(), at({ a: 'working', b: 'working', c: 'working' }));
  ({ model } = observe(model, at({ a: 'done', b: 'needs-input', c: 'done' })));
  assert.deepEqual(ids(model), ['a', 'b', 'c']);
  assert.equal(chiming(model), true);
  const acked = acknowledge(model, 'a');
  assert.deepEqual(ids(acked), ['b', 'c']);
  assert.deepEqual([...acked.hushed].sort(), ['b', 'c']);
  assert.equal(chiming(acked), false, 'hushed all round: no repeat');
  // A fresh arrival is never hushed, so the repeat runs for it.
  let next = observe(acked, at({ a: 'working', b: 'needs-input', c: 'done' }));
  next = observe(next.model, at({ a: 'done', b: 'needs-input', c: 'done' }));
  assert.deepEqual(next.arrived, ['a']);
  assert.deepEqual([...next.model.hushed].sort(), ['b', 'c']);
  assert.equal(chiming(next.model), true);
  // A change of state on a hushed session is news: its hush is over.
  const changed = observe(next.model, at({ a: 'done', b: 'done', c: 'done' })).model;
  assert.deepEqual([...changed.hushed], ['c']);
  // A hushed session that leaves the set leaves the hushed set with it.
  const left = observe(changed, at({ a: 'done', b: 'done', c: 'idle' })).model;
  assert.deepEqual(ids(left), ['a', 'b']);
  assert.deepEqual([...left.hushed], []);
  // And one gone from the list.
  const gone = observe(acknowledge(left, 'a'), at({ a: 'done' })).model;
  assert.deepEqual(ids(gone), []);
  assert.deepEqual([...gone.hushed], []);
});

test('hushAll stops every chime and no pulse; setHushed does one; a new arrival unhushes itself', () => {
  let { model } = observe(emptyAttention(), at({ a: 'working', b: 'working' }));
  ({ model } = observe(model, at({ a: 'done', b: 'done' })));
  const hushed = hushAll(model);
  assert.deepEqual(ids(hushed), ['a', 'b']);
  assert.equal(chiming(hushed), false);
  assert.equal(hushAll(hushed), hushed, 'nothing to hush twice');
  const one = setHushed(model, 'a', true);
  assert.deepEqual([...one.hushed], ['a']);
  assert.equal(chiming(one), true, 'b still chimes');
  assert.equal(setHushed(one, 'a', true), one);
  assert.equal(setHushed(one, 'zz', true), one, 'only a wanting session can be hushed');
  assert.deepEqual([...setHushed(one, 'a', false).hushed], []);
  // Mark unread on a hushed session clears its hush.
  assert.deepEqual([...markUnread(one, 'a').hushed], []);
  assert.deepEqual(ids(markUnread(one, 'a')), ['a', 'b']);
});

test('observe returns the same model when nothing changed', () => {
  const { model } = observe(emptyAttention(), at({ a: 'idle' }));
  const again = observe(model, at({ a: 'idle' }));
  assert.equal(again.model, model);
  assert.deepEqual(again.arrived, []);
});

test('mark unread puts a session back without an arrival, and it stays until its state changes', () => {
  let { model, arrived } = observe(emptyAttention(), at({ a: 'working', b: 'idle' }));
  ({ model } = observe(model, at({ a: 'done', b: 'idle' })));
  const acked = acknowledge(model, 'a');
  const marked = markUnread(acked, 'a');
  assert.deepEqual(ids(marked), ['a']);
  assert.equal(markUnread(marked, 'a'), marked);
  // The next push with the same states is not an arrival and keeps the mark.
  ({ model, arrived } = observe(marked, at({ a: 'done', b: 'idle' })));
  assert.deepEqual(arrived, []);
  assert.deepEqual(ids(model), ['a']);
  // An idle session marked unread stays through pushes and goes when its state changes.
  ({ model } = observe(markUnread(model, 'b'), at({ a: 'done', b: 'idle' })));
  assert.deepEqual(ids(model), ['a', 'b']);
  ({ model } = observe(model, at({ a: 'done', b: 'working' })));
  assert.deepEqual(ids(model), ['a']);
  assert.equal(canMarkUnread('done'), true);
  assert.equal(canMarkUnread('idle'), true);
  assert.equal(canMarkUnread('exited'), true);
  assert.equal(canMarkUnread('working'), false);
  assert.equal(canMarkUnread('starting'), false);
});

test('the sound setting cycles repeat, once, off and is validated', () => {
  assert.equal(nextSound('repeat'), 'once');
  assert.equal(nextSound('once'), 'off');
  assert.equal(nextSound('off'), 'repeat');
  assert.equal(isAttentionSound('once'), true);
  assert.equal(isAttentionSound('loud'), false);
  assert.equal(isAttentionSound(3), false);
});

test('recent input: within ten seconds of the last key or click, and never with none', () => {
  assert.equal(isRecentInput(null, 50_000), false);
  assert.equal(isRecentInput(40_000, 50_000), true);
  assert.equal(isRecentInput(50_000 - RECENT_INPUT_MS, 50_000), true);
  assert.equal(isRecentInput(50_000 - RECENT_INPUT_MS - 1, 50_000), false);
});

// M9 fix 201: the order the jump key walks and the picker opens in.
test('waitingOrder puts questions before replies before errors, the longest wait first, and only the wanting', () => {
  const sessions = [
    { id: 'reply-new', state: 'done' as SessionState, stateSince: 500 },
    { id: 'error', state: 'errored' as SessionState, stateSince: 100 },
    { id: 'question-new', state: 'needs-input' as SessionState, stateSince: 400 },
    { id: 'question-old', state: 'needs-input' as SessionState, stateSince: 200 },
    { id: 'reply-old', state: 'done' as SessionState, stateSince: 300 },
    { id: 'seen', state: 'needs-input' as SessionState, stateSince: 50 },
    { id: 'busy', state: 'working' as SessionState, stateSince: 10 },
  ];
  const wanting = new Set(['reply-new', 'error', 'question-new', 'question-old', 'reply-old', 'busy']);
  assert.deepEqual(
    waitingOrder(sessions, wanting).map((s) => s.id),
    ['question-old', 'question-new', 'reply-old', 'reply-new', 'error'],
  );
  assert.deepEqual(waitingOrder(sessions, new Set()), []);
});

// M9 fix 232: a stall is the fourth arrival. The daemon's stale flag on a
// working session reads as the quiet state here, pulsing and chiming
// like a question; the next hook clears the flag and the pulse with it.
test('a working session going stale arrives as quiet, is hushable, and the hook that clears the flag drops it', () => {
  const stale = (id: string, stale: boolean) => ({ id, state: 'working' as SessionState, stale });
  let { model, arrived } = observe(emptyAttention(), [stale('a', true), stale('b', false)]);
  assert.deepEqual(arrived, [], 'the first sighting is not an arrival, stale or not');
  assert.equal(attentionState(stale('a', true)), 'quiet');
  assert.equal(attentionState(stale('a', false)), 'working');
  assert.equal(attentionState({ state: 'needs-input', stale: true }), 'needs-input', 'only a working session can be quiet');
  ({ model, arrived } = observe(model, [stale('a', true), stale('b', true)]));
  assert.deepEqual(arrived, ['b']);
  assert.deepEqual(ids(model), ['b']);
  assert.equal(model.seen.get('b'), 'quiet');
  ({ model, arrived } = observe(model, [stale('a', true), stale('b', true)]));
  assert.deepEqual(arrived, [], 'still quiet is not news');
  model = setHushed(model, 'b', true);
  assert.equal(chiming(model), false);
  // The next hook clears the flag: back to plain working, out of the set.
  ({ model, arrived } = observe(model, [stale('a', true), stale('b', false)]));
  assert.deepEqual(ids(model), []);
  assert.equal(model.hushed.size, 0);
  // A quiet session that then asks is a change of state: it arrives again.
  ({ model, arrived } = observe(model, [stale('a', true), { id: 'b', state: 'working' as SessionState, stale: true }]));
  assert.deepEqual(arrived, ['b']);
  ({ model, arrived } = observe(model, [stale('a', true), { id: 'b', state: 'needs-input' as SessionState, stale: false }]));
  assert.deepEqual(arrived, ['b']);
  assert.deepEqual(ids(model), ['b']);
  assert.ok(ATTENTION_STATES.has('quiet'));
  // The jump order puts a stall after the errors: nothing is asking.
  const order = waitingOrder([{ id: 'q', state: 'working' as SessionState, stale: true, stateSince: 0 }, { id: 'd', state: 'done' as SessionState, stateSince: 5 }], new Set(['q', 'd']));
  assert.deepEqual(order.map((s) => s.id), ['d', 'q']);
});

test('M9 fix 247: the overlay words a question and a finished reply with the age, and nothing else', () => {
  const since = 1_000_000;
  assert.deepEqual(waitOverlay('needs-input', since, since + 5_400), { word: 'waiting', figure: '5s' });
  assert.deepEqual(waitOverlay('needs-input', since, since + 12_000), { word: 'waiting', figure: '12s' });
  assert.deepEqual(waitOverlay('done', since, since + 40_000), { word: 'done', figure: '40s' });
  assert.deepEqual(waitOverlay('done', since, since + 90_000), { word: 'done', figure: '1m' });
  assert.deepEqual(waitOverlay('needs-input', since, since - 500), { word: 'waiting', figure: '0s' }, 'a clock behind the state reads zero, never negative');
  assert.equal(waitOverlay('quiet', since, since + 5_000), null, 'quiet carries its own word');
  assert.equal(waitOverlay('errored', since, since + 5_000), null, 'errored has its age on the row');
  assert.equal(waitOverlay('working', since, since + 5_000), null);
  assert.equal(waitOverlay(undefined, since, since + 5_000), null, 'no pulse, no overlay');
});

// M9 fix 701: a question into the pane the person is typing in is settled
// as it arrives, with no chime, flash, toast or pulse.
test('an arrival on the session being answered is settled, not arrived and not wanting', () => {
  let { model } = observe(emptyAttention(), at({ a: 'working', b: 'working' }));
  const first = observe(model, at({ a: 'needs-input', b: 'done' }), 'a');
  assert.deepEqual(first.settled, ['a']);
  assert.deepEqual(first.arrived, ['b']);
  assert.deepEqual(ids(first.model), ['b']);
  assert.equal(first.model.hushed.has('b'), false, 'the other arrival chimes as ever');
  // A session already wanting for done that asks a question while answered
  // leaves the set and its hush with it.
  model = hushAll(first.model);
  assert.equal(model.hushed.has('b'), true);
  const second = observe(model, at({ a: 'needs-input', b: 'needs-input' }), 'b');
  assert.deepEqual(second.settled, ['b']);
  assert.deepEqual(second.arrived, []);
  assert.deepEqual(ids(second.model), []);
  assert.equal(second.model.hushed.size, 0);
  // Answering a session whose state did not change settles nothing.
  const third = observe(second.model, at({ a: 'needs-input', b: 'needs-input' }), 'a');
  assert.deepEqual(third.settled, []);
  assert.equal(third.model, second.model);
});

test('answeringSession names the focused pane session within the ten seconds of a press in that pane', () => {
  const now = 1_000_000;
  const focused = { paneId: 'p1', sessionId: 's1' };
  assert.equal(answeringSession(focused, { paneId: 'p1', at: now - 9_000 }, now), 's1');
  assert.equal(answeringSession(focused, { paneId: 'p1', at: now - RECENT_INPUT_MS }, now), 's1', 'the edge is inclusive');
  assert.equal(answeringSession(focused, { paneId: 'p1', at: now - RECENT_INPUT_MS - 1 }, now), null);
  assert.equal(answeringSession(focused, { paneId: 'p2', at: now - 1_000 }, now), null, 'a press into another pane does not count');
  assert.equal(answeringSession({ paneId: 'p1', sessionId: null }, { paneId: 'p1', at: now - 1_000 }, now), null, 'an empty pane names nothing');
  assert.equal(answeringSession(null, { paneId: 'p1', at: now - 1_000 }, now), null);
  assert.equal(answeringSession(focused, null, now), null);
});
