import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLOR_FLOOR, SESSION_COLORS, SESSION_COLOR_NAMES, colorDistance, colorForKey, farthestSessionColor, hexOfOklab, hueOf, isSessionColor, oklabOf, parseSessionColor, pickSessionColor } from './session.ts';

test('the palette is twelve distinct lower-case hex colours', () => {
  assert.equal(SESSION_COLORS.length, 12);
  assert.equal(new Set(SESSION_COLORS).size, 12);
  for (const c of SESSION_COLORS) assert.ok(isSessionColor(c), c);
});

test('the palette is measured: two lightness rings, hues thirty degrees apart, no pair closer than the floor', () => {
  // What scripts/palette.mjs printed for 0.66,0.78 and 12: chroma
  // 0.1102 and 0.1088, the smallest pairwise OKLab distance 0.1088
  // (hues 168 and 228). The hex rounding moves each by a hair (the
  // smallest pair lands at 0.1079, violet and magenta), so the checks
  // allow a little; the floor is what a 2px lane reads as one colour,
  // which M68's twenty-four at 0.079 did (M9 fix 133).
  const rings = [0.66, 0.78];
  const hues = SESSION_COLORS.map(hueOf);
  for (let i = 0; i < hues.length; i++) {
    const [l] = oklabOf(SESSION_COLORS[i]!);
    assert.ok(Math.abs(l - rings[i % 2]!) < 0.01, `${SESSION_COLORS[i]} lightness ${l}`);
    const next = hues[(i + 1) % hues.length]!;
    const gap = (next - hues[i]! + 360) % 360;
    assert.ok(Math.abs(gap - 30) < 1.5, `${SESSION_COLORS[i]} to the next: ${gap} degrees`);
  }
  let min = Infinity;
  for (let i = 0; i < SESSION_COLORS.length; i++) for (let j = i + 1; j < SESSION_COLORS.length; j++) min = Math.min(min, colorDistance(SESSION_COLORS[i]!, SESSION_COLORS[j]!));
  assert.ok(min > 0.107, `smallest pairwise distance ${min}`);
  assert.ok(min > COLOR_FLOOR, 'every pair of the palette tells apart on a lane');
  assert.ok(COLOR_FLOOR > 0.077, 'the floor is above the old eight, whose worst pair read as one colour');
});

test('isSessionColor takes the shape only', () => {
  assert.ok(isSessionColor('#0a0b0c'));
  assert.ok(!isSessionColor('#0A0B0C'), 'upper case is not the shape the daemon writes');
  assert.ok(!isSessionColor('#abc'));
  assert.ok(!isSessionColor('red'));
  assert.ok(!isSessionColor(null));
  assert.ok(!isSessionColor(7));
  // A hex from an older palette is still a colour: a stored one stays.
  assert.ok(isSessionColor('#bc6b6e'));
});

test('pickSessionColor avoids the colours already taken', () => {
  const taken = SESSION_COLORS.slice(0, 11);
  assert.equal(pickSessionColor(taken), SESSION_COLORS[11], 'the one free colour');
  // A null (a daemon older than M24 has none) is not a colour and takes nothing.
  assert.equal(pickSessionColor([...taken, null]), SESSION_COLORS[11]);
});

test('pickSessionColor with no peers keeps each new colour far in OKLab from the ones in use', () => {
  // Thirty degrees apart on two rings, so the picks go far round the
  // circle first and a hue neighbour comes last; the hex rounding
  // breaks the ties, so the order is recorded, not derived.
  const by = (name: string) => SESSION_COLOR_NAMES[name]!;
  const [red, teal, blue] = ['red', 'teal', 'blue'].map(by);
  assert.equal(pickSessionColor([]), red, 'nothing in use, the first colour');
  assert.equal(pickSessionColor([red]), teal, 'the far side of the circle from red');
  assert.equal(pickSessionColor([red, teal]), blue, 'far from both');
  const order = ['green', 'orange', 'violet', 'cyan', 'amber', 'lilac', 'sky', 'olive', 'magenta'].map(by);
  const picked = [red, teal, blue];
  for (const next of order) {
    assert.equal(pickSessionColor(picked), next);
    picked.push(next);
  }
  // Twelve picks in a row cover the palette, the first six pairwise
  // well above the floor, and hue neighbours never meet as the first
  // two: red then pink was the case seen (M9 fix 54).
  assert.deepEqual([...picked].sort(), [...SESSION_COLORS].sort());
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(colorDistance(picked[i]!, picked[j]!) > 0.13, `${picked[i]} and ${picked[j]} among the first six`);
  assert.notEqual(pickSessionColor([red]), by('magenta'));
  assert.notEqual(pickSessionColor([by('magenta')]), red);
  assert.notEqual(pickSessionColor([by('orange')]), by('amber'));
  assert.notEqual(pickSessionColor([by('teal')]), by('cyan'));
});

test('pickSessionColor with peers keeps the colours on one screen apart, and never repeats a peer while a colour is free', () => {
  const by = (name: string) => SESSION_COLOR_NAMES[name]!;
  // Six sessions started one after another in one repository, each a
  // peer of the ones before: every pair of the six is above the floor,
  // and no colour repeats.
  const picked: string[] = [];
  for (let i = 0; i < 6; i++) picked.push(pickSessionColor(picked, picked));
  assert.equal(new Set(picked).size, 6);
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) assert.ok(colorDistance(picked[i]!, picked[j]!) > COLOR_FLOOR, `${picked[i]} and ${picked[j]}`);
  // The peers come first: with red and teal taken and only red on this
  // screen, the pick is the free colour farthest from red alone.
  const farFromRed = pickSessionColor([by('red'), by('teal')], [by('red')]);
  const freeOnes = SESSION_COLORS.filter((c) => c !== by('red') && c !== by('teal'));
  assert.ok(freeOnes.includes(farFromRed), 'a free colour');
  assert.ok(colorDistance(farFromRed, by('red')) >= Math.max(...freeOnes.map((c) => colorDistance(c, by('red')))) - 1e-9, `the free colour farthest from the peer, got ${farFromRed}`);
  // Every colour taken by peers: the pool is the whole palette, a peer's
  // colour counts its own entry, so every colour is as close as any and
  // the palette's first wins; every colour taken by others, none a peer,
  // and the most isolated is repeated as before.
  assert.equal(pickSessionColor(SESSION_COLORS, SESSION_COLORS), SESSION_COLORS[0]);
  assert.equal(pickSessionColor(SESSION_COLORS, []), pickSessionColor(SESSION_COLORS));
  // Eleven taken and one free: the free one wins even when a peer that
  // is not in the taken list wears it, since the pool is what is free.
  assert.equal(pickSessionColor(SESSION_COLORS.slice(0, 11), [SESSION_COLORS[11]!]), SESSION_COLORS[11]);
  // Eleven taken, one of them a peer's, and the free one is the peer's
  // hue neighbour: still the free one, a repeat is worse than a neighbour.
  assert.equal(pickSessionColor(SESSION_COLORS.filter((c) => c !== by('orange')), [by('red')]), by('orange'));
  // With no peers at all the rule is the no-peers one.
  assert.equal(pickSessionColor([by('red')], []), pickSessionColor([by('red')]));
  assert.equal(pickSessionColor([by('red')], [null]), pickSessionColor([by('red')]));
});

test('pickSessionColor repeats a colour once every colour is taken', () => {
  assert.ok((SESSION_COLORS as readonly string[]).includes(pickSessionColor(SESSION_COLORS)));
});

test('hueOf and oklabOf measure in OKLCH', () => {
  // The primaries' OKLCH hues, as CSS oklch() has them.
  assert.ok(Math.abs(hueOf('#ff0000') - 29.2) < 0.2);
  assert.ok(Math.abs(hueOf('#00ff00') - 142.5) < 0.2);
  assert.ok(Math.abs(hueOf('#0000ff') - 264.1) < 0.2);
  assert.equal(hueOf('#808080'), 0, 'a grey has no hue');
  assert.ok(Math.abs(oklabOf('#ffffff')[0] - 1) < 0.001, 'white is lightness 1');
  assert.ok(Math.abs(oklabOf('#000000')[0]) < 0.001, 'black is lightness 0');
  assert.equal(colorDistance('#cd7578', '#cd7578'), 0);
  // The old palette's worst pair, teal and blue, sat closer than any pair
  // of the new one, and under the floor.
  assert.ok(colorDistance('#56b6c2', '#61afef') < COLOR_FLOOR);
  // M68's violet, purple and lilac, three of the ones that read as one
  // block, sit under 0.1 apart in turn.
  assert.ok(colorDistance('#837cc1', '#ad8cda') < 0.1);
  assert.ok(colorDistance('#ad8cda', '#d5a1e5') < 0.1);
});

test('the names cover the palette once each', () => {
  const named = Object.values(SESSION_COLOR_NAMES);
  assert.deepEqual(named, [...SESSION_COLORS]);
  assert.equal(Object.keys(SESSION_COLOR_NAMES).length, 12);
});

test('parseSessionColor takes a name or a hex in either case', () => {
  assert.equal(parseSessionColor('teal'), '#69ceaa');
  assert.equal(parseSessionColor('plum'), null, 'a name of the twenty-four and not the twelve is unknown');
  // Object.prototype's names are no colours (M9 fix 510).
  assert.equal(parseSessionColor('constructor'), null);
  assert.equal(parseSessionColor('__proto__'), null);
  assert.equal(parseSessionColor(' Red '), '#cd7578');
  assert.equal(parseSessionColor('#E06C75'), '#e06c75');
  assert.equal(parseSessionColor('#0a0b0c'), '#0a0b0c', 'a hex off the palette is still a colour');
  assert.equal(parseSessionColor('#ab6ea1'), '#ab6ea1', 'a hex of the twenty-four is still a colour, so a stored one stays');
  assert.equal(parseSessionColor('mauve'), null);
  assert.equal(parseSessionColor('#abc'), null);
  assert.equal(parseSessionColor(''), null);
});

test('colorForKey (M70): the same key gives the same palette colour every time, and keys spread over the palette', () => {
  assert.equal(colorForKey('conv-1'), colorForKey('conv-1'));
  assert.ok(SESSION_COLORS.includes(colorForKey('conv-1')));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => colorForKey(`transcript-${i}`)));
  assert.ok(seen.size > 6, `200 keys land on more than half the palette, got ${seen.size}`);
});

test('farthestSessionColor (M9 fix 133): the palette colour farthest from every colour in use, the key colour with none, ties walked from the key', () => {
  const by = (name: string) => SESSION_COLOR_NAMES[name]!;
  assert.equal(farthestSessionColor([], by('lilac')), by('lilac'), 'nothing in use, the key colour itself');
  assert.equal(farthestSessionColor([by('red')], by('red')), pickSessionColor([by('red')]), 'one colour in use, the same far colour the pick finds');
  const far = farthestSessionColor([by('red'), by('teal')], by('red'));
  assert.ok(colorDistance(far, by('red')) > 0.15 && colorDistance(far, by('teal')) > 0.15, `far from both: ${far}`);
  assert.ok((SESSION_COLORS as readonly string[]).includes(farthestSessionColor(SESSION_COLORS, by('red'))), 'every colour in use still gives a palette colour');
  // An off-palette colour in use (a hex from an older palette) is
  // measured like any other, and a start off the palette walks from
  // the top.
  assert.ok((SESSION_COLORS as readonly string[]).includes(farthestSessionColor(['#61afef'], '#61afef')));
  // Two keys landing on different palette colours with the same colours
  // in use can end on different ones only by the tie walk, and the same
  // key always ends on the same one.
  assert.equal(farthestSessionColor([by('red'), by('cyan')], by('olive')), farthestSessionColor([by('red'), by('cyan')], by('olive')));
});

test('hexOfOklab is the way back from oklabOf, and fits a colour outside sRGB by chroma alone', () => {
  for (const hex of SESSION_COLORS) assert.equal(hexOfOklab(...oklabOf(hex)), hex, `${hex} round-trips`);
  assert.equal(hexOfOklab(1, 0, 0), '#ffffff');
  assert.equal(hexOfOklab(0, 0, 0), '#000000');
  // The palette's red lifted to lightness 0.95 has no room for its
  // chroma: the result is lighter, keeps the hue and is inside sRGB.
  const [, a, b] = oklabOf('#cd7578');
  const light = hexOfOklab(0.95, a, b);
  assert.ok(/^#[0-9a-f]{6}$/.test(light));
  assert.ok(Math.abs(oklabOf(light)[0] - 0.95) < 0.01, `lightness kept (${oklabOf(light)[0]})`);
  assert.ok(Math.abs(hueOf(light) - hueOf('#cd7578')) < 2, `hue kept (${hueOf(light)})`);
});
