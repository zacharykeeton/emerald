import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultScheme, pageTheme, mergeSchemes, orderSchemes, pickScheme, resolveScheme, schemeFromWindowsTerminal, schemesFromWindowsTerminal, selectionColor, storedPick, themeOf } from './scheme-model.ts';

const teal = {
  name: 'Verify Teal',
  background: '#001F1F',
  foreground: '#C0FFEE',
  cursorColor: '#FFFFFF',
  selectionBackground: '#4A90D9',
  black: '#000000',
  red: '#AA0000',
  green: '#00AA00',
  yellow: '#AAAA00',
  blue: '#0000AA',
  purple: '#AA00AA',
  cyan: '#00AAAA',
  white: '#AAAAAA',
  brightBlack: '#555555',
  brightRed: '#FF5555',
  brightGreen: '#55FF55',
  brightYellow: '#FFFF55',
  brightBlue: '#5555FF',
  brightPurple: '#FF55FF',
  brightCyan: '#55FFFF',
  brightWhite: '#FFFFFF',
};

test('one Windows Terminal entry reads into a scheme, purple as magenta, hex lowered', () => {
  const s = schemeFromWindowsTerminal(teal);
  assert.ok(s !== null);
  assert.equal(s.name, 'Verify Teal');
  assert.equal(s.source, 'windows-terminal');
  assert.equal(s.background, '#001f1f');
  assert.equal(s.magenta, '#aa00aa');
  assert.equal(s.brightMagenta, '#ff55ff');
  assert.equal(s.cursor, '#ffffff');
  assert.equal(s.selection, '#4a90d9');
});

test('an entry without a name, with a colour missing or with a colour that is not a hex is not a scheme', () => {
  const { name: _n, ...noName } = teal;
  assert.equal(schemeFromWindowsTerminal(noName), null);
  const { red: _r, ...noRed } = teal;
  assert.equal(schemeFromWindowsTerminal(noRed), null);
  assert.equal(schemeFromWindowsTerminal({ ...teal, blue: 'blue' }), null);
  assert.equal(schemeFromWindowsTerminal(null), null);
  assert.equal(schemeFromWindowsTerminal('Dracula'), null);
});

test('the cursor and the selection fall back to the foreground when the entry has neither', () => {
  const { cursorColor: _c, selectionBackground: _s, ...bare } = teal;
  const s = schemeFromWindowsTerminal(bare);
  assert.ok(s !== null);
  assert.equal(s.cursor, '#c0ffee');
  assert.equal(s.selection, '#c0ffee');
});

test('a settings.json with two schemes and one entry that is not lists the two, in order', () => {
  const text = JSON.stringify({ profiles: {}, colorSchemes: [teal, { name: 'Broken' }, { ...teal, name: 'Second' }] });
  const list = schemesFromWindowsTerminal(text);
  assert.deepEqual(
    list.map((s) => s.name),
    ['Verify Teal', 'Second'],
  );
});

test('a settings.json with no colorSchemes, or that is not JSON, lists nothing', () => {
  assert.deepEqual(schemesFromWindowsTerminal(JSON.stringify({ profiles: {} })), []);
  assert.deepEqual(schemesFromWindowsTerminal(''), []);
  assert.deepEqual(schemesFromWindowsTerminal('not json at all'), []);
  assert.deepEqual(schemesFromWindowsTerminal('[]'), []);
});

test('the comments and trailing commas Windows Terminal writes are read past', () => {
  const text = `{
    // The person's schemes.
    "colorSchemes": [
      ${JSON.stringify(teal)}, /* a block comment, "with a quote" */
    ],
    "profiles": { "list": [] },
  }`;
  const list = schemesFromWindowsTerminal(text);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'Verify Teal');
});

test('a // inside a string value survives the comment strip', () => {
  const text = `{ "colorSchemes": [ ${JSON.stringify({ ...teal, name: 'http://odd' })}, ], }`;
  assert.equal(schemesFromWindowsTerminal(text)[0]?.name, 'http://odd');
});

test('defaultScheme gives each skin and theme its own (fix 572, fix 1034)', () => {
  assert.equal(defaultScheme('classic', 'dark'), 'emerald');
  assert.equal(defaultScheme('emerald', 'dark'), 'emerald gem');
  assert.equal(defaultScheme('classic', 'light'), 'emerald light');
  assert.equal(defaultScheme('emerald', 'light'), 'emerald gem light');
});

const shippedOf = () =>
  ['Dracula', 'emerald gem light', 'emerald gem', 'emerald light', 'emerald', 'One Dark'].map((name) => schemeFromWindowsTerminal({ ...teal, name }, 'shipped')).filter((s) => s !== null);
const ownOf = () => [schemeFromWindowsTerminal({ ...teal, name: 'dracula' }), schemeFromWindowsTerminal(teal)].filter((s) => s !== null);

test('the merge puts the skin’s default first and the other’s second, then the rest, then the person’s, a shipped name winning', () => {
  const names = (skin: 'classic' | 'emerald', theme: 'light' | 'dark') => mergeSchemes(shippedOf(), ownOf(), skin, theme).map((s) => `${s.name}:${s.source}`);
  const tail = ['Dracula:shipped', 'One Dark:shipped', 'Verify Teal:windows-terminal'];
  assert.deepEqual(names('classic', 'dark'), ['emerald:shipped', 'emerald gem:shipped', 'emerald light:shipped', 'emerald gem light:shipped', ...tail]);
  assert.deepEqual(names('emerald', 'dark'), ['emerald gem:shipped', 'emerald:shipped', 'emerald gem light:shipped', 'emerald light:shipped', ...tail]);
  assert.deepEqual(names('emerald', 'light'), ['emerald gem light:shipped', 'emerald light:shipped', 'emerald gem:shipped', 'emerald:shipped', ...tail]);
  assert.deepEqual(names('classic', 'light'), ['emerald light:shipped', 'emerald gem light:shipped', 'emerald:shipped', 'emerald gem:shipped', ...tail]);
});

test('orderSchemes keeps the order of the rest', () => {
  assert.deepEqual(orderSchemes(shippedOf(), 'emerald', 'dark').map((s) => s.name), ['emerald gem', 'emerald', 'emerald gem light', 'emerald light', 'Dracula', 'One Dark']);
  assert.deepEqual(orderSchemes(shippedOf(), 'emerald', 'light').map((s) => s.name), ['emerald gem light', 'emerald light', 'emerald gem', 'emerald', 'Dracula', 'One Dark']);
});

test('the pick names a scheme, falls back to the skin’s default, then to the first, and is null on an empty list', () => {
  const list = [schemeFromWindowsTerminal({ ...teal, name: 'emerald' }, 'shipped'), schemeFromWindowsTerminal({ ...teal, name: 'emerald gem' }, 'shipped'), schemeFromWindowsTerminal(teal)].filter((s) => s !== null);
  assert.equal(pickScheme(list, 'Verify Teal', 'classic', 'dark')?.name, 'Verify Teal');
  assert.equal(pickScheme(list, 'Nope', 'classic', 'dark')?.name, 'emerald');
  assert.equal(pickScheme(list, null, 'classic', 'dark')?.name, 'emerald');
  assert.equal(pickScheme(list, 'Nope', 'emerald', 'dark')?.name, 'emerald gem');
  assert.equal(pickScheme(list, null, 'emerald', 'dark')?.name, 'emerald gem');
  assert.equal(pickScheme(list, 'emerald', 'emerald', 'dark')?.name, 'emerald', 'Classic’s palette picked by hand holds under Emerald');
  const noDefault = [schemeFromWindowsTerminal(teal)].filter((s) => s !== null);
  assert.equal(pickScheme(noDefault, null, 'classic', 'dark')?.name, 'Verify Teal');
  assert.equal(pickScheme(noDefault, null, 'emerald', 'dark')?.name, 'Verify Teal');
  assert.equal(pickScheme([], 'anything', 'classic', 'dark'), null);
  assert.equal(pickScheme([], 'anything', 'emerald', 'dark'), null);
});

test('a pick of the skin’s own default stores nothing, any other pick is stored', () => {
  assert.equal(storedPick('emerald', 'classic', 'dark'), null);
  assert.equal(storedPick('emerald gem', 'emerald', 'dark'), null);
  assert.equal(storedPick('emerald', 'emerald', 'dark'), 'emerald');
  assert.equal(storedPick('emerald gem', 'classic', 'dark'), 'emerald gem');
  assert.equal(storedPick('Dracula', 'classic', 'dark'), 'Dracula');
  assert.equal(storedPick('Dracula', 'emerald', 'dark'), 'Dracula');
});

test('an explicit pick survives a flip, no pick follows the skin', () => {
  const list = [schemeFromWindowsTerminal({ ...teal, name: 'emerald' }, 'shipped'), schemeFromWindowsTerminal({ ...teal, name: 'emerald gem' }, 'shipped'), schemeFromWindowsTerminal(teal)].filter((s) => s !== null);
  for (const s of ['classic', 'emerald'] as const) assert.equal(pickScheme(list, 'Verify Teal', s, 'dark')?.name, 'Verify Teal');
  assert.equal(pickScheme(list, null, 'classic', 'dark')?.name, 'emerald');
  assert.equal(pickScheme(list, null, 'emerald', 'dark')?.name, 'emerald gem');
});

test('the xterm theme carries every colour, the ground under the cursor and the selection at the terminal’s alpha', () => {
  const s = schemeFromWindowsTerminal(teal);
  assert.ok(s !== null);
  const t = themeOf(s);
  assert.equal(t.background, '#001f1f');
  assert.equal(t.cursorAccent, '#001f1f');
  assert.equal(t.selectionBackground, 'rgba(74, 144, 217, 0.3)');
  assert.equal(selectionColor('#ffffff'), 'rgba(255, 255, 255, 0.3)');
  assert.equal(t.brightMagenta, '#ff55ff');
  assert.equal(Object.keys(t).length, 21);
});

test("resolveScheme (M9 fix 244): the session's own scheme when on the list, else the window's pick, else the default", () => {
  const own = schemeFromWindowsTerminal(teal)!;
  const emerald = schemeFromWindowsTerminal({ ...teal, name: 'emerald' }, 'shipped')!;
  const dark = schemeFromWindowsTerminal({ ...teal, name: 'One Dark' }, 'shipped')!;
  const gem = schemeFromWindowsTerminal({ ...teal, name: 'emerald gem' }, 'shipped')!;
  const list = [emerald, gem, dark, own];
  assert.deepEqual(resolveScheme(list, 'Verify Teal', 'One Dark', 'classic'), { scheme: own, own: true }, "the session's own wins over the window's");
  assert.deepEqual(resolveScheme(list, null, 'One Dark', 'classic'), { scheme: dark, own: false }, "no own scheme: the window's pick");
  assert.deepEqual(resolveScheme(list, undefined, null, 'classic'), { scheme: emerald, own: false }, 'a record from before the field and no pick: the default');
  assert.deepEqual(resolveScheme(list, 'Gone Scheme', 'One Dark', 'classic'), { scheme: dark, own: false }, "a name the box lacks falls back to the window's and is not its own");
  assert.deepEqual(resolveScheme(list, 'Gone Scheme', null, 'classic'), { scheme: emerald, own: false }, 'and to the default with no pick');
  assert.deepEqual(resolveScheme([], 'Verify Teal', null, 'classic'), { scheme: null, own: false }, 'an empty list resolves to nothing, as pickScheme does');
  assert.deepEqual(resolveScheme(list, undefined, null, 'emerald'), { scheme: gem, own: false }, 'no pick under Emerald: emerald gem');
  assert.deepEqual(resolveScheme(list, 'Verify Teal', null, 'emerald'), { scheme: own, own: true }, 'a session’s own scheme wins under Emerald too');
  const gemLight = schemeFromWindowsTerminal({ ...teal, name: 'emerald gem light' }, 'shipped')!;
  assert.deepEqual(resolveScheme([...list, gemLight], undefined, null, 'emerald', 'light'), { scheme: gemLight, own: false }, 'no pick under Emerald light: emerald gem light');
});

test("resolveScheme's default theme is the page's data-theme, dark with no page (fix 1034)", () => {
  const gem = schemeFromWindowsTerminal({ ...teal, name: 'emerald gem' }, 'shipped')!;
  const gemLight = schemeFromWindowsTerminal({ ...teal, name: 'emerald gem light' }, 'shipped')!;
  const list = [gem, gemLight];
  assert.equal(pageTheme(), 'dark');
  const g = globalThis as Record<string, unknown>;
  try {
    g['document'] = { documentElement: { dataset: { theme: 'light' } } };
    assert.equal(pageTheme(), 'light');
    assert.deepEqual(resolveScheme(list, undefined, null, 'emerald'), { scheme: gemLight, own: false });
  } finally {
    delete g['document'];
  }
});

test('storedPick per theme (fix 1034): the skin and theme’s own default stores nothing, every other name is stored', () => {
  assert.equal(storedPick('emerald gem light', 'emerald', 'light'), null);
  assert.equal(storedPick('emerald light', 'classic', 'light'), null);
  assert.equal(storedPick('emerald gem', 'emerald', 'light'), 'emerald gem');
  assert.equal(storedPick('emerald', 'classic', 'light'), 'emerald');
  assert.equal(storedPick('emerald gem light', 'emerald', 'dark'), 'emerald gem light');
  assert.equal(storedPick('Dracula', 'emerald', 'light'), 'Dracula');
});

test('a pick stored on dark holds under light, and no pick follows the theme (fix 1034)', () => {
  const mk = (name: string) => schemeFromWindowsTerminal({ ...teal, name }, 'shipped')!;
  const list = ['emerald', 'emerald gem', 'emerald light', 'emerald gem light', 'One Dark', 'Verify Teal'].map(mk);
  assert.equal(pickScheme(list, storedPick('One Dark', 'emerald', 'dark'), 'emerald', 'light')?.name, 'One Dark');
  assert.equal(pickScheme(list, storedPick('emerald', 'emerald', 'dark'), 'emerald', 'light')?.name, 'emerald');
  assert.equal(storedPick('emerald gem', 'emerald', 'dark'), null);
  assert.equal(pickScheme(list, null, 'emerald', 'light')?.name, 'emerald gem light');
  assert.equal(pickScheme(list, null, 'classic', 'light')?.name, 'emerald light');
});
