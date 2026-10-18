import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitProjectCounts } from '../../preload/api.ts';
import { historyText, monthName, releasesOf, spanText, spanTitle, tokensText, usdText, yieldText } from './stats-model.ts';

const counts = (over: Partial<GitProjectCounts>): GitProjectCounts => ({ root: 'C:\\code\\x', branch: 'main', commits: 10, firstCommitAt: null, tags: 0, bumps: 0, bumpsFile: null, ...over });

test('releasesOf counts the tags on the default branch, else the version bumps, and says which (M9 fix 837)', () => {
  assert.deepEqual(releasesOf(counts({ tags: 3, bumps: 26, bumpsFile: 'packages/app/package.json' })), { count: 3, note: 'tags on main' });
  assert.deepEqual(releasesOf(counts({ bumps: 26, bumpsFile: 'packages/app/package.json' })), { count: 26, note: 'version bumps of packages/app/package.json' });
  assert.deepEqual(releasesOf(counts({ bumps: null })), { count: 0, note: 'the version history did not read in 5 s' });
  assert.deepEqual(releasesOf(counts({ branch: 'master' })), { count: 0, note: 'no tags and no version bump on master' });
});

test('spanText counts the local days from the earlier start to today, the year when it is not this one (M9 fix 837)', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const commit = new Date(2026, 8, 10, 19, 4).getTime();
  const line = new Date(2026, 8, 11, 9).getTime();
  assert.equal(spanText(commit, line, now), '38 days, from Sep 10 to today');
  assert.equal(spanText(line, commit, now), '38 days, from Sep 10 to today', 'the earlier wins either way');
  assert.equal(spanText(null, line, now), '37 days, from Sep 11 to today');
  assert.equal(spanText(new Date(2026, 9, 17, 8).getTime(), null, now), '1 day, from Oct 17 to today');
  assert.match(spanText(new Date(2025, 11, 30).getTime(), null, now), /, from Dec 30, 2025 to today$/);
  assert.equal(spanText(null, null, now), 'nothing yet');
  assert.equal(spanTitle(commit, line, true, now), 'The earlier of the first commit (Sep 10) and the first activity line (Sep 11)');
  assert.equal(spanTitle(commit, null, true, now), 'The first commit (Sep 10); no activity line for this folder');
  assert.equal(spanTitle(null, line, false, now), 'The first activity line (Sep 11); not a git repository');
});

test('yieldText prices a release and a hundred commits and counts releases per $1,000, marked when estimated (M9 fix 837)', () => {
  assert.equal(yieldText(5012.33, false, 26, 2930), '$192.78 per release · $171.07 per hundred commits · 5.2 releases per $1,000');
  assert.equal(yieldText(5012.33, false, 0, 2930), '$171.07 per hundred commits · 0.0 releases per $1,000');
  assert.equal(yieldText(5012.33, false, 26, 0), '$192.78 per release · 5.2 releases per $1,000');
  assert.equal(yieldText(5012.33, true, 26, 2930), '~$192.78 per release · ~$171.07 per hundred commits · 5.2 releases per $1,000');
  assert.equal(yieldText(0, false, 26, 2930), 'no spend recorded');
});

test('the figures\' formatters: dollars with thousands, billions of tokens, a month by name (M9 fix 837)', () => {
  assert.equal(usdText(5012.333, false), '$5,012.33');
  assert.equal(usdText(5012.333, true), '~$5,012.33');
  assert.equal(tokensText(3_200_000_000), '3.2B');
  assert.equal(tokensText(3_000_000_000), '3B');
  assert.equal(tokensText(844_700), '844.7k');
  assert.equal(monthName('2026-10'), 'Oct 2026');
});

test('historyText says where the log starts, and that the figures stop there when the span starts earlier (M9 fix 837)', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const from = new Date(2026, 9, 5, 9).getTime();
  assert.equal(historyText(from, new Date(2026, 9, 5, 7).getTime(), now), 'history from Oct 5');
  assert.equal(historyText(from, new Date(2026, 8, 10).getTime(), now), 'history from Oct 5; the requests, tokens, price and agent time before it are not in the log');
  assert.equal(historyText(null, null, now), 'no activity log yet');
});
