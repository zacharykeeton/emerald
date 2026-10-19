import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout } from '@emerald/shared';
import { isHtmlFile, localPageRoot, localPageView, pageWhere } from './local-page-model.ts';

// M9 fix 897: an HTML file rendered in a browser pane.

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

const layoutWith = (view: unknown): Layout =>
  ({
    revision: 1,
    currentTabId: 't1',
    tabs: [
      { id: 't1', name: 'one', root: { kind: 'pane', id: 'p0', sessionId: null, view: null }, focusedPaneId: 'p0' },
      { id: 't2', name: 'two', root: { kind: 'pane', id: 'p1', sessionId: null, view }, focusedPaneId: 'p1' },
    ],
  }) as unknown as Layout;

test('isHtmlFile takes .html and .htm in any case alone', () => {
  assert.equal(isHtmlFile('C:\\a\\a.html'), true);
  assert.equal(isHtmlFile('B.HTM'), true);
  assert.equal(isHtmlFile('a.html.md'), false);
  assert.equal(isHtmlFile('a.xhtml'), false);
});

test("localPageRoot is the rail's root for a file under it, case-blind, else the file's own folder", () => {
  assert.equal(localPageRoot('C:\\Work\\site\\page.html', 'c:\\work'), 'c:\\work');
  assert.equal(localPageRoot('C:\\Work\\site\\page.html', 'C:\\Work\\'), 'C:\\Work');
  assert.equal(localPageRoot('C:\\Workshop\\page.html', 'C:\\Work'), 'C:\\Workshop');
  assert.equal(localPageRoot('C:\\Other\\page.html', 'C:\\Work'), 'C:\\Other');
  assert.equal(localPageRoot('C:\\Other\\page.html', null), 'C:\\Other');
});

test('localPageView mints an id, reuses a pane of the same folder in any case, and encodes a nested path', () => {
  let n = 0;
  const ids = () => `aaaaaaaa-bbbb-4ccc-8ddd-00000000000${++n}`;
  assert.deepEqual(localPageView(null, 'C:\\Work', 'C:\\Work\\page.html', ids), { kind: 'browser', url: 'emerald-file://aaaaaaaa-bbbb-4ccc-8ddd-000000000001/page.html', root: 'C:\\Work' });
  const layout = layoutWith({ kind: 'browser', url: `emerald-file://${ID}/a.html`, root: 'C:\\Work' });
  assert.equal(localPageView(layout, 'c:\\work', 'c:\\work\\b.html', ids).url, `emerald-file://${ID}/b.html`);
  assert.equal(localPageView(layout, 'C:\\Elsewhere', 'C:\\Elsewhere\\b.html', ids).url, 'emerald-file://aaaaaaaa-bbbb-4ccc-8ddd-000000000002/b.html');
  assert.equal(localPageView(null, 'C:\\Work', 'C:\\Work\\my site\\deep\\p.html', ids).url, 'emerald-file://aaaaaaaa-bbbb-4ccc-8ddd-000000000003/my%20site/deep/p.html');
});

test("pageWhere is a page from the disk's absolute path and a web page's URL", () => {
  assert.equal(pageWhere({ kind: 'browser', url: `emerald-file://${ID}/site/page.html`, root: 'C:\\Work' }), 'C:\\Work\\site\\page.html');
  assert.equal(pageWhere({ kind: 'browser', url: 'http://localhost:3000/' }), 'http://localhost:3000/');
});
