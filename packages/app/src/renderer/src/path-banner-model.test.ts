import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_NOTE_LEAD, pathNoteText } from './path-banner-model.ts';

// The PATH banner's sentence (M9 fix 1026), the text the runner's smoke
// (fix 1028) compares whole.
test('pathNoteText is the lead, one space, then the command', () => {
  const command = 'sudo mkdir -p /usr/local/bin && sudo ln -sf "/Applications/Emerald.app/Contents/Resources/bin/emmer" /usr/local/bin/emmer';
  assert.equal(
    pathNoteText(command),
    'emmer is not on your PATH. Paste in a terminal: sudo mkdir -p /usr/local/bin && sudo ln -sf "/Applications/Emerald.app/Contents/Resources/bin/emmer" /usr/local/bin/emmer',
  );
  assert.equal(PATH_NOTE_LEAD, 'emmer is not on your PATH. Paste in a terminal:');
});
