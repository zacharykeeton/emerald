import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USE_FEATURES, USE_NAMES, useLineOf } from './use-record.ts';

test('useLineOf keeps a good line of each ev', () => {
  assert.deepEqual(useLineOf({ ev: 'action', name: 'split-vertical', from: 'key', view: 'empty-pane' }), {
    ev: 'action',
    name: 'split-vertical',
    from: 'key',
    view: 'empty-pane',
  });
  assert.deepEqual(useLineOf({ ev: 'action', name: 'cli-open', from: 'cli' }), { ev: 'action', name: 'cli-open', from: 'cli' });
  assert.deepEqual(useLineOf({ ev: 'view-open', view: 'cheat-sheet' }), { ev: 'view-open', view: 'cheat-sheet' });
  assert.deepEqual(useLineOf({ ev: 'view-close', view: 'file-tab', ms: 1200 }), { ev: 'view-close', view: 'file-tab', ms: 1200 });
});

test('useLineOf keeps the switch line and nothing else of it', () => {
  assert.deepEqual(useLineOf({ ev: 'switch', on: true }), { ev: 'switch', on: true });
  assert.deepEqual(useLineOf({ ev: 'switch', on: false }), { ev: 'switch', on: false });
  assert.equal(useLineOf({ ev: 'switch' }), null);
  assert.equal(useLineOf({ ev: 'switch', on: 'yes' }), null);
  assert.deepEqual(useLineOf({ ev: 'switch', on: true, path: 'C:/x' }), { ev: 'switch', on: true });
});

test('useLineOf refuses an unknown ev, name, from or view', () => {
  assert.equal(useLineOf({ ev: 'typed', name: 'split-vertical', from: 'key' }), null);
  assert.equal(useLineOf({ ev: 'action', name: 'rm -rf', from: 'key' }), null);
  assert.equal(useLineOf({ ev: 'action', name: 'split-vertical', from: 'mouse' }), null);
  assert.equal(useLineOf({ ev: 'action', name: 'split-vertical', from: 'key', view: 'C:/secret' }), null);
  assert.equal(useLineOf({ ev: 'view-open', view: 'nope' }), null);
  assert.equal(useLineOf(null), null);
  assert.equal(useLineOf('split-vertical'), null);
});

test('useLineOf refuses a negative, fractional or huge ms', () => {
  assert.equal(useLineOf({ ev: 'view-close', view: 'file-tab', ms: -1 }), null);
  assert.equal(useLineOf({ ev: 'view-close', view: 'file-tab', ms: 1.5 }), null);
  assert.equal(useLineOf({ ev: 'view-close', view: 'file-tab', ms: 2 ** 31 + 1 }), null);
  assert.equal(useLineOf({ ev: 'view-close', view: 'file-tab' }), null);
});

test('useLineOf drops an extra text field and keeps the line', () => {
  const line = useLineOf({ ev: 'action', name: 'find', from: 'key', text: 'my password' });
  assert.notEqual(line, null);
  assert.deepEqual(Object.keys(line!).sort(), ['ev', 'from', 'name']);
  const close = useLineOf({ ev: 'view-close', view: 'review-tab', ms: 5, path: 'C:/x' });
  assert.deepEqual(Object.keys(close!).sort(), ['ev', 'ms', 'view']);
});

test('M9 fix 727: a drop on the strip or the rail and a drop on a session pane are known actions', () => {
  assert.notEqual(useLineOf({ ev: 'action', name: 'drop-file-tab', from: 'click' }), null);
  assert.notEqual(useLineOf({ ev: 'action', name: 'drop-path', from: 'click' }), null);
});

test('USE_FEATURES names are unique', () => {
  assert.equal(USE_NAMES.size, USE_FEATURES.length);
});
