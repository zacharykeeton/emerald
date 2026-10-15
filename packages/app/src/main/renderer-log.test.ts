import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendererLogLine } from './renderer-log.ts';

test('an emerald line keeps its own prefix, the source and line kept after it (M9 fix 424)', () => {
  assert.equal(
    rendererLogLine('warning', '[emerald] terminal renderer: dom (context lost)', 'file:///app/index.js', 12),
    'renderer: warning [emerald] terminal renderer: dom (context lost) (file:///app/index.js:12)',
  );
});

test('a line with no emerald prefix is marked [lib], the source and line kept the same way', () => {
  assert.equal(
    rendererLogLine('error', 'Cannot destructure property x', 'file:///app/vendor.js', 4),
    'renderer: error [lib] Cannot destructure property x (file:///app/vendor.js:4)',
  );
});

// M9 fix 694: Electron's own line at each browser pane's close is a note.
test("Electron's Invalid guestInstanceId at a webview's teardown is a note; the same words elsewhere stay an error", () => {
  assert.equal(
    rendererLogLine('error', 'Uncaught Error: Invalid guestInstanceId: 2', 'node:electron/js2c/isolated_bundle', 2),
    'renderer: note [lib] Uncaught Error: Invalid guestInstanceId: 2 (node:electron/js2c/isolated_bundle:2)',
  );
  assert.equal(
    rendererLogLine('error', 'Uncaught Error: Invalid guestInstanceId: 2', 'file:///app/index.js', 2),
    'renderer: error [lib] Uncaught Error: Invalid guestInstanceId: 2 (file:///app/index.js:2)',
  );
  assert.equal(
    rendererLogLine('error', 'Uncaught Error: something else', 'node:electron/js2c/isolated_bundle', 2),
    'renderer: error [lib] Uncaught Error: something else (node:electron/js2c/isolated_bundle:2)',
  );
});
