import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_WORD } from './preview-mark.ts';

test('the preview chip says Preview', () => {
  assert.equal(PREVIEW_WORD, 'Preview');
});
