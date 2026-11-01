import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ThemeState } from '../../preload/api.ts';

// The renderer's theme (M9 fix 1032) under fakes for what a window gives
// it: an <html> with a dataset and a window.emerald whose mainTheme answers
// for main, whose setThemePick records what was sent and whose
// onThemeChanged keeps the handler main would call.
const dataset: Record<string, string | undefined> = {};
const g = globalThis as unknown as Record<string, unknown>;
g['document'] = { documentElement: { dataset } };
let mainAnswer: ThemeState = { pick: 'system', theme: 'light' };
let mainThrows = false;
const sent: string[] = [];
let handler: ((s: ThemeState) => void) | null = null;
g['window'] = {
  emerald: {
    mainTheme: () => {
      if (mainThrows) throw new Error('no channel');
      return mainAnswer;
    },
    setThemePick: (p: string) => sent.push(p),
    onThemeChanged: (h: (s: ThemeState) => void) => {
      handler = h;
      return () => undefined;
    },
  },
};

const { getTheme, setThemePick, startTheme, subscribeTheme } = await import('./theme.ts');

test('startTheme shows main answer: light puts data-theme="light" on <html> (M9 fix 1032)', () => {
  startTheme();
  assert.equal(dataset['theme'], 'light');
  assert.deepEqual(getTheme(), { pick: 'system', theme: 'light' });
  assert.ok(handler !== null, 'it follows main');
});

test('main word of dark removes the attribute, updates getTheme and calls a subscriber (M9 fix 1032)', () => {
  let calls = 0;
  const off = subscribeTheme(() => {
    calls += 1;
  });
  handler!({ pick: 'dark', theme: 'dark' });
  off();
  assert.equal('theme' in dataset && dataset['theme'] !== undefined, false);
  assert.deepEqual(getTheme(), { pick: 'dark', theme: 'dark' });
  assert.equal(calls, 1);
});

test('setThemePick sends the pick to main and leaves the page alone (M9 fix 1032)', () => {
  setThemePick('light');
  assert.deepEqual(sent, ['light']);
  assert.equal(dataset['theme'], undefined, 'only main answer moves the page');
});

test('a mainTheme that throws leaves no attribute and the starting state (M9 fix 1032)', () => {
  mainThrows = true;
  mainAnswer = { pick: 'light', theme: 'light' };
  startTheme();
  assert.equal(dataset['theme'], undefined);
  assert.deepEqual(getTheme(), { pick: 'system', theme: 'dark' });
});
