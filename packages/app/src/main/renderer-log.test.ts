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
