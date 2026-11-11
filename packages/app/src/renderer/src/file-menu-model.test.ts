import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyableImage, fileMenu } from './file-menu-model.ts';

// M9 fix 270: the file body's right-click menu as one list. M9 fix
// 338: Wrap long lines sits after Select all, checked while on.
test('the editor of an editable file lists Copy, Select all, Wrap, Paste, then the three ways out under a rule', () => {
  const items = fileMenu({ view: 'raw', editable: true, selected: true, wrap: true, json: false, schemes: [], scheme: null, image: false, imageCopyable: false });
  assert.deepEqual(
    items.map((i) => i.label),
    ['Copy', 'Select all', 'Find', 'Wrap long lines', 'Paste', 'Copy path', 'Reveal in Explorer', 'Reveal in Files', 'Open with Windows', 'Colour scheme'],
  );
  // M9 fix 619: Find on every view, the key beside it.
  assert.equal(items.find((i) => i.run === 'find')?.hint, 'Ctrl+F');
  assert.equal(items.find((i) => i.run === 'wrap')?.hint, 'Alt+Z');
  assert.equal(items.find((i) => i.run === 'wrap')?.checked, true);
  assert.equal(fileMenu({ view: 'raw', editable: true, selected: true, wrap: false, json: false, schemes: [], scheme: null, image: false, imageCopyable: false }).find((i) => i.run === 'wrap')?.checked, false);
  assert.ok(items.every((i) => i.run === 'wrap' || i.checked === undefined), 'no other item wears a check');
  assert.equal(items.find((i) => i.run === 'copy')?.hint, 'Ctrl+C');
  assert.equal(items.find((i) => i.run === 'paste')?.hint, 'Ctrl+V');
  assert.equal(items.find((i) => i.run === 'copy')?.disabled, false);
  assert.equal(items.find((i) => i.run === 'copy-path')?.separator, true);
  // M9 fix 652: Reveal in Files after Reveal in Explorer, under the same rule.
  assert.equal(items.find((i) => i.run === 'reveal-files')?.title, 'Show this file in the Files rail, its folders opened');
  assert.equal(items.find((i) => i.run === 'reveal-files')?.separator, undefined);
  assert.equal(items.find((i) => i.run === 'select-all')?.separator, undefined);
});

test('Copy is disabled with nothing selected and says so', () => {
  const copy = fileMenu({ view: 'raw', editable: true, selected: false, wrap: true, json: false, schemes: [], scheme: null, image: false, imageCopyable: false }).find((i) => i.run === 'copy')!;
  assert.equal(copy.disabled, true);
  assert.equal(copy.title, 'Nothing selected');
});

test("a transcript's Raw view and the rendered views offer no Paste", () => {
  for (const facts of [
    { view: 'raw' as const, editable: false, selected: true, wrap: true, json: false, schemes: [], scheme: null, image: false, imageCopyable: false },
    { view: 'rendered' as const, editable: false, selected: true, wrap: true, json: false, schemes: [], scheme: null, image: false, imageCopyable: false },
    { view: 'turns' as const, editable: false, selected: false, wrap: false, json: false, schemes: [], scheme: null, image: false, imageCopyable: false },
  ]) {
    const items = fileMenu(facts);
    assert.ok(!items.some((i) => i.run === 'paste'), `no Paste on ${facts.view}`);
    // The wrap is the editor's, so a transcript's Raw view offers it and
    // the rendered views do not.
    assert.deepEqual(
      items.map((i) => i.run),
      facts.view === 'raw' ? ['copy', 'select-all', 'find', 'wrap', 'copy-path', 'reveal', 'reveal-files', 'open', 'heading'] : ['copy', 'select-all', 'find', 'copy-path', 'reveal', 'reveal-files', 'open', 'heading'],
    );
  }
});

// M9 fix 339: a .json file's Raw view lists Format JSON after Paste;
// its Pretty view is read-only and lists neither, but keeps the wrap.
// M9 fix 420: Format JSON selection sits right after it, disabled with
// nothing selected.
test("a JSON file's Raw view offers Format JSON and its Pretty view does not", () => {
  const raw = fileMenu({ view: 'raw', editable: true, selected: false, wrap: true, json: true, schemes: [], scheme: null, image: false, imageCopyable: false });
  assert.deepEqual(
    raw.map((i) => i.run),
    ['copy', 'select-all', 'find', 'wrap', 'paste', 'format', 'format-selection', 'copy-path', 'reveal', 'reveal-files', 'open', 'heading'],
  );
  assert.equal(raw.find((i) => i.run === 'format')?.label, 'Format JSON');
  assert.equal(raw.find((i) => i.run === 'format-selection')?.label, 'Format JSON selection');
  assert.equal(raw.find((i) => i.run === 'format-selection')?.disabled, true, 'disabled with nothing selected');
  assert.equal(raw.find((i) => i.run === 'format-selection')?.title, 'Nothing selected');
  const rawSelected = fileMenu({ view: 'raw', editable: true, selected: true, wrap: true, json: true, schemes: [], scheme: null, image: false, imageCopyable: false });
  assert.equal(rawSelected.find((i) => i.run === 'format-selection')?.disabled, false, 'enabled with a selection');
  const pretty = fileMenu({ view: 'pretty', editable: true, selected: false, wrap: false, json: true, schemes: [], scheme: null, image: false, imageCopyable: false });
  assert.deepEqual(
    pretty.map((i) => i.run),
    ['copy', 'select-all', 'find', 'wrap', 'copy-path', 'reveal', 'reveal-files', 'open', 'heading'],
  );
  assert.ok(!fileMenu({ view: 'raw', editable: true, selected: false, wrap: true, json: false, schemes: [], scheme: null, image: false, imageCopyable: false }).some((i) => i.run === 'format'), 'no Format on a file that is not JSON');
  assert.ok(!fileMenu({ view: 'raw', editable: true, selected: true, wrap: true, json: false, schemes: [], scheme: null, image: false, imageCopyable: false }).some((i) => i.run === 'format-selection'), 'no Format JSON selection on a file that is not JSON');
});

// M9 fix 340: the scheme section at the end, in the pane menu's shape.
test("the menu ends with a Colour scheme heading, one checked row per scheme, and Window's scheme while the file has a pick", () => {
  const schemes = [
    { name: 'emerald', background: '#1b1e24', source: 'shipped' as const },
    { name: 'Dracula', background: '#282a36', source: 'shipped' as const },
    { name: 'Mine', background: '#ffffff', source: 'windows-terminal' as const },
  ];
  const none = fileMenu({ view: 'raw', editable: true, selected: false, wrap: true, json: false, schemes, scheme: null, image: false, imageCopyable: false });
  const tail = none.slice(none.findIndex((i) => i.run === 'heading'));
  assert.deepEqual(
    tail.map((i) => i.label),
    ['Colour scheme', 'emerald', 'Dracula', 'Mine'],
  );
  assert.equal(tail[0]?.disabled, undefined, 'a heading is not a disabled item');
  assert.deepEqual(
    tail.slice(1).map((i) => [i.run, i.scheme, i.checked]),
    [
      ['scheme', 'emerald', false],
      ['scheme', 'Dracula', false],
      ['scheme', 'Mine', false],
    ],
    'no row checked while the file follows the window',
  );
  assert.equal(tail[2]?.title, 'Shipped with emerald, ground #282a36');
  assert.equal(tail[3]?.title, 'From your Windows Terminal settings, ground #ffffff');
  const picked = fileMenu({ view: 'rendered', editable: true, selected: false, wrap: true, json: false, schemes, scheme: 'Dracula', image: false, imageCopyable: false });
  const pickedTail = picked.slice(picked.findIndex((i) => i.run === 'heading'));
  assert.deepEqual(
    pickedTail.map((i) => i.label),
    ['Colour scheme', "Window's scheme", 'emerald', 'Dracula', 'Mine'],
  );
  assert.deepEqual(pickedTail[1] && [pickedTail[1].run, pickedTail[1].scheme], ['scheme', null], "Window's scheme clears the pick");
  assert.equal(pickedTail.find((i) => i.label === 'Dracula')?.checked, true);
  assert.ok(pickedTail[0]?.title?.startsWith('This file wears Dracula'), 'the heading names the pick');
});

// M9 fix 1007: a picture's menu opens with Copy image.
test("a picture's menu opens with Copy image, disabled with a reason on a kind Electron cannot decode", () => {
  const facts = { view: 'raw' as const, editable: true, selected: false, wrap: true, json: false, schemes: [], scheme: null, image: true, imageCopyable: true };
  const items = fileMenu(facts);
  assert.deepEqual(items[0], { run: 'copy-image', label: 'Copy image', disabled: false, title: 'Copy the picture to the clipboard, as a PNG' });
  assert.deepEqual(
    items.slice(1).map((i) => i.run),
    fileMenu({ ...facts, image: false }).map((i) => i.run),
  );
  const refused = fileMenu({ view: 'rendered', editable: true, selected: false, wrap: true, json: false, schemes: [], scheme: null, image: true, imageCopyable: false });
  assert.equal(refused[0]?.disabled, true);
  assert.equal(refused[0]?.title, "This kind of picture can't be copied");
  assert.ok(!fileMenu({ ...facts, image: false }).some((i) => i.run === 'copy-image'), 'no Copy image off a picture');
});

// Main decodes PNG and JPEG; the renderer draws the other five.
test('copyableImage takes every picture kind and refuses a network path (M9 fix 1111)', () => {
  for (const f of ['b.png', 'b.JPG', 'b.jpeg', 'b.ico', 'b.gif', 'b.webp', 'b.bmp', 'b.svg']) assert.equal(copyableImage(`C:\\a\\${f}`), true, f);
  assert.equal(copyableImage('C:\\a\\b.txt'), false);
  assert.equal(copyableImage('\\\\host\\share\\b.png'), false);
});
