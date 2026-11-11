import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout, LayoutNode } from '@emerald/shared';
import { WEBGL_LIVE_MARK, WebglBudget, paneInFront, webglNote } from './webgl-budget.ts';
import type { WebglMember } from './webgl-budget.ts';

interface Fake extends WebglMember {
  state: { live: boolean; released: boolean };
  releases: number;
  takes: number;
}

function fake(): Fake {
  const f: Fake = {
    state: { live: false, released: false },
    releases: 0,
    takes: 0,
    live: () => f.state.live,
    released: () => f.state.released,
    release: () => {
      f.releases++;
      f.state = { live: false, released: true };
    },
    take: () => {
      f.takes++;
      f.state = { live: true, released: false };
    },
  };
  return f;
}

// A budget whose settles wait for flush(), as the window's wait for the
// microtask after a commit, so one tab switch writes one line.
function rig() {
  const queue: (() => void)[] = [];
  const lines: string[] = [];
  const budget = new WebglBudget({ schedule: (fn) => queue.push(fn), say: (l) => lines.push(l) });
  const flush = () => {
    while (queue.length > 0) queue.shift()!();
  };
  // The caller's side of a join, as Pane.tsx's openTerminal does it.
  const join = (m: Fake, shown: boolean) => {
    if (budget.join(m, shown)) m.state = { live: true, released: false };
    else m.release();
  };
  return { budget, lines, flush, join };
}

function tabsOf(n: number, size: number): Fake[][] {
  return Array.from({ length: n }, () => Array.from({ length: size }, fake));
}

const live = (ms: Fake[]) => ms.filter((m) => m.live()).length;

test('twelve panes or fewer never give a context up, whatever is shown (M9 fix 1130)', () => {
  const { budget, lines, flush, join } = rig();
  const tabs = tabsOf(3, 4);
  tabs[0]!.forEach((m) => join(m, true));
  tabs[1]!.forEach((m) => join(m, false));
  tabs[2]!.forEach((m) => join(m, false));
  flush();
  for (const k of [1, 2, 0, 2]) {
    tabs.forEach((t, i) => t.forEach((m) => budget.show(m, i === k)));
    flush();
  }
  const all = tabs.flat();
  assert.equal(all.reduce((n, m) => n + m.releases + m.takes, 0), 0);
  assert.equal(live(all), 12);
  assert.deepEqual(lines, []);
});

test('twenty on five tabs keep twelve live, the least recently shown giving way first', () => {
  const { budget, lines, flush, join } = rig();
  const tabs = tabsOf(5, 4);
  tabs[0]!.forEach((m) => join(m, true));
  for (const t of tabs.slice(1)) t.forEach((m) => join(m, false));
  flush();
  // The first eight hidden load; the last eight start released.
  assert.deepEqual(tabs.map(live), [4, 4, 4, 0, 0]);
  assert.ok([...tabs[3]!, ...tabs[4]!].every((m) => m.released()));
  assert.deepEqual(lines, [webglNote(8, 0, 12)]);

  const showTab = (k: number) => {
    tabs.forEach((t, i) => t.forEach((m) => budget.show(m, i === k)));
    flush();
  };
  // Tab 4 to the front: the never-shown hidden tab of the lowest join order
  // (tab 2) gives way before tab 1, which was shown.
  showTab(3);
  assert.deepEqual(tabs.map(live), [4, 0, 4, 4, 0]);
  assert.equal(lines.at(-1), webglNote(4, 4, 12));
  // Tab 2 back: tab 3, never shown, gives way.
  showTab(1);
  assert.deepEqual(tabs.map(live), [4, 4, 0, 4, 0]);
  // Tab 5: tab 1, shown longest ago, gives way.
  showTab(4);
  assert.deepEqual(tabs.map(live), [0, 4, 0, 4, 4]);
  // Tab 3: tab 4 gives way and tab 2, shown after it, is kept.
  showTab(2);
  assert.deepEqual(tabs.map(live), [0, 4, 4, 0, 4]);
  assert.equal(live(tabs.flat()), WEBGL_LIVE_MARK);
  assert.equal(lines.length, 5);
});

test('a shown member is never released, a tab of fourteen keeping all fourteen', () => {
  const { lines, flush, join } = rig();
  const shown = Array.from({ length: 14 }, fake);
  const hidden = Array.from({ length: 2 }, fake);
  hidden.forEach((m) => join(m, false));
  shown.forEach((m) => join(m, true));
  flush();
  assert.equal(live(shown), 14);
  assert.ok(shown.every((m) => m.releases === 0));
  assert.equal(live(hidden), 0);
  assert.deepEqual(lines, [webglNote(2, 0, 14)]);
});

test('a hidden join past the mark does not load, a shown join makes room first', () => {
  const { budget, flush, join } = rig();
  const hidden = Array.from({ length: 12 }, fake);
  hidden.forEach((m) => join(m, false));
  flush();
  assert.equal(live(hidden), 12);
  const late = fake();
  assert.equal(budget.join(late, false), false);
  const front = fake();
  assert.equal(budget.join(front, true), true);
  front.state = { live: true, released: false };
  assert.equal(live(hidden), 11);
  assert.equal(hidden[0]!.releases, 1);
  assert.equal(budget.liveCount(), 12);
});

test('a member that left is not counted', () => {
  const { budget, flush, join } = rig();
  const ms = Array.from({ length: 12 }, fake);
  ms.forEach((m) => join(m, false));
  flush();
  budget.leave(ms[0]!);
  assert.equal(budget.liveCount(), 11);
  assert.equal(budget.join(fake(), false), true);
});

test('roomFor answers true for a shown member and false for a hidden one at the mark', () => {
  const { budget, flush, join } = rig();
  const ms = Array.from({ length: 12 }, fake);
  ms.forEach((m) => join(m, false));
  const front = fake();
  join(front, true);
  flush();
  assert.equal(budget.roomFor(front), true);
  assert.equal(budget.roomFor(ms.find((m) => m.live())!), false);
});

test('paneInFront: a pane on the current tab is in front, on another tab or under a file tab it is not, and a zoom is not an input', () => {
  const pane = (id: string): LayoutNode => ({ kind: 'pane', id, sessionId: null }) as unknown as LayoutNode;
  const layout = {
    tabs: [
      { id: 't1', name: 'one', root: pane('a'), focusedPaneId: 'a' },
      { id: 't2', name: 'two', root: pane('b'), focusedPaneId: 'b' },
    ],
    currentTabId: 't1',
    revision: 1,
  } as Layout;
  assert.equal(paneInFront(layout, 'a', false), true);
  assert.equal(paneInFront(layout, 'b', false), false);
  assert.equal(paneInFront(layout, 'a', true), false);
  assert.equal(paneInFront(null, 'a', false), false);
});
