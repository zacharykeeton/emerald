import { test } from 'node:test';
import assert from 'node:assert/strict';

// The renderer's skin (M9 fix 569) under fakes for what a window gives it:
// a Map-backed localStorage holding Emerald, an <html> with a dataset, and
// the preload's setSkin recording what main was told. The fakes go on
// before the import, since skin.ts reads the stored skin at module load.
const store = new Map<string, string>([['emerald.skin', 'emerald']]);
let throwOnGet = false;
const sent: string[] = [];
const dataset: Record<string, string | undefined> = {};
const g = globalThis as unknown as Record<string, unknown>;
g['localStorage'] = {
  getItem: (k: string) => {
    if (throwOnGet) throw new Error('denied');
    return store.get(k) ?? null;
  },
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
g['document'] = { documentElement: { dataset } };
// main's answer when nothing is stored (M9 fix 628), and whether asking
// throws, as a window from before the channel would.
let mainAnswer = 'emerald';
let mainThrows = false;
g['window'] = {
  emerald: {
    setSkin: (s: string) => sent.push(s),
    mainSkin: () => {
      if (mainThrows) throw new Error('no channel');
      return mainAnswer;
    },
  },
};

const { SKIN_KEY, getSkin, loadSkin, setSkin, subscribeSkin } = await import('./skin.ts');
const { otherWindowWrote } = await import('./other-window.ts');

test('the stored skin is read at module load', () => {
  assert.equal(getSkin(), 'emerald');
});

test("loadSkin: a stored skin by its exact name, main's answer otherwise, Emerald when main cannot answer (M9 fix 628)", () => {
  store.set(SKIN_KEY, 'emerald');
  mainAnswer = 'classic';
  assert.equal(loadSkin(), 'emerald', 'stored emerald is Emerald');
  store.set(SKIN_KEY, 'classic');
  mainAnswer = 'emerald';
  assert.equal(loadSkin(), 'classic', 'stored classic is Classic whatever main says');
  store.delete(SKIN_KEY);
  assert.equal(loadSkin(), 'emerald', "nothing stored is main's answer, Emerald");
  mainAnswer = 'classic';
  assert.equal(loadSkin(), 'classic', "nothing stored is main's answer, Classic");
  store.set(SKIN_KEY, 'pink');
  assert.equal(loadSkin(), 'classic', "any other value is main's answer");
  throwOnGet = true;
  mainAnswer = 'emerald';
  assert.equal(loadSkin(), 'emerald', "a throw reading localStorage is main's answer");
  throwOnGet = false;
  store.delete(SKIN_KEY);
  mainThrows = true;
  assert.equal(loadSkin(), 'emerald', 'a main that cannot answer is Emerald');
  mainThrows = false;
  store.set(SKIN_KEY, 'emerald');
});

test('setSkin puts the skin on <html>, stores it, tells main and calls subscribers', () => {
  sent.length = 0;
  let calls = 0;
  const remove = subscribeSkin(() => {
    calls += 1;
  });
  setSkin('emerald');
  assert.equal(dataset['skin'], 'emerald');
  assert.equal(store.get(SKIN_KEY), 'emerald');
  assert.deepEqual(sent, ['emerald']);
  assert.equal(calls, 1);
  assert.equal(getSkin(), 'emerald');

  setSkin('classic');
  assert.ok(!('skin' in dataset), 'data-skin is gone under Classic');
  assert.equal(store.get(SKIN_KEY), 'classic');
  assert.deepEqual(sent, ['emerald', 'classic']);
  assert.equal(calls, 2);

  remove();
  setSkin('emerald');
  assert.equal(calls, 2, 'the remover stops the calls');
  setSkin('classic');
});

test('a skin another window stored is shown here without storing it or telling main (M9 fix 925)', () => {
  setSkin('emerald');
  sent.length = 0;
  let calls = 0;
  const remove = subscribeSkin(() => {
    calls += 1;
  });
  store.set(SKIN_KEY, 'classic');
  otherWindowWrote(SKIN_KEY, 'classic');
  assert.equal(getSkin(), 'classic');
  assert.ok(!('skin' in dataset), 'data-skin is gone under Classic');
  assert.deepEqual(sent, [], 'main is not told again');
  assert.equal(calls, 1);
  otherWindowWrote(SKIN_KEY, 'pink');
  otherWindowWrote(SKIN_KEY, null);
  assert.equal(getSkin(), 'classic');
  assert.equal(calls, 1, 'an unknown or removed value calls nobody');
  remove();
});
