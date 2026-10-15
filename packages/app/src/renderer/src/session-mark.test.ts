import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEM_FRAMES, GEM_STILL, MARK_FRAMES, markGlyphs } from './session-mark-glyphs.ts';

test('the Emerald frames are the four gem glyphs in order, and its still is the filled gem', () => {
  assert.deepEqual([...GEM_FRAMES], ['◇', '◈', '◆', '✦']);
  assert.deepEqual(
    GEM_FRAMES.map((g) => g.codePointAt(0)),
    [0x25c7, 0x25c8, 0x25c6, 0x2726],
  );
  assert.equal(GEM_STILL, '◆');
  assert.equal(GEM_STILL.codePointAt(0), 0x25c6);
  assert.deepEqual(markGlyphs('emerald'), { frames: GEM_FRAMES, still: '◆' });
});

test("Classic keeps Claude Code's four asterisks and the star SVG", () => {
  assert.deepEqual([...MARK_FRAMES], ['✳', '✱', '✻', '✽']);
  assert.deepEqual(markGlyphs('classic'), { frames: MARK_FRAMES, still: null });
});
