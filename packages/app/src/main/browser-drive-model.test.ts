import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_DRAG_PAUSE_MS, BROWSER_DRAG_STEPS, BROWSER_HOLD_IDLE_MS, BROWSER_OPTIONS_LISTED, EventLog, centre, downloadName, dragPath, eventLine, keySpec, parseRef, parseRegion, fillPlan, fromElectron, holdIdleMs, pageThrew, pauseFor, screenshotName, snapshotOf, waitExpression, type AxNode } from './browser-drive-model.ts';

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
  // M9 fix 875: a control past the cap keeps a ref, so a filtered
  // snapshot can print it under the whole page's number.
  assert.equal(snap.refs.size, 502);
  assert.equal(snap.shown.length, 500);
  assert.equal(snap.rows.length, 502);
  const long = snapshotOf([{ nodeId: 'x', role: v('link'), name: v('n'.repeat(250)), backendDOMNodeId: 1 }], { title: 't', url: 'u' });
  assert.equal(long.text.split('\n')[1], `@e1 link "${'n'.repeat(200)}..."`);
});

// M9 fix 875: regions with refs of their own, and the filters.
const filterTree: AxNode[] = [
  { nodeId: '1', role: v('RootWebArea'), name: v('Drag'), childIds: ['2', '3', '4', '8'] },
  { nodeId: '2', role: v('heading'), name: v('Drag'), properties: [{ name: 'level', value: { type: 'integer', value: 1 } }], backendDOMNodeId: 2 },
  { nodeId: '3', role: v('button'), name: v('Save draft'), backendDOMNodeId: 10 },
  { nodeId: '4', role: v('dialog'), name: v('Edit step'), childIds: ['5', '6', '7'], backendDOMNodeId: 20 },
  { nodeId: '5', role: v('textbox'), name: v('Step name'), value: v('Saved one'), backendDOMNodeId: 21 },
  { nodeId: '6', role: v('button'), name: v('Save'), backendDOMNodeId: 22 },
  { nodeId: '7', role: v('button'), name: v('Cancel'), backendDOMNodeId: 23 },
  { nodeId: '8', role: v('list'), name: v('Steps'), childIds: ['9'], backendDOMNodeId: 30 },
  { nodeId: '9', role: v('button'), name: v('Step A'), backendDOMNodeId: 31 },
];
const filterPage = { title: 'Drag', url: 'http://127.0.0.1:9/drag' };
const pageLine = 'page "Drag" http://127.0.0.1:9/drag';

test('a snapshot lists regions with @r refs after the controls before them, the @e numbers unchanged (M9 fix 875)', () => {
  const snap = snapshotOf(filterTree, filterPage);
  assert.equal(snap.text, [
    pageLine,
    'heading "Drag" level=1',
    '@e1 button "Save draft"',
    '@r1 dialog "Edit step"',
    '@e2 textbox "Step name" value="Saved one"',
    '@e3 button "Save"',
    '@e4 button "Cancel"',
    '@r2 list "Steps"',
    '@e5 button "Step A"',
  ].join('\n'));
  assert.deepEqual([...snap.regions], [['r1', 20], ['r2', 30]]);
  assert.equal(snap.found, true);
});

test('--name keeps the rows whose name or value holds it, any case, under the whole page\'s refs (M9 fix 875)', () => {
  const snap = snapshotOf(filterTree, filterPage, { name: 'SAVE' });
  assert.equal(snap.text, [pageLine, '@e1 button "Save draft"', '@e2 textbox "Step name" value="Saved one"', '@e3 button "Save"'].join('\n'));
  assert.equal(snap.refs.size, 5);
  assert.equal(snap.shown.length, 3);
  assert.equal(snapshotOf(filterTree, filterPage, { name: 'nothing' }).text, [pageLine, 'no row matches "nothing"'].join('\n'));
});

test('--within keeps the region\'s own row and the rows inside it, and an id not on the page is not found (M9 fix 875)', () => {
  const within = { id: 20, ref: 'r1' };
  assert.equal(snapshotOf(filterTree, filterPage, { within }).text, [pageLine, '@r1 dialog "Edit step"', '@e2 textbox "Step name" value="Saved one"', '@e3 button "Save"', '@e4 button "Cancel"'].join('\n'));
  assert.equal(snapshotOf(filterTree, filterPage, { within, name: 'save' }).text, [pageLine, '@e2 textbox "Step name" value="Saved one"', '@e3 button "Save"'].join('\n'));
  assert.equal(snapshotOf(filterTree, filterPage, { within, name: 'zzz' }).text, [pageLine, 'no row under @r1 matches "zzz"'].join('\n'));
  assert.equal(snapshotOf(filterTree, filterPage, { within: { id: 20, ref: 'r1' } }).found, true);
  assert.equal(snapshotOf(filterTree, filterPage, { within: { id: 99, ref: 'r9' } }).found, false);
  assert.equal(snapshotOf(filterTree, filterPage, { within: { id: 31, ref: 'e5' }, name: 'nope' }).text, [pageLine, 'no row under @e5 matches "nope"'].join('\n'));
});

test('a ref is @e3 or e3, nothing else', () => {
  assert.equal(parseRef('@e3'), 'e3');
  assert.equal(parseRef('e3'), 'e3');
  assert.equal(parseRef('3'), null);
  assert.equal(parseRef('@x3'), null);
  // M9 fix 875: a region's ref.
  assert.equal(parseRegion('@r2'), 'r2');
  assert.equal(parseRegion('r2'), 'r2');
  assert.equal(parseRegion('@e2'), null);
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

test('a drag moves in ten steps 16 ms apart, the last point the target itself (M9 fix 874)', () => {
  assert.equal(BROWSER_DRAG_STEPS, 10);
  assert.equal(BROWSER_DRAG_PAUSE_MS, 16);
  const path = dragPath({ x: 0, y: 0 }, { x: 100, y: -50 }, 10);
  assert.equal(path.length, 10);
  assert.deepEqual(path[0], { x: 10, y: -5 });
  assert.deepEqual(path.at(-1), { x: 100, y: -50 });
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

// M9 fix 876: the hold's length, and the harness's shorter one.
test('a held page is let go a minute after its last command, or after EMERALD_BROWSER_HOLD_MS (M9 fix 876)', () => {
  assert.equal(BROWSER_HOLD_IDLE_MS, 60000);
  for (const raw of [undefined, '', '0', '-5', 'abc']) assert.equal(holdIdleMs(raw), 60000, String(raw));
  assert.equal(holdIdleMs('4000'), 4000);
});

// M9 fix 877: what fill does with each kind of target, and what the page threw.
test('fill\'s plan: a field types, a select picks by value then text, and a checkbox, a radio, a file input, a multiple select and a missing option are refused (M9 fix 877)', () => {
  const d = '@e21 checkbox "Agree"';
  assert.deepEqual(fillPlan({ kind: 'field' }, 'x', '@e21', d), { type: 'field' });
  assert.deepEqual(fillPlan({ kind: 'checkbox' }, 'x', '@e21', d), { type: 'refuse', text: '@e21 is a checkbox; click it to tick it' });
  assert.deepEqual(fillPlan({ kind: 'radio' }, 'x', '@e21', d), { type: 'refuse', text: '@e21 is a radio button; click it to pick it' });
  assert.deepEqual(fillPlan({ kind: 'file' }, 'x', '@e21', d), { type: 'refuse', text: '@e21 is a file input; emmer browser upload @e21 <path> sets its file' });
  assert.deepEqual(fillPlan({ kind: 'multiple' }, 'x', '@e21', d), { type: 'refuse', text: 'fill takes a single select; a multiple select is not driven' });
  const car = { kind: 'select' as const, options: [{ value: 'v', text: 'Volvo' }, { value: 's', text: 'Saab' }] };
  const sd = '@e3 combobox "Car"';
  assert.deepEqual(fillPlan(car, 's', '@e3', sd), { type: 'pick', index: 1, option: 'Saab' });
  assert.deepEqual(fillPlan(car, 'Volvo', '@e3', sd), { type: 'pick', index: 0, option: 'Volvo' });
  assert.deepEqual(fillPlan(car, '  Saab ', '@e3', sd), { type: 'pick', index: 1, option: 'Saab' });
  assert.deepEqual(fillPlan(car, 'Audi', '@e3', sd), { type: 'refuse', text: 'no option "Audi" in @e3 combobox "Car"; its options are Volvo, Saab' });
  // A value match wins over a text match.
  assert.deepEqual(fillPlan({ kind: 'select', options: [{ value: 'Saab', text: 'Volvo' }, { value: 'x', text: 'Saab' }] }, 'Saab', '@e3', sd), { type: 'pick', index: 0, option: 'Volvo' });
  assert.deepEqual(fillPlan({ kind: 'select', options: [] }, 'x', '@e3', sd), { type: 'refuse', text: '@e3 combobox "Car" has no options' });
  const many = { kind: 'select' as const, options: Array.from({ length: 25 }, (_, i) => ({ value: String(i), text: `o${i}` })) };
  assert.equal(BROWSER_OPTIONS_LISTED, 20);
  const listed = Array.from({ length: 20 }, (_, i) => `o${i}`).join(', ');
  assert.deepEqual(fillPlan(many, 'none', '@e3', sd), { type: 'refuse', text: `no option "none" in @e3 combobox "Car"; its first 20 options are ${listed} and 5 more` });
});

test('the page threw: the first line of the exception, else its text, else nothing thrown', () => {
  assert.equal(pageThrew({}), null);
  assert.equal(pageThrew({ exceptionDetails: { exception: { description: 'Error: x\n    at y' } } }), 'Error: x');
  assert.equal(pageThrew({ exceptionDetails: { text: 'Uncaught' } }), 'Uncaught');
});
