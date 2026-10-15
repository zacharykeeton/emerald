import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout, LayoutNode } from '@emerald/shared';
import { CliError } from './cli-error.ts';
import { browserTarget } from './browser-target.ts';

// M9 fix 672: which browser pane emmer browser drives.

const OWN = 'sess-own';
const pane = (id: string, view: 'browser' | 'shell' | 'own'): LayoutNode => ({
  kind: 'pane',
  id,
  sessionId: view === 'own' ? OWN : view === 'shell' ? 'sess-other' : null,
  view: view === 'browser' ? { kind: 'browser', url: 'http://127.0.0.1:9/' } : null,
});
const split = (id: string, first: LayoutNode, second: LayoutNode): LayoutNode => ({ kind: 'split', id, direction: 'row', ratio: 0.5, first, second });

function layout(first: LayoutNode, second: LayoutNode): Layout {
  return {
    tabs: [
      { id: 't1', name: 'one', root: first, focusedPaneId: first.kind === 'pane' ? first.id : (first as { first: { id: string } }).first.id },
      { id: 't2', name: 'two', root: second, focusedPaneId: second.kind === 'pane' ? second.id : (second as { first: { id: string } }).first.id },
    ],
    currentTabId: 't1',
    revision: 1,
  };
}

function refused(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof CliError);
    assert.equal(err.exitCode, 1);
    return err.message;
  }
  assert.fail('expected a refusal');
}

test('the caller\'s own tab wins over the tab in front, and no caller takes the tab in front', () => {
  const l = layout(split('s1', pane('aaaa1111', 'shell'), pane('bbbb1111', 'browser')), split('s2', pane('cccc1111', 'own'), pane('dddd1111', 'browser')));
  assert.equal(browserTarget(l, OWN, undefined).pane.id, 'dddd1111');
  assert.equal(browserTarget(l, OWN, undefined).tab.name, 'two');
  assert.equal(browserTarget(l, undefined, undefined).pane.id, 'bbbb1111');
  // A session on no pane falls back to the tab in front.
  assert.equal(browserTarget(l, 'sess-nowhere', undefined).pane.id, 'bbbb1111');
});

test('none and several browser panes on the tab are refused in words that say what to do', () => {
  const none = layout(pane('aaaa1111', 'shell'), pane('dddd1111', 'browser'));
  assert.equal(refused(() => browserTarget(none, undefined, undefined)), 'no browser pane on tab one; emmer browser open <url> makes one');
  const two = layout(split('s1', pane('aaaa11112222', 'browser'), pane('bbbb11112222', 'browser')), pane('cccc1111', 'shell'));
  assert.equal(refused(() => browserTarget(two, undefined, undefined)), '2 browser panes on tab one (aaaa1111, bbbb1111); name one with --pane <id>');
});

test('--pane takes a full id or a unique prefix of 4 or more, across every tab', () => {
  const l = layout(split('s1', pane('abcd1111', 'browser'), pane('abcd2222', 'shell')), split('s2', pane('abce3333', 'browser'), pane('cccc1111', 'own')));
  assert.equal(browserTarget(l, undefined, 'abcd1111').pane.id, 'abcd1111');
  assert.equal(browserTarget(l, undefined, 'abce').pane.id, 'abce3333');
  assert.equal(browserTarget(l, undefined, 'abce').tab.name, 'two');
  assert.equal(refused(() => browserTarget(l, undefined, 'abcd')), 'abcd matches 2 panes; give more of it');
  assert.equal(refused(() => browserTarget(l, undefined, 'abc')), 'no pane abc');
  assert.equal(refused(() => browserTarget(l, undefined, 'nosuchpane')), 'no pane nosuchpane');
  assert.equal(refused(() => browserTarget(l, undefined, 'abcd2222')), 'pane abcd2222 is not a browser pane');
});
