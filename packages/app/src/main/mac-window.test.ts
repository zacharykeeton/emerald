import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME } from './skin.ts';
import { menuHead, titleBarOptions, TRAFFIC_LIGHTS } from './mac-window.ts';

// The window's title row per platform (M9 fix 1023): the overlay off a
// Mac exactly as before, the traffic lights' place on one with no overlay
// key at all, and the app menu first on a Mac alone.
test('titleBarOptions: the overlay on win32 and linux, key for key as before', () => {
  const overlay = { titleBarOverlay: { color: '#1c211f', symbolColor: '#9a9a9a', height: 26 } };
  assert.deepEqual(titleBarOptions(CHROME.emerald.dark, 'win32'), overlay);
  assert.deepEqual(titleBarOptions(CHROME.emerald.dark, 'linux'), overlay);
});

test('titleBarOptions: on darwin the traffic lights centred on the 26 px row, and no overlay', () => {
  const o = titleBarOptions(CHROME.emerald.dark, 'darwin');
  assert.deepEqual(o, { trafficLightPosition: { x: 12, y: 6 } });
  assert.equal('titleBarOverlay' in o, false);
  assert.deepEqual(TRAFFIC_LIGHTS, { x: 12, y: 6 });
});

test('menuHead: appMenu first on darwin, nothing elsewhere', () => {
  assert.deepEqual(menuHead('darwin'), [{ role: 'appMenu' }]);
  assert.deepEqual(menuHead('win32'), []);
  assert.deepEqual(menuHead('linux'), []);
});
