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

test('an uncaught stack line of ours is a note, at either level (M9 fix 1128)', () => {
  const src = 'file:///C:/app/out/renderer/assets/index.js';
  const want = 'renderer: note [emerald] uncaught stack: TypeError: x | at f (a.js:1:2) (file:///C:/app/out/renderer/assets/index.js:7)';
  assert.equal(rendererLogLine('error', '[emerald] uncaught stack: TypeError: x | at f (a.js:1:2)', src, 7), want);
  assert.equal(rendererLogLine('warning', '[emerald] uncaught stack: TypeError: x | at f (a.js:1:2)', src, 7), want);
  assert.equal(rendererLogLine('error', '[emerald] uncaught stacks are here', src, 7), `renderer: error [emerald] uncaught stacks are here (${src}:7)`);
});

test("the WebGL budget's note is a note; a renderer change stays a warning (M9 fix 1130)", () => {
  assert.equal(
    rendererLogLine('warning', '[emerald] terminal webgl: released 4 hidden, took 4 shown, 12 live (mark 12)', 'x.js', 1),
    'renderer: note [emerald] terminal webgl: released 4 hidden, took 4 shown, 12 live (mark 12) (x.js:1)',
  );
  assert.equal(
    rendererLogLine('warning', '[emerald] terminal renderer: dom (context lost, retry 1 of 3 in 1000 ms)', 'x.js', 1),
    'renderer: warning [emerald] terminal renderer: dom (context lost, retry 1 of 3 in 1000 ms) (x.js:1)',
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
