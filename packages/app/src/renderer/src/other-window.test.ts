import { test } from 'node:test';
import assert from 'node:assert/strict';

// Two windows of a profile writing the same keys (M9 fixes 925 and 926),
// under fakes for what a window gives the modules: a Map-backed
// localStorage the other window writes into by hand, and the preload's
// use record. The fakes go on before the imports, since ui.ts and the
// file-scheme store read storage at module load.
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
};
g['window'] = { emerald: { useRecord: { write: () => {} } }, location: { search: '' } };

const ui = await import('./ui.ts');
const { getFileScheme, setFileScheme } = await import('./file-scheme-store.ts');
const { otherWindowWrote } = await import('./other-window.ts');
const { parseChatPanes } = await import('./chat-model.ts');

test("a pane map's write keeps what another window stored after this one loaded (M9 fix 926)", () => {
  store.set('emerald.shadedPanes', '["p-other"]');
  ui.shadePane('p-mine');
  assert.deepEqual(JSON.parse(store.get('emerald.shadedPanes')!), ['p-other', 'p-mine']);

  store.set('emerald.chatPanes', JSON.stringify([['p-other', 's1']]));
  ui.setChatFace('p-mine', 's2', true);
  const faces = parseChatPanes(store.get('emerald.chatPanes') ?? null);
  assert.equal(faces.get('p-other'), 's1');
  assert.equal(faces.get('p-mine'), 's2');

  store.set('emerald.fontSizes', '{"p-other":18}');
  ui.setFontSize('p-mine', 20);
  assert.deepEqual(JSON.parse(store.get('emerald.fontSizes')!), { 'p-other': 18, 'p-mine': 20 });

  store.set('emerald.attention', '{"sound":"once","notify":true,"usage":false}');
  ui.setAttentionNotify(false);
  const attention = JSON.parse(store.get('emerald.attention')!);
  assert.equal(attention.sound, 'once');
  assert.equal(attention.notify, false);
  assert.equal(ui.getUiState().attentionSound, 'once');

  store.set('emerald.fileSchemes', '[["C:\\\\repo\\\\a.md","Dracula"]]');
  setFileScheme('C:/repo/b.md', 'One Dark');
  assert.deepEqual(JSON.parse(store.get('emerald.fileSchemes')!), [
    ['C:\\repo\\a.md', 'Dracula'],
    ['C:\\repo\\b.md', 'One Dark'],
  ]);

  // M9 fix 949: a fold starts from the stored set.
  store.set('emerald.sidebarFolded', '["g-other"]');
  ui.toggleSidebarFold('g-mine');
  assert.deepEqual(JSON.parse(store.get('emerald.sidebarFolded')!), ['g-other', 'g-mine']);
});

test("another window's write is taken as it lands (M9 fix 926)", () => {
  const wrote = (key: string, raw: string): void => {
    store.set(key, raw);
    otherWindowWrote(key, raw);
  };
  wrote('emerald.shadeAfter', '5');
  assert.equal(ui.getUiState().shadeAfter, 5);
  wrote('emerald.copyOnSelect', 'on');
  assert.equal(ui.getUiState().copyOnSelect, true);
  wrote('emerald.splitKind', 'shell');
  assert.equal(ui.getUiState().splitKind, 'shell');
  wrote('emerald.wrapLines', 'off');
  assert.equal(ui.getUiState().wrapLines, false);
  wrote('emerald.attention', '{"sound":"off","notify":true,"usage":false}');
  assert.equal(ui.getUiState().attentionSound, 'off');
  wrote('emerald.shadedPanes', '["p-a","p-b"]');
  assert.deepEqual([...ui.getUiState().shadedPanes], ['p-a', 'p-b']);
  wrote('emerald.fontSizes', '{"p-a":22}');
  assert.equal(ui.fontSizeFor('p-a'), 22);
  wrote('emerald.chatPanes', JSON.stringify([['p-a', 's9', 'verbose']]));
  assert.equal(ui.getUiState().chatPanes.get('p-a'), 's9');
  assert.equal(ui.getUiState().chatModes.get('p-a'), 'verbose');
  wrote('emerald.fileSchemes', '[["C:\\\\repo\\\\c.md","Nord"]]');
  assert.equal(getFileScheme('C:/repo/c.md'), 'Nord');
  // M9 fix 949: the sidebar list's choices follow.
  wrote('emerald.sidebarOrder', 'state');
  assert.equal(ui.getUiState().sidebarOrder, 'state');
  wrote('emerald.sidebarFilter', 'needs');
  assert.equal(ui.getUiState().sidebarFilter, 'needs');
  wrote('emerald.sidebarFolded', '["g-a"]');
  assert.deepEqual([...ui.getUiState().sidebarFolded], ['g-a']);
});

test("a contents hit's reveal handed to a new window is taken once at its load, under ten seconds old (M9 fix 948)", () => {
  const key = 'emerald.revealHandoff';
  ui.handRevealToNewWindow('p-new', 'C:/repo/a.ts', 12, 5);
  const at = (JSON.parse(store.get(key)!) as { at: number }).at;
  assert.deepEqual(ui.loadRevealHandoff(at + 9_999), { path: 'C:/repo/a.ts', line: 12, column: 5, seq: 1, paneId: 'p-new' });
  assert.equal(store.has(key), false, 'taken once');
  assert.equal(ui.loadRevealHandoff(at + 9_999), null);
  ui.handRevealToNewWindow('p-new', 'C:/repo/a.ts', 12, 5);
  const again = (JSON.parse(store.get(key)!) as { at: number }).at;
  assert.equal(ui.loadRevealHandoff(again + 10_000), null, 'ten seconds old is too old');
  assert.equal(store.has(key), false);
  store.set(key, '{"paneId":3}');
  assert.equal(ui.loadRevealHandoff(), null);
  assert.equal(store.has(key), false);
});
