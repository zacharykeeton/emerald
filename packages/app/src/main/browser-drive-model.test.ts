import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog, centre, downloadName, eventLine, keySpec, parseRef, fromElectron, pauseFor, screenshotName, snapshotOf, waitExpression, type AxNode } from './browser-drive-model.ts';

// M9 fix 673: the events, the download names and the pause rule.

test('the event log keeps the newest 200, says how many went, and a read empties it', () => {
  const log = new EventLog();
  const at = new Date(2026, 9, 14, 9, 5, 7).getTime();
  for (let i = 0; i < 202; i++) log.add({ at, kind: 'window', url: `http://x/${i}` });
  const first = log.read();
  assert.equal(first.lines.length, 201);
  assert.equal(first.lines[0], '2 older events dropped');
  assert.equal(first.lines[1], '09:05:07 window http://x/2');
  assert.equal(first.entries.length, 200);
  assert.deepEqual(log.read(), { lines: [], entries: [] });
});

test('each event line shape', () => {
  const at = new Date(2026, 9, 14, 23, 0, 1).getTime();
  assert.equal(eventLine({ at, kind: 'window', url: 'http://127.0.0.1:9/blank-target' }), '23:00:01 window http://127.0.0.1:9/blank-target');
  assert.equal(eventLine({ at, kind: 'download', path: 'C:\\h\\downloads\\a.json' }), '23:00:01 download C:\\h\\downloads\\a.json');
  assert.equal(eventLine({ at, kind: 'download-failed', name: 'a.json', state: 'cancelled' }), '23:00:01 download cancelled a.json');
  assert.equal(eventLine({ at, kind: 'console', text: 'boom', source: 'http://127.0.0.1:9/', line: 4 }), '23:00:01 console error boom (http://127.0.0.1:9/:4)');
});

test('a download name: refused characters, an empty name, and a number while it is taken', () => {
  assert.equal(downloadName(['report.json'], 'report.json'), 'report (2).json');
  assert.equal(downloadName(['report.json', 'report (2).json'], 'report.json'), 'report (3).json');
  assert.equal(downloadName([], 'a:b?.txt'), 'a_b_.txt');
  assert.equal(downloadName([], ''), 'download');
  assert.equal(downloadName(['name'], 'name'), 'name (2)');
});

test('the pause rule: a press on a driven pane outside the driver\'s own dispatch', () => {
  const driven = { driven: true, paused: false, synthetic: 0 };
  assert.equal(pauseFor({ ...driven, driven: false }, { kind: 'mouse', type: 'mouseDown' }), null);
  assert.equal(pauseFor({ ...driven, synthetic: 1 }, { kind: 'mouse', type: 'mouseDown' }), null);
  assert.equal(pauseFor({ ...driven, paused: true }, { kind: 'key', type: 'keyDown', key: 'a' }), null);
  assert.equal(pauseFor(driven, { kind: 'mouse', type: 'mouseMove' }), null);
  assert.equal(pauseFor(driven, { kind: 'key', type: 'keyUp', key: 'a' }), null);
  assert.equal(pauseFor(driven, { kind: 'key', type: 'keyDown', key: 'Shift' }), null);
  assert.equal(pauseFor(driven, { kind: 'mouse', type: 'mouseDown' }), 'click');
  assert.equal(pauseFor(driven, { kind: 'key', type: 'keyDown', key: 'a' }), 'key');
  assert.equal(pauseFor(driven, { kind: 'key', type: 'rawKeyDown', key: 'a' }), 'key');
});

// M9 fix 672: the snapshot, the refs, the keys and the names.

const v = (value: unknown) => ({ type: typeof value === 'number' ? 'integer' : 'string', value });

test('a snapshot prints the controls with refs in document order and a heading without one', () => {
  const nodes: AxNode[] = [
    { nodeId: '1', role: v('RootWebArea'), name: v('Drive'), childIds: ['2', '4', '5', '6', '7'] },
    { nodeId: '2', ignored: true, role: v('generic'), childIds: ['3'] },
    { nodeId: '3', role: v('button'), name: v('Go'), backendDOMNodeId: 30 },
    { nodeId: '4', role: v('textbox'), name: v('Name'), value: v('hi'), properties: [{ name: 'focused', value: { type: 'boolean', value: true } }], backendDOMNodeId: 40 },
    { nodeId: '5', role: v('checkbox'), name: v('Keep'), properties: [{ name: 'disabled', value: { type: 'boolean', value: true } }, { name: 'checked', value: { type: 'tristate', value: 'false' } }], backendDOMNodeId: 50 },
    { nodeId: '6', role: v('heading'), name: v('Part two'), properties: [{ name: 'level', value: { type: 'integer', value: 2 } }], backendDOMNodeId: 60 },
    { nodeId: '7', role: v('StaticText'), name: v('just words'), backendDOMNodeId: 70 },
  ];
  const snap = snapshotOf(nodes, { title: 'Drive fixture', url: 'http://127.0.0.1:9/' });
  assert.equal(snap.text, [
    'page "Drive fixture" http://127.0.0.1:9/',
    '@e1 button "Go"',
    '@e2 textbox "Name" value="hi" [focused]',
    '@e3 checkbox "Keep" [disabled]',
    'heading "Part two" level=2',
  ].join('\n'));
  assert.deepEqual([...snap.refs], [['e1', 30], ['e2', 40], ['e3', 50]]);
  assert.deepEqual(snap.rows[1], { ref: 'e2', role: 'textbox', name: 'Name', value: 'hi', states: ['focused'] });
});

test('past 500 rows the rest are counted, and a long name is cut at 200', () => {
  const buttons: AxNode[] = Array.from({ length: 502 }, (_, i) => ({ nodeId: `b${i}`, role: v('button'), name: v(`b${i}`), backendDOMNodeId: i + 1 }));
  const root: AxNode = { nodeId: 'r', role: v('RootWebArea'), childIds: buttons.map((b) => b.nodeId) };
  const snap = snapshotOf([root, ...buttons], { title: 't', url: 'u' });
  const lines = snap.text.split('\n');
  assert.equal(lines.length, 1 + 500 + 1);
  assert.equal(lines.at(-1), '... 2 more not listed');
  assert.equal(snap.refs.size, 500);
  const long = snapshotOf([{ nodeId: 'x', role: v('link'), name: v('n'.repeat(250)), backendDOMNodeId: 1 }], { title: 't', url: 'u' });
  assert.equal(long.text.split('\n')[1], `@e1 link "${'n'.repeat(200)}..."`);
});

test('a ref is @e3 or e3, nothing else', () => {
  assert.equal(parseRef('@e3'), 'e3');
  assert.equal(parseRef('e3'), 'e3');
  assert.equal(parseRef('3'), null);
  assert.equal(parseRef('@x3'), null);
});

test('keys: named, letters with their text, modifiers, and a key not on the list', () => {
  assert.deepEqual(keySpec('Escape'), { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 });
  assert.deepEqual(keySpec('ctrl+a'), { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  assert.deepEqual(keySpec('A'), { key: 'A', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0, text: 'A' });
  assert.deepEqual(keySpec('Shift+Alt+7'), { key: '7', code: 'Digit7', windowsVirtualKeyCode: 55, modifiers: 9 });
  assert.equal(keySpec('Enter')!.text, '\r');
  assert.equal(keySpec('F13'), null);
  assert.equal(keySpec('Hyper+a'), null);
});

test('the centre of a quad, and a screenshot named by the local time', () => {
  assert.deepEqual(centre([10, 20, 30, 20, 30, 40, 10, 40]), { x: 20, y: 30 });
  assert.equal(screenshotName(new Date(2026, 9, 14, 9, 5, 7, 42)), 'browser-20261014-090507-042.png');
});

// M9 fix 856: wait finds a text on the page, in a field's value or in an
// aria-label, the expression run against a stub document.
test('the wait expression says where the text is: the page, a field, a label, or nowhere', () => {
  type El = { tagName?: string; type?: string; value?: string; selectedOptions?: { text: string }[]; getAttribute?: (name: string) => string | null };
  const run = (text: string, page: { innerText?: string; fields?: El[]; labelled?: El[] }): unknown => {
    const stub = {
      body: { innerText: page.innerText ?? '' },
      querySelectorAll: (sel: string) => (sel === '[aria-label]' ? (page.labelled ?? []) : sel === 'input, textarea, select' ? (page.fields ?? []) : []),
    };
    return new Function('document', `return ${waitExpression(text)}`)(stub);
  };
  const label = (value: string): El => ({ getAttribute: (name) => (name === 'aria-label' ? value : null) });
  assert.equal(run('Feature Implementation', { innerText: 'a Feature Implementation here' }), 'text');
  assert.equal(run('Feature Implementation', { fields: [{ tagName: 'INPUT', type: 'text', value: 'Feature Implementation' }] }), 'field');
  assert.equal(run('Feature Implementation', { fields: [{ tagName: 'INPUT', type: 'password', value: 'Feature Implementation' }] }), null);
  assert.equal(run('Feature Implementation', { fields: [{ tagName: 'SELECT', type: 'select-one', selectedOptions: [{ text: 'Feature Implementation' }] }] }), 'field');
  assert.equal(run('Feature Implementation', { labelled: [label('Feature Implementation')] }), 'label');
  assert.equal(run('Feature Implementation', { innerText: 'nothing', fields: [{ tagName: 'TEXTAREA', type: 'textarea', value: 'other' }], labelled: [label('other')] }), null);
  assert.equal(run('a "b" \\c', { fields: [{ tagName: 'INPUT', type: 'text', value: 'x a "b" \\c y' }] }), 'field');
});

// M9 fix 857: Electron's own console lines are told by their source.
test('a console line from node:electron/ is Electron\'s own, and a page\'s is not', () => {
  assert.equal(fromElectron('node:electron/js2c/sandbox_bundle'), true);
  assert.equal(fromElectron('http://127.0.0.1:9/'), false);
  assert.equal(fromElectron(''), false);
  assert.equal(fromElectron('node:internal/x'), false);
});
