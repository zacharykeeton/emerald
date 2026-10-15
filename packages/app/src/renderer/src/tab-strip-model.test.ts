import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutNode, LayoutTab, SessionInfo, SessionState, TeamMember } from '@emerald/shared';
import { pageTarget, stripCut, tabMark, tabWanting, wheelStep } from './tab-strip-model.ts';
import { aSession } from './test-support.ts';

function session(id: string, state: SessionState, stale = false, team: TeamMember[] = []): SessionInfo {
  return aSession({ id, kind: 'claude', name: id, state, stale, team });
}

function agentMember(outcome: 'running' | 'returned'): TeamMember {
  return {
    id: 'a1',
    kind: 'agent',
    type: 'general-purpose',
    description: null,
    command: null,
    startedAt: 0,
    endedAt: outcome === 'returned' ? 1 : null,
    outcome,
    cwd: null,
    branch: null,
    commits: [],
    activity: null,
  };
}

function tab(...sessionIds: (string | null)[]): LayoutTab {
  const panes = sessionIds.map((sessionId, i) => ({ kind: 'pane' as const, id: `p${i}`, sessionId, view: null }));
  // 'horizontal' was never a SplitDirection ('row' | 'column'); tabMark
  // never reads the field, so the fixture had gone unchecked until fix 405.
  const root: LayoutNode = panes.length === 1 ? panes[0]! : { kind: 'split', id: 's', direction: 'row', ratio: 0.5, first: panes[0]!, second: panes[1]! };
  return { id: 't', name: 'Panes 2', root, focusedPaneId: 'p0' };
}

const sessions = new Map<string, SessionInfo>([
  ['idle', session('idle', 'idle')],
  ['gone', session('gone', 'exited')],
  ['busy', session('busy', 'working')],
]);

test('tabMark: a tab whose panes hold no session wears no mark (fix 220)', () => {
  assert.equal(tabMark(tab(null), sessions, undefined, new Set()), null, 'one empty pane');
  assert.equal(tabMark(tab(null, null), sessions, undefined, new Set()), null, 'two empty panes');
  assert.equal(tabMark(tab('unknown'), sessions, undefined, new Set()), null, 'a pane naming a session the store no longer has');
});

test('tabMark: one idle session is the idle grey, an exited one too', () => {
  assert.deepEqual(tabMark(tab('idle'), sessions, undefined, new Set()), { kind: 'claude', tone: 'idle', working: false });
  assert.deepEqual(tabMark(tab('gone'), sessions, undefined, new Set()), { kind: 'claude', tone: 'idle', working: false }, 'an exited session is still a session');
  assert.deepEqual(tabMark(tab(null, 'idle'), sessions, undefined, new Set()), { kind: 'claude', tone: 'idle', working: false }, 'an empty pane beside an idle one');
});

test('tabMark: a working session steps in the working colour, and a wanting state wins over all', () => {
  assert.deepEqual(tabMark(tab('idle', 'busy'), sessions, undefined, new Set()), { kind: 'claude', tone: 'working', working: true });
  assert.deepEqual(tabMark(tab(null), sessions, 'needs-input', new Set()), { kind: 'claude', tone: 'needs-input', working: false }, 'the wanting tone even with no session in a pane');
});

test('tabMark: an agent out on an idle session steps the mark in the idle tone (fix 362)', () => {
  const out = new Map<string, SessionInfo>([['idle', session('idle', 'idle', false, [agentMember('running')])]]);
  assert.deepEqual(tabMark(tab('idle'), out, undefined, new Set()), { kind: 'claude', tone: 'idle', working: true });
});

test('tabMark: a returned agent leaves the mark still (fix 362)', () => {
  const back = new Map<string, SessionInfo>([['idle', session('idle', 'idle', false, [agentMember('returned')])]]);
  assert.deepEqual(tabMark(tab('idle'), back, undefined, new Set()), { kind: 'claude', tone: 'idle', working: false });
});

function shell(id: string, state: SessionState, posted = false): SessionInfo {
  return aSession({ id, kind: 'shell', name: id, state, lastEventAt: posted ? 1 : null });
}

test('tabMark: shells wear the shell mark, blinking while one runs (fix 627)', () => {
  const all = new Map<string, SessionInfo>([
    ['sh', shell('sh', 'idle')],
    ['sh2', shell('sh2', 'idle')],
    ['shx', shell('shx', 'exited')],
    ['idle', session('idle', 'idle')],
    ['busy', session('busy', 'working')],
    ['out', session('out', 'idle', false, [agentMember('running')])],
  ]);
  const running = new Set(['sh']);
  assert.deepEqual(tabMark(tab('sh'), all, undefined, running), { kind: 'shell', tone: 'idle', working: true }, 'a running shell alone blinks the shell mark');
  assert.deepEqual(tabMark(tab('sh2'), all, undefined, running), { kind: 'shell', tone: 'idle', working: false }, 'an idle shell alone is the shell still');
  assert.deepEqual(tabMark(tab('shx'), all, undefined, running), { kind: 'shell', tone: 'idle', working: false }, 'an exited shell alone is the shell still');
  assert.deepEqual(tabMark(tab('idle', 'sh'), all, undefined, running), { kind: 'shell', tone: 'idle', working: true }, 'an idle Claude beside a running shell blinks the shell');
  assert.deepEqual(tabMark(tab('busy', 'sh'), all, undefined, running), { kind: 'claude', tone: 'working', working: true }, 'a working Claude beside a running shell is the Claude working');
  assert.deepEqual(tabMark(tab('out', 'sh'), all, undefined, running), { kind: 'claude', tone: 'idle', working: true }, 'an agent out beside a running shell steps the Claude idle');
  assert.deepEqual(tabMark(tab('idle', 'sh2'), all, undefined, running), { kind: 'claude', tone: 'idle', working: false }, 'an idle Claude beside an idle shell is the Claude still');
  assert.deepEqual(tabMark(tab('sh'), all, 'needs-input', running), { kind: 'claude', tone: 'needs-input', working: false }, 'a wanting state over a running shell is the Claude in its tone');
});

test('tabMark: a shell that has posted a hook counts as a Claude, running or not (fix 627)', () => {
  const posted = new Map<string, SessionInfo>([
    ['hooked', shell('hooked', 'idle', true)],
    ['hookedBusy', shell('hookedBusy', 'working', true)],
  ]);
  const running = new Set(['hooked', 'hookedBusy']);
  assert.deepEqual(tabMark(tab('hooked'), posted, undefined, running), { kind: 'claude', tone: 'idle', working: false });
  assert.deepEqual(tabMark(tab('hookedBusy'), posted, undefined, running), { kind: 'claude', tone: 'working', working: true });
});

test('stripCut: fits, overflows within the arrows reserve, and the three scroll positions', () => {
  assert.equal(stripCut(0, 500, 500, 0), null);
  assert.equal(stripCut(0, 500, 520, 30), null);
  assert.equal(stripCut(0, 500, 900, 30), 'end');
  assert.equal(stripCut(100, 500, 900, 30), 'both');
  assert.equal(stripCut(400, 500, 900, 30), 'start');
});

test('pageTarget: the cut tab comes to the start edge, clamped, and the mirror', () => {
  const slots = [0, 1, 2, 3, 4].map((i) => ({ left: i * 100, right: i * 100 + 100 }));
  // View 250 wide at 0: the third tab (200 to 300) is cut.
  assert.equal(pageTarget(slots, 0, 250, 500, 'end'), 200);
  // Past the last page: clamped to scrollWidth - clientWidth.
  assert.equal(pageTarget(slots, 200, 250, 500, 'end'), 250);
  // A tab wider than the view: a whole view.
  assert.equal(pageTarget([{ left: 0, right: 900 }], 0, 300, 900, 'end'), 300);
  // Start: the last tab cut at the left edge comes to the end edge.
  assert.equal(pageTarget(slots, 250, 250, 500, 'start'), 50);
  assert.equal(pageTarget(slots, 50, 250, 500, 'start'), 0);
  assert.equal(pageTarget([{ left: 0, right: 900 }], 600, 300, 900, 'start'), 300);
});

test('wheelStep: vertical, Shift with deltaX inside and outside the scroller, none', () => {
  assert.equal(wheelStep(0, 40, false, true), 40);
  assert.equal(wheelStep(0, 40, true, false), 40);
  assert.equal(wheelStep(60, 0, true, false), 60);
  assert.equal(wheelStep(60, 0, true, true), 0);
  assert.equal(wheelStep(0, 0, false, false), 0);
});

// M9 fix 702: on the tab on show, a zoom hides every pane but one, and a
// wanting session in a hidden pane pulses the tab.
test('tabWanting: a hidden tab reads every pane, the tab on show only what its zoom hides', () => {
  const asking = new Map<string, SessionInfo>([
    ['a', session('a', 'needs-input')],
    ['b', session('b', 'needs-input')],
  ]);
  const wanting = new Set(['a', 'b']);
  assert.equal(tabWanting(tab('a', 'idle'), false, null, asking, wanting), 'needs-input', 'not on show, p0 wanting');
  assert.equal(tabWanting(tab('idle', 'b'), false, 'p0', asking, wanting), 'needs-input', 'not on show, the zoom is ignored');
  assert.equal(tabWanting(tab('a', 'b'), true, null, asking, wanting), undefined, 'on show with no zoom never pulses (fix 69)');
  assert.equal(tabWanting(tab('idle', 'b'), true, 'p0', asking, wanting), 'needs-input', 'zoomed on p0, p1 wanting and hidden');
  assert.equal(tabWanting(tab('idle', 'b'), true, 'p1', asking, wanting), undefined, 'zoomed on the wanting pane itself');
  assert.equal(tabWanting(tab('b', 'b'), true, 'p0', asking, wanting), undefined, 'the zoomed pane shows the same session');
  assert.equal(tabWanting(tab('idle', 'b'), true, 'elsewhere', asking, wanting), undefined, 'a zoom naming no pane of the tab hides nothing');
});
