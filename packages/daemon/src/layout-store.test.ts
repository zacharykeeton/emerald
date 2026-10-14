import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { addTab, currentTab, listPanes, replaceTab, setPaneSession, splitPane } from '@emerald/shared';
import type { Layout, LayoutTab } from '@emerald/shared';
import { LayoutStore } from './layout-store.ts';
import { silentLogger } from './log.ts';

function tempFile(): string {
  const dir = mkTemp('emerald-layout-');
  // A nested directory proves persist() creates parents.
  return path.join(dir, 'nested', 'state.json');
}

test.after(removeTemps);

// Applies a tree op to the tab on show, the way the renderer's editTab does.
const onCurrent = (layout: Layout, fn: (tab: LayoutTab) => LayoutTab): Layout => replaceTab(layout, fn(currentTab(layout)));

test('starts with one tab named Panes holding a single empty pane when there is no state file', () => {
  const store = new LayoutStore(tempFile(), silentLogger);
  store.load();
  const layout = store.get();
  assert.equal(layout.tabs.length, 1);
  const tab = currentTab(layout);
  assert.equal(tab.name, 'Panes');
  assert.equal(tab.root.kind, 'pane');
  assert.equal(tab.focusedPaneId, tab.root.id);
  assert.equal(layout.revision, 0);
});

test('set validates, bumps the revision, persists and emits', () => {
  const file = tempFile();
  const store = new LayoutStore(file, silentLogger);
  store.load();
  const changed: Layout[] = [];
  store.on('changed', (l: Layout) => changed.push(l));

  const proposed = onCurrent(store.get(), (t) => splitPane(t, t.root.id, 'row'));
  const accepted = store.set(proposed);
  assert.equal(accepted.revision, 1);
  assert.equal(currentTab(accepted).root.kind, 'split');
  assert.equal(store.get(), accepted);
  assert.deepEqual(changed, [accepted]);

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; layout: Layout };
  assert.equal(onDisk.version, 1);
  assert.deepEqual(onDisk.layout, accepted);
  assert.ok(!fs.existsSync(`${file}.tmp`), 'temp file was renamed away');
});

test('set takes a second tab and a switch, one revision for the whole layout', () => {
  const store = new LayoutStore(tempFile(), silentLogger);
  store.load();
  const two = store.set(addTab(store.get()));
  assert.equal(two.tabs.length, 2);
  assert.equal(two.tabs[1]?.name, 'Panes 2');
  assert.equal(two.currentTabId, two.tabs[1]?.id);
  assert.equal(two.revision, 1);
  const back = store.set({ ...two, currentTabId: two.tabs[0]!.id });
  assert.equal(back.revision, 2);
  // An edit to the other tab from before the switch is stale like any other.
  assert.throws(() => store.set(onCurrent(two, (t) => splitPane(t, t.root.id, 'row'))), { code: 'stale-revision' });
});

test('set rejects a stale revision without changing anything', () => {
  const store = new LayoutStore(tempFile(), silentLogger);
  store.load();
  const base = store.get();
  const first = store.set(onCurrent(base, (t) => splitPane(t, t.root.id, 'row')));
  // A second client edits from the old base and loses.
  assert.throws(() => store.set(onCurrent(base, (t) => splitPane(t, t.root.id, 'column'))), { code: 'stale-revision' });
  assert.equal(store.get(), first);
  // A revision from the future is just as stale.
  assert.throws(() => store.set({ ...first, revision: 99 }), { code: 'stale-revision' });
});

test('set rejects an invalid layout as bad-request', () => {
  const store = new LayoutStore(tempFile(), silentLogger);
  store.load();
  assert.throws(() => store.set('nope'), { code: 'bad-request' });
  assert.throws(() => store.set(onCurrent(store.get(), (t) => ({ ...t, focusedPaneId: 'ghost' }))), { code: 'bad-request' });
  assert.throws(() => store.set({ ...store.get(), tabs: [] }), { code: 'bad-request' });
  assert.throws(() => store.set({ ...store.get(), currentTabId: 'ghost' }), { code: 'bad-request' });
  assert.equal(store.get().revision, 0);
});

test('set takes a single tree from before M36 as an edit to the tab on show', () => {
  const store = new LayoutStore(tempFile(), silentLogger);
  store.load();
  const two = store.set(addTab(store.get()));
  const shown = currentTab(two);
  const tree = splitPane({ root: shown.root, focusedPaneId: shown.focusedPaneId, revision: two.revision }, shown.root.id, 'row');
  const accepted = store.set(tree);
  assert.equal(accepted.revision, two.revision + 1);
  assert.equal(accepted.tabs.length, 2, 'the other tab is still there');
  assert.equal(accepted.currentTabId, shown.id);
  const edited = currentTab(accepted);
  assert.equal(edited.name, 'Panes 2', 'the tab keeps its name');
  assert.equal(edited.root.kind, 'split');
  assert.equal(edited.focusedPaneId, tree.focusedPaneId);
  assert.deepEqual(accepted.tabs[0], two.tabs[0], 'the first tab is untouched');
  assert.throws(() => store.set({ ...tree, revision: two.revision }), { code: 'stale-revision' }, 'the tree carries the layout revision');
  assert.throws(() => store.set({ ...tree, focusedPaneId: 'ghost' }), { code: 'bad-request' });
});

test('clearSession empties every pane on the session in every tab and bumps the revision only for a change', () => {
  const file = tempFile();
  const store = new LayoutStore(file, silentLogger);
  store.load();
  const base = store.get();
  const split = onCurrent(base, (t) => splitPane(t, t.root.id, 'row'));
  const [a, b] = listPanes(currentTab(split));
  const withSessions = store.set(onCurrent(split, (t) => setPaneSession(setPaneSession(t, a!.id, 's1'), b!.id, 's1')));
  // A second tab showing the same session in its one pane.
  const second = addTab(withSessions);
  const withBoth = store.set(onCurrent(second, (t) => setPaneSession(t, t.root.id, 's1')));
  const changed: Layout[] = [];
  store.on('changed', (l: Layout) => changed.push(l));

  assert.equal(store.clearSession('nobody'), false);
  assert.equal(store.get(), withBoth, 'untouched when nothing shows the session');
  assert.deepEqual(changed, []);

  assert.equal(store.clearSession('s1'), true);
  assert.deepEqual(
    store.get().tabs.map((t) => listPanes(t).map((p) => p.sessionId)),
    [[null, null], [null]],
  );
  assert.equal(store.get().revision, withBoth.revision + 1);
  assert.deepEqual(changed, [store.get()], 'subscribers hear the daemon-side edit');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { layout: Layout };
  assert.deepEqual(onDisk.layout, store.get());
});

// M9 fix 456: panes on an id no record holds are emptied at the start, in
// every tab, with one revision for the lot.
test('clearUnknown empties panes on ids no record holds, in one revision, and leaves known ones', () => {
  const file = tempFile();
  const store = new LayoutStore(file, silentLogger);
  store.load();
  const split = onCurrent(store.get(), (t) => splitPane(t, t.root.id, 'row'));
  const [a, b] = listPanes(currentTab(split));
  const first = store.set(onCurrent(split, (t) => setPaneSession(setPaneSession(t, a!.id, 'kept'), b!.id, 'lost1')));
  const withBoth = store.set(onCurrent(addTab(first), (t) => setPaneSession(t, t.root.id, 'lost2')));
  const changed: Layout[] = [];
  store.on('changed', (l: Layout) => changed.push(l));

  assert.deepEqual(store.clearUnknown(new Set(['kept', 'lost1', 'lost2'])), []);
  assert.equal(store.get(), withBoth, 'untouched when every id is known');
  assert.deepEqual(changed, []);

  assert.deepEqual(store.clearUnknown(new Set(['kept'])).sort(), ['lost1', 'lost2']);
  assert.deepEqual(
    store.get().tabs.map((t) => listPanes(t).map((p) => p.sessionId)),
    [['kept', null], [null]],
  );
  assert.equal(store.get().revision, withBoth.revision + 1, 'one revision for both');
  assert.deepEqual(changed, [store.get()]);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { layout: Layout };
  assert.deepEqual(onDisk.layout, store.get());
});

test('load reads back what set persisted', () => {
  const file = tempFile();
  const a = new LayoutStore(file, silentLogger);
  a.load();
  const saved = a.set(onCurrent(addTab(a.get()), (t) => splitPane(t, t.root.id, 'column')));

  const b = new LayoutStore(file, silentLogger);
  b.load();
  assert.deepEqual(b.get(), saved);
  assert.equal(b.get().revision, 1, 'revision continues across restarts so old clients stay stale');
});

test('load reads a single tree from before M36 as one tab named Panes and writes tabs back', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tree = {
    root: { kind: 'split', id: 's', direction: 'row', ratio: 0.4, first: { kind: 'pane', id: 'a', sessionId: 'x', view: null }, second: { kind: 'pane', id: 'b', sessionId: null, view: null } },
    focusedPaneId: 'b',
    revision: 12,
  };
  fs.writeFileSync(file, JSON.stringify({ version: 1, layout: tree }));
  const store = new LayoutStore(file, silentLogger);
  store.load();
  const layout = store.get();
  assert.equal(layout.revision, 12, 'the revision carries over');
  assert.equal(layout.tabs.length, 1);
  const tab = currentTab(layout);
  assert.equal(tab.name, 'Panes');
  assert.deepEqual(tab.root, tree.root);
  assert.equal(tab.focusedPaneId, 'b');
  const saved = store.set(addTab(layout));
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { layout: Layout };
  assert.deepEqual(onDisk.layout, saved);
  assert.ok('tabs' in onDisk.layout, 'the file is in the new shape once written');
});

test('load falls back to the default layout on a corrupt or foreign file', () => {
  const samples = ['{not json', '{"version":2,"layout":{}}', '{"version":1,"layout":{"root":{"kind":"tab"}}}', '{"version":1,"layout":{"tabs":[],"currentTabId":"x","revision":0}}'];
  for (const contents of samples) {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    const store = new LayoutStore(file, silentLogger);
    store.load();
    assert.equal(currentTab(store.get()).root.kind, 'pane', contents);
    assert.equal(store.get().revision, 0, contents);
    // Set aside whole (M9 fix 457), so the next write does not overwrite it.
    const aside = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('state.json.bad-'));
    assert.equal(aside.length, 1, contents);
    assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]!), 'utf8'), contents);
    assert.equal(fs.existsSync(file), false, contents);
  }
});
