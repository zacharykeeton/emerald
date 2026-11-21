import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout } from '@emerald/shared';
import { besideTarget } from './open-beside-model.ts';

test('besideTarget (M9 fix 1197): an opener\'s pane on a back tab, a typed beside first, and null for a session on no pane', () => {
  const l: Layout = {
    revision: 1,
    currentTabId: 't2',
    tabs: [
      {
        id: 't1',
        name: 'Panes',
        focusedPaneId: 'p2',
        root: {
          kind: 'split',
          id: 's1',
          direction: 'row',
          ratio: 0.5,
          first: { kind: 'pane', id: 'p1', sessionId: 'sess-a', view: null },
          second: { kind: 'pane', id: 'p2', sessionId: 'sess-b', view: null },
        },
      },
      { id: 't2', name: 'Panes 2', focusedPaneId: 'p3', root: { kind: 'pane', id: 'p3', sessionId: 'sess-b', view: null } },
    ],
  } as Layout;
  assert.deepEqual(besideTarget(l, undefined, 'sess-a'), { paneId: 'p1', tabId: 't1', tabName: 'Panes', inFront: false, typed: false });
  assert.deepEqual(besideTarget(l, 'sess-a', 'sess-b'), { paneId: 'p1', tabId: 't1', tabName: 'Panes', inFront: false, typed: true });
  assert.deepEqual(besideTarget(l, undefined, 'sess-b'), { paneId: 'p3', tabId: 't2', tabName: 'Panes 2', inFront: true, typed: false });
  assert.equal(besideTarget(l, undefined, 'sess-none'), null);
  assert.equal(besideTarget(l, undefined, undefined), null);
  assert.equal(besideTarget(null, undefined, 'sess-a'), null);
});
