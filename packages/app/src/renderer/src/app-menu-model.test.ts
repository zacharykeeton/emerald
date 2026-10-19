import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appMenuItems } from './app-menu-model.ts';
import type { UpdateState } from './update-model.ts';

test('appMenuItems: Open a file (M9 fix 341, its chord since fix 364), then What\'s new with the version, the cheat sheet and the palette with their keys (M9 fix 234)', () => {
  const items = appMenuItems('0.1.228');
  assert.deepEqual(
    items.map((i) => [i.action, i.label, i.hint]),
    [
      ['open-file', 'Open a file…', 'Ctrl+Shift+G'],
      ['whats-new', "What's new", '0.1.228'],
      ['cheat-sheet', 'Key cheat sheet', 'Ctrl+Shift+?'],
      ['open-actions', 'Run an action…', 'Ctrl+Shift+P'],
      ['toggle-skin', 'Skin: Classic', ''],
      ['toggle-usage-record', 'Usage record: off', ''],
      ['check-updates', 'Check for updates', ''],
    ],
  );
  // Before the main process has said the version the hint is empty, not "null".
  assert.equal(appMenuItems(null)[1]!.hint, '');
});

// The check item's hint is the updater's phase (M9 fix 239), and the item
// is disabled until the updater has answered and while it is off.
test('appMenuItems: Check for updates reads the updater and is off in a build with no updater (M9 fix 239)', () => {
  const state = (phase: UpdateState['phase'], latest: string | null = null, percent: number | null = null, message: string | null = null): UpdateState => ({ phase, current: '0.1.228', latest, percent, message });
  const check = (update: UpdateState | null) => appMenuItems('0.1.228', update).at(-1)!;
  assert.deepEqual([check(null).hint, check(null).disabled], ['', true]);
  assert.deepEqual([check(state('off')).hint, check(state('off')).disabled], ['off in this build', true]);
  assert.deepEqual([check(state('idle')).hint, check(state('idle')).disabled], ['', false]);
  assert.equal(check(state('idle', '0.1.228')).hint, 'up to date');
  // The last check's outcome on idle (M9 fix 242).
  assert.equal(check(state('idle', null, null, 'no feed at 127.0.0.1:7420')).hint, 'no feed at 127.0.0.1:7420');
  assert.equal(check(state('idle', '0.1.228', null, 'checked 18:43, up to date')).hint, 'checked 18:43, up to date');
  assert.equal(check(state('checking')).hint, 'checking…');
  assert.equal(check(state('available', '0.1.240')).hint, 'retry 0.1.240');
  assert.equal(check(state('downloading', '0.1.240', 42)).hint, 'downloading 42%');
  assert.equal(check(state('ready', '0.1.240')).hint, 'restart to update');
  assert.equal(check(state('error')).hint, 'failed, try again');
});

test('appMenuItems: the skin item names the skin on show, before Check for updates (M9 fix 569)', () => {
  const emerald = appMenuItems('0.1.228', null, 'emerald');
  assert.deepEqual([emerald[4]!.action, emerald[4]!.label, emerald[4]!.hint], ['toggle-skin', 'Skin: Emerald', '']);
  assert.equal(appMenuItems('0.1.228')[4]!.label, 'Skin: Classic');
  assert.equal(appMenuItems('0.1.228', null, 'classic')[4]!.label, 'Skin: Classic');
  assert.equal(emerald.at(-1)!.action, 'check-updates');
  assert.equal(appMenuItems('0.1.228').at(-1)!.action, 'check-updates');
});

test('appMenuItems: the usage record item names its state, after the skin and before Check for updates (M9 fix 887)', () => {
  const off = appMenuItems('0.1.228');
  assert.deepEqual([off[5]!.action, off[5]!.label, off[5]!.hint], ['toggle-usage-record', 'Usage record: off', '']);
  assert.ok(off[5]!.title!.endsWith('Click to turn it on'));
  const on = appMenuItems('0.1.228', null, 'classic', true);
  assert.equal(on[5]!.label, 'Usage record: on');
  assert.ok(on[5]!.title!.endsWith('Click to turn it off'));
  assert.equal(off.at(-1)!.action, 'check-updates');
  assert.equal(on.at(-1)!.action, 'check-updates');
});
