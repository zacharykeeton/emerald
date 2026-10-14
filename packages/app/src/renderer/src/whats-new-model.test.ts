import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOpenWhatsNew, whatsNewStamp } from './whats-new-model.ts';

const two = ['# What\'s new in emerald', '', 'A line about the file.', '', '## Fixes 211 to 227, 2026-09-16', '', 'Newer notes.', '', '## Fixes 195 to 210, 2026-09-15', '', 'Older notes.', ''].join('\n');

test('whatsNewStamp reads the newest section heading and only that (M9 fix 227)', () => {
  assert.equal(whatsNewStamp(two), 'Fixes 211 to 227, 2026-09-16');
  // The title is a level-one heading and is not a section.
  assert.equal(whatsNewStamp("# What's new\n\nno sections yet\n"), null);
  assert.equal(whatsNewStamp(''), null);
  // A CRLF file and trailing spaces read the same.
  assert.equal(whatsNewStamp('# T\r\n\r\n## Fixes 1 to 2, 2026-01-01   \r\n'), 'Fixes 1 to 2, 2026-01-01');
});

test('shouldOpenWhatsNew: a heading the profile has not seen, and never with no heading', () => {
  assert.equal(shouldOpenWhatsNew('Fixes 211 to 227, 2026-09-16', null), true);
  assert.equal(shouldOpenWhatsNew('Fixes 211 to 227, 2026-09-16', 'Fixes 195 to 210, 2026-09-15'), true);
  assert.equal(shouldOpenWhatsNew('Fixes 211 to 227, 2026-09-16', 'Fixes 211 to 227, 2026-09-16'), false);
  assert.equal(shouldOpenWhatsNew(null, null), false);
  assert.equal(shouldOpenWhatsNew(null, 'Fixes 195 to 210, 2026-09-15'), false);
});
