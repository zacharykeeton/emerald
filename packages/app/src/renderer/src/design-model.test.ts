import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DesignPick, SessionInfo } from '@emerald/shared';
import { addNote, deleteNote, designTarget, editNote, noteTitle, removeSent } from './design-model.ts';
import type { FocusEntry } from './focus-history-model.ts';

type S = Pick<SessionInfo, 'id' | 'kind' | 'claudeSessionId' | 'lastEventAt' | 'state'>;
const claude = (id: string, state: S['state'] = 'idle'): S => ({ id, kind: 'claude', claudeSessionId: `c-${id}`, lastEventAt: 1, state });
const shell = (id: string): S => ({ id, kind: 'shell', claudeSessionId: null, lastEventAt: null, state: 'idle' });
const pane = (paneId: string, tabId = 't1'): FocusEntry => ({ kind: 'pane', tabId, paneId });

const panes = [
  { paneId: 'pa', session: claude('A') },
  { paneId: 'pb', session: claude('B') },
  { paneId: 'ps', session: shell('S') },
  { paneId: 'web', session: null },
];

function target(entries: FocusEntry[], over: Partial<Parameters<typeof designTarget>[0]> = {}): string | null {
  return designTarget({ entries, at: entries.length - 1, tabId: 't1', browserPaneId: 'web', panes, ...over });
}

test('designTarget is the Claude pane focused before the browser pane (M9 fix 674)', () => {
  assert.equal(target([pane('pb'), pane('pa'), pane('web')]), 'A');
});

test('designTarget skips a shell focused after the Claude pane (M9 fix 674)', () => {
  assert.equal(target([pane('pb'), pane('ps'), pane('web')]), 'B');
});

test("designTarget skips another tab's Claude pane (M9 fix 674)", () => {
  assert.equal(target([pane('pb'), pane('pa', 't2'), pane('web')]), 'B');
});

test('designTarget skips an exited Claude session (M9 fix 674)', () => {
  const withExited = [{ paneId: 'pa', session: claude('A', 'exited') }, { paneId: 'pb', session: claude('B') }, { paneId: 'web', session: null }];
  assert.equal(target([pane('pb'), pane('pa'), pane('web')], { panes: withExited }), 'B');
});

test("designTarget falls back to the tab's one Claude pane with no history (M9 fix 674)", () => {
  const one = [{ paneId: 'pa', session: claude('A') }, { paneId: 'ps', session: shell('S') }, { paneId: 'web', session: null }];
  assert.equal(target([], { panes: one }), 'A');
});

test('designTarget answers null with two Claude panes and no history, and with none (M9 fix 674)', () => {
  assert.equal(target([]), null);
  assert.equal(target([pane('ps'), pane('web')], { panes: [{ paneId: 'ps', session: shell('S') }, { paneId: 'web', session: null }] }), null);
});

test('a shell a hook has reached counts as Claude (M9 fix 674)', () => {
  const hooked = [{ paneId: 'ps', session: { ...shell('S'), lastEventAt: 5 } }, { paneId: 'web', session: null }];
  assert.equal(target([], { panes: hooked }), 'S');
});

const pick = (selector: string): DesignPick => ({
  url: 'http://x/',
  viewport: { width: 1, height: 1 },
  dpr: 1,
  selector,
  tag: 'p',
  role: null,
  text: '',
  html: '<p></p>',
  styles: [],
  rect: { x: 0, y: 0, width: 1, height: 1 },
  nearby: '',
  source: null,
});

test('the tray adds, edits and deletes notes (M9 fix 675)', () => {
  let notes = addNote([], pick('#a'), null, 'n1');
  notes = addNote(notes, pick('#b'), 'C:/x.png', 'n2');
  notes = editNote(notes, 'n1', 'make it green');
  notes = deleteNote(notes, 'n2');
  assert.deepEqual(
    notes.map((n) => [n.id, n.comment]),
    [['n1', 'make it green']],
  );
});

test('removeSent keeps a note added after the send began (M9 fix 675)', () => {
  let notes = addNote(addNote([], pick('#a'), null, 'n1'), pick('#b'), null, 'n2');
  const sent = notes.map((n) => n.id);
  notes = addNote(notes, pick('#c'), null, 'n3');
  assert.deepEqual(
    removeSent(notes, sent).map((n) => n.id),
    ['n3'],
  );
});

test("a note's title cuts the selector at 40 (M9 fix 675)", () => {
  assert.equal(noteTitle(1, addNote([], pick('#cta'), null, 'n')[0]!), '1. p #cta');
  assert.equal(noteTitle(2, addNote([], pick('x'.repeat(50)), null, 'n')[0]!), `2. p ${'x'.repeat(40)}…`);
});
