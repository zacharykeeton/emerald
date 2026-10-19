import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTabTextKey, fileTextKey, paneScaled, paneTextVars } from './pane-text.ts';
import { PANES, WHATS_NEW_PATH, activityPath, commitsPath, statsPath } from './tabs-model.ts';
import { reviewFolderPath, reviewPath } from './review-model.ts';

test('paneTextVars: nothing at 14 px, the size and its scale against 14 otherwise (M9 fix 899)', () => {
  assert.equal(paneTextVars(14), null);
  assert.deepEqual(paneTextVars(16), { '--pane-text': '16px', '--pane-text-scale': '1.1429' });
  assert.equal(paneTextVars(8)?.['--pane-text-scale'], '0.5714');
});

test('paneScaled: a size at the 14 px base scaled to the pane, rounded (M9 fix 899)', () => {
  assert.equal(paneScaled(13, 14), 13);
  assert.equal(paneScaled(13, 15), 14);
  assert.equal(paneScaled(13, 16), 15);
  assert.equal(paneScaled(13, 8), 7);
});

test('fileTabTextKey: a plain file tab is keyed by its path, the panes and every document of the app have none (M9 fix 899)', () => {
  const file = 'C:\\w\\a.ts';
  assert.equal(fileTabTextKey(file), 'file:C:\\w\\a.ts');
  assert.equal(fileTextKey(file), 'file:C:\\w\\a.ts');
  assert.equal(fileTabTextKey(PANES), null);
  assert.equal(fileTabTextKey(commitsPath('C:\\w')), null);
  assert.equal(fileTabTextKey(statsPath('C:\\w')), null);
  assert.equal(fileTabTextKey(reviewPath('3f2a9c4e-0000-4000-8000-000000000000')), null);
  assert.equal(fileTabTextKey(reviewFolderPath('C:\\w')), null);
  assert.equal(fileTabTextKey(WHATS_NEW_PATH), null);
  assert.equal(fileTabTextKey(activityPath('2026-10-18')), null);
});
