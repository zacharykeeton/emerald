import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_TITLE, PREVIEW_WORD } from './preview-mark.ts';

test('the preview chip says Preview and why', () => {
  assert.equal(PREVIEW_WORD, 'Preview');
  assert.equal(PREVIEW_TITLE, 'The chat view is in progress; the terminal has everything');
});
