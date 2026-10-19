import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localPageUrl } from '@emerald/shared';
import type { Layout } from '@emerald/shared';
import { answerLocalPage, LOCAL_PAGE_HEADERS, localRequestAllowed, localRootIn } from './local-page.ts';
import type { LocalAnswer } from './local-page.ts';

// M9 fix 896: what main answers a page from the disk, on a scratch folder.

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type Served = Extract<LocalAnswer, { status: 200 }>;
type Refused = Exclude<LocalAnswer, { status: 200 }>;

function served(a: LocalAnswer): Served {
  if (a.status !== 200) assert.fail(`expected 200, got ${a.status} ${a.reason}`);
  return a;
}

function refused(a: LocalAnswer): Refused {
  if (a.status === 200) assert.fail(`expected a refusal, got 200 ${a.file}`);
  return a;
}

function scratch(): { root: string; outside: string } {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-local-page-')));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'site', 'empty'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'site', 'page.html'), '<p>hi</p>');
  fs.writeFileSync(path.join(root, 'site', 'style.CSS'), 'p{}');
  fs.writeFileSync(path.join(root, 'site', 'index.html'), '<p>index</p>');
  fs.writeFileSync(path.join(root, 'site', 'blob.xyz'), 'x');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(root, 'site', 'out'), 'junction');
  return { root, outside };
}

test('a page from the disk is answered from its folder alone, and refused outside it (M9 fix 896)', async () => {
  const { root } = scratch();
  try {
    const rootOf = (id: string) => (id === ID ? root : null);
    const at = (rel: string) => answerLocalPage(localPageUrl(ID, rel), 'GET', rootOf);
    const page = served(await at('site/page.html'));
    assert.equal(page.type, 'text/html; charset=utf-8');
    assert.equal(page.file, path.join(root, 'site', 'page.html'));
    assert.equal(served(await at('site/style.CSS')).type, 'text/css; charset=utf-8');
    assert.equal(served(await at('site/blob.xyz')).type, 'application/octet-stream');
    assert.equal(served(await at('site')).file, path.join(root, 'site', 'index.html'));
    served(await answerLocalPage(localPageUrl(ID, 'site/page.html'), 'HEAD', rootOf));
    for (const rel of ['site/empty', 'site/nope.html']) {
      const a = refused(await at(rel));
      assert.equal(a.status, 404, rel);
      assert.equal(a.reason, 'not found', rel);
      assert.equal(a.log, false, rel);
      assert.ok(a.body.includes('is not there. This pane reloads when the file is back.'), rel);
    }
    const noFolder = refused(await answerLocalPage(localPageUrl(OTHER, 'x.html'), 'GET', rootOf));
    assert.deepEqual([noFolder.status, noFolder.reason, noFolder.log], [404, 'no folder', true]);
    const back = refused(await answerLocalPage(`emerald-file://${ID}/a/..%5Csecret.txt`, 'GET', rootOf));
    assert.deepEqual([back.status, back.reason, back.log], [400, 'bad path', true]);
    const out = refused(await at('site/out/secret.txt'));
    assert.deepEqual([out.status, out.reason, out.body, out.log], [403, 'outside the folder', 'refused: outside the folder', true]);
    const post = refused(await answerLocalPage(localPageUrl(ID, 'site/page.html'), 'POST', rootOf));
    assert.deepEqual([post.status, post.reason], [405, 'GET only']);
    const gone = refused(await answerLocalPage(localPageUrl(ID, 'x.html'), 'GET', () => path.join(root, 'no-such-folder')));
    assert.equal(gone.reason, 'no folder');
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

test("a subresource of a page from the disk is fetched only by a page of the same root id; a frame's own load goes on (M9 fix 896)", () => {
  const dot = localPageUrl(ID, 'dot.png');
  assert.equal(localRequestAllowed(dot, 'image', localPageUrl(ID, 'page.html')), true);
  assert.equal(localRequestAllowed(dot, 'xhr', localPageUrl(ID, 'sub/page.html')), true);
  assert.equal(localRequestAllowed(dot, 'image', 'http://127.0.0.1:3000/'), false);
  assert.equal(localRequestAllowed(dot, 'script', localPageUrl(OTHER, 'page.html')), false);
  assert.equal(localRequestAllowed(dot, 'image', ''), false);
  assert.equal(localRequestAllowed(localPageUrl(ID, 'page.html'), 'mainFrame', ''), true);
  assert.equal(localRequestAllowed(localPageUrl(ID, 'page.html'), 'subFrame', 'http://x/'), true);
  assert.equal(localRequestAllowed('emerald-file://notauuid/x', 'image', localPageUrl(ID, 'page.html')), false);
  // A bad path from the same folder reaches the handler, which says 400.
  assert.equal(localRequestAllowed(`emerald-file://${ID}/site/..%5Csecret.txt`, 'xhr', localPageUrl(ID, 'site/page.html')), true);
});

test('every answer carries no-store, same-origin CORP and no referrer (M9 fix 896)', () => {
  assert.equal(LOCAL_PAGE_HEADERS['Cache-Control'], 'no-store');
  assert.equal(LOCAL_PAGE_HEADERS['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(LOCAL_PAGE_HEADERS['Referrer-Policy'], 'no-referrer');
});

test("localRootIn finds a page's folder across tabs, and null for an id no pane holds (M9 fix 896)", () => {
  const pane = (id: string, view: unknown) => ({ kind: 'pane', id, sessionId: null, view });
  const layout = {
    revision: 1,
    currentTabId: 't1',
    tabs: [
      { id: 't1', name: 'one', root: pane('p1', { kind: 'browser', url: 'http://x/' }), focusedPaneId: 'p1' },
      { id: 't2', name: 'two', root: { kind: 'split', id: 's', direction: 'row', ratio: 0.5, first: pane('p2', null), second: pane('p3', { kind: 'browser', url: localPageUrl(ID, 'a.html'), root: 'C:\\pages' }) }, focusedPaneId: 'p2' },
    ],
  } as unknown as Layout;
  assert.equal(localRootIn(layout, ID), 'C:\\pages');
  assert.equal(localRootIn(layout, OTHER), null);
  assert.equal(localRootIn(null, ID), null);
});
