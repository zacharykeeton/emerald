import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityRequest, ActivitySession } from '@emerald/shared';
import { CROSS_CARD_GAP, NOTHING_HERE, crossCard, crossCardSize, crossLane, readoutHasRoom, trackAt } from './activity-cross-model.ts';
import { effortWords, spanTitle } from './activity-titles.ts';
import { anActivitySession } from './test-support.ts';

const box = { width: 600, height: 400 };
const card = { width: 100, height: 40 };

test('the card sits right of the line and under the pointer, left within the last fifth', () => {
  assert.deepEqual(crossCard(100, 50, box, card), { side: 'right', left: 100 + CROSS_CARD_GAP, right: null, top: 50 + CROSS_CARD_GAP, flip: 'down' });
  // On the left it is placed by its right edge, so the edge at the line
  // is exact whatever the estimate made of the width.
  assert.deepEqual(crossCard(480, 50, box, card), { side: 'left', left: null, right: box.width - (480 - CROSS_CARD_GAP), top: 50 + CROSS_CARD_GAP, flip: 'down' });
  // Short of the fifth but the card would run past the edge: left too.
  assert.equal(crossCard(460, 50, box, { width: 140, height: 40 })!.side, 'left');
  assert.equal(crossCard(479, 50, box, card)!.side, 'right');
});

test('the card is clamped inside the box at every edge, and flips above the pointer in the last rows (M9 fix 262)', () => {
  // Past the foot: the card flips above the pointer, its bottom at the
  // gap over it.
  assert.deepEqual(crossCard(100, 390, box, card), { side: 'right', left: 106, right: null, top: 390 - CROSS_CARD_GAP - card.height, flip: 'up' });
  // Above the tracks (the pointer over the band): never above the box.
  assert.equal(crossCard(100, -30, box, card)!.top, 0);
  assert.equal(crossCard(100, -30, box, card)!.flip, 'down');
  // Fits on neither side: the left edge.
  assert.deepEqual(crossCard(590, 50, box, { width: 700, height: 40 }), { side: 'left', left: 0, right: null, top: 56, flip: 'down' });
  assert.equal(crossCard(2, 50, box, { width: 700, height: 40 })!.left, 0);
});

test('the card keeps above the tick row: the floor, not the box, bounds it (M9 fix 262)', () => {
  // Tracks 4 rows of 18 under a 12px tick row: a pointer on the third
  // row gets the card above it; on the first row, under it while it fits.
  const strip = { width: 600, height: 4 * 18 + 12, floor: 4 * 18 };
  const two = { width: 100, height: 32 };
  assert.deepEqual(crossCard(100, 6, strip, two), { side: 'right', left: 106, right: null, top: 12, flip: 'down' });
  const third = crossCard(100, 2 * 18 + 6, strip, two)!;
  assert.equal(third.flip, 'up');
  assert.equal(third.top + two.height, 2 * 18 + 6 - CROSS_CARD_GAP, 'its bottom at the gap over the pointer');
  // On the tick row itself: still above the floor, the bottom never on
  // the ticks.
  const ticks = crossCard(100, strip.height - 3, strip, two)!;
  assert.equal(ticks.flip, 'up');
  assert.ok(ticks.top + two.height <= strip.floor);
  // A pointer on the second row where neither side fits a tall card:
  // clamped to the floor.
  const tall = { width: 100, height: 60 };
  const mid = crossCard(100, 18 + 6, strip, tall)!;
  assert.equal(mid.top, strip.floor - tall.height);
  // Tracks shorter than the card: no card.
  assert.equal(crossCard(100, 6, { width: 600, height: 18 + 12, floor: 18 }, two), null);
  assert.equal(crossCard(100, 6, { width: 600, height: 44, floor: 32 }, two)!.top, 0, 'exactly the card is room');
});

test('the axis readout takes the lane as a third piece only where it fits inside the box (M9 fix 262)', () => {
  const text = '11:48 · 1 running';
  const lane = 'alpha · 11:00 to 12:00 · hello';
  // 50 characters at 5.6 plus the padding, about 286 wide: room in the
  // middle of 600, none near either edge.
  assert.ok(readoutHasRoom(300, 600, text, lane));
  assert.ok(!readoutHasRoom(100, 600, text, lane));
  assert.ok(!readoutHasRoom(500, 600, text, lane));
  assert.ok(!readoutHasRoom(140, 280, text, lane), 'a narrow strip has no room at all');
});

test('the size comes off the longest line and the line count', () => {
  const one = crossCardSize(['11:48 · 2 running']);
  const three = crossCardSize(['11:48 · 2 running', 'a 4m', 'a · 11:00 to 12:00 · hello']);
  assert.ok(three.width > one.width && three.height > one.height);
  assert.equal(three.height - one.height, 24);
  assert.equal(one.height, 12 + 2 * 2 + 2, 'the height is the rendered box: the line, 2px of padding each side, the edge');
});

test('the track under a y, and none over the band or the tick row', () => {
  assert.equal(trackAt(-3, 4, 22), null);
  assert.equal(trackAt(0, 4, 22), 0);
  assert.equal(trackAt(21.9, 4, 22), 0);
  assert.equal(trackAt(22, 4, 22), 1);
  assert.equal(trackAt(87.9, 4, 22), 3);
  assert.equal(trackAt(88, 4, 22), null);
  assert.equal(trackAt(5, 0, 22), null);
});

function session(id: string, spans: Array<[number, number, string | null]>, extra: Partial<ActivitySession> = {}): ActivitySession {
  return anActivitySession({ sessionId: id, name: id, spans: spans.map(([f, t, prompt]) => ({ from: f, to: t, prompt })), ...extra });
}

const at = (h: number, m: number) => new Date(2026, 8, 13, h, m).getTime();

test('the lane line names the session working at the instant with its span and the first words of its prompt', () => {
  const s = session('alpha', [[at(14, 2), at(14, 40), 'fix the thing that broke on the way to the build and more']]);
  const line = crossLane([s], at(14, 10), new Map());
  assert.deepEqual(line, { text: 'alpha · 14:02 to 14:40 · fix the thing that broke on…', sessionId: 'alpha' });
  // A short prompt is whole; no prompt, no third clause.
  assert.equal(crossLane([session('b', [[at(1, 0), at(2, 0), 'hi there']])], at(1, 30), new Map()).text, 'b · 01:00 to 02:00 · hi there');
  assert.equal(crossLane([session('c', [[at(1, 0), at(2, 0), null]])], at(1, 30), new Map()).text, 'c · 01:00 to 02:00');
});

test('an agent reads as a subagent of its parent, a waiting stretch by its kind, and an idle track or none as nothing here', () => {
  const agent = session('worker', [[at(9, 0), at(9, 30), null]], { kind: 'agent', agentId: 'ag1', agentType: 'Explore', parentId: 'alpha' });
  const names = new Map([['worker', 'alpha']]);
  assert.equal(crossLane([agent], at(9, 10), names).text, 'worker (Explore) · 09:00 to 09:30 · a subagent of alpha');
  const asked = session('q', [[at(9, 0), at(9, 30), null]], { debt: [{ from: at(9, 30), to: at(10, 0), kind: 'asked' }] });
  assert.equal(crossLane([asked], at(9, 45), new Map()).text, 'q · asked, waiting on you · 09:30 to 10:00');
  assert.deepEqual(crossLane([asked], at(11, 0), new Map()), { text: NOTHING_HERE, sessionId: null });
  assert.deepEqual(crossLane(null, at(11, 0), new Map()), { text: NOTHING_HERE, sessionId: null });
  // A packed track: the session at the instant wins, whichever it is.
  const later = session('later', [[at(12, 0), at(13, 0), 'p']]);
  assert.equal(crossLane([asked, later], at(12, 30), new Map()).sessionId, 'later');
});

test("the span's hover names the model and effort its points ran at, each pair once (M9 fix 852)", () => {
  const req = (t: number, model: string | null, effort?: string | null): ActivityRequest => ({ at: t, fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: null, model, ...(effort === undefined ? {} : { effort }) });
  const span = { from: at(14, 2), prompt: null };
  const title = (requests: ActivityRequest[], extra: Partial<ActivitySession> = {}) => spanTitle(session('alpha', [[at(14, 2), at(14, 40), null]], { requests, ...extra }), span, at(14, 40));
  const high = [req(at(14, 5), 'Opus 5.5', 'high'), req(at(14, 10), 'Opus 5.5', 'high')];
  assert.equal(title(high), 'alpha · 14:02 to 14:40 · Opus 5.5 · high');
  assert.equal(crossLane([session('alpha', [[at(14, 2), at(14, 40), null]], { requests: high })], at(14, 10), new Map()).text, 'alpha · 14:02 to 14:40 · Opus 5.5 · high');
  assert.equal(title([req(at(14, 5), 'Opus 5.5', 'high'), req(at(14, 10), 'Opus 5.5', 'medium'), req(at(14, 15), 'Opus 5.5', 'high')]), 'alpha · 14:02 to 14:40 · Opus 5.5 · high, then medium');
  assert.equal(title([req(at(14, 5), 'Opus 5.5', 'high'), req(at(14, 20), 'Fable 2 (1M context)', 'medium')]), 'alpha · 14:02 to 14:40 · Opus 5.5 · high, then Fable 2 · medium');
  // No effort on a point, or a point outside the span, reads as before.
  assert.equal(title([req(at(14, 5), 'Opus 5.5', null), req(at(14, 10), 'Opus 5.5')]), 'alpha · 14:02 to 14:40');
  assert.equal(title([req(at(13, 0), 'Opus 5.5', 'high'), req(at(15, 0), 'Opus 5.5', 'high')]), 'alpha · 14:02 to 14:40');
  assert.equal(effortWords({ requests: [] }, at(14, 2), at(14, 40)), null);
  // An agent row reads as today.
  assert.equal(title(high, { kind: 'agent', agentId: 'ag1', agentType: 'Explore' }), 'alpha (Explore) · 14:02 to 14:40\na subagent');
});
