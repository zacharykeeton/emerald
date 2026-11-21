import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitProjectCounts } from '../../preload/api.ts';
import { activityStart, agentsText, asOfText, formerText, historyDay, historyText, monthName, projectStart, releasesOf, releasesSince, spanNoteText, spanText, spanTitle, tokensText, usdText, yieldText } from './stats-model.ts';

const counts = (over: Partial<GitProjectCounts>): GitProjectCounts => ({ root: 'C:\\code\\x', branch: 'main', commits: 10, firstCommitAt: null, tags: 0, bumps: 0, bumpsFile: null, ...over });

test('releasesOf counts the tags on the default branch, else the version bumps, and says which (M9 fix 837)', () => {
  assert.deepEqual(releasesOf(counts({ tags: 3, bumps: 26, bumpsFile: 'packages/app/package.json' })), { count: 3, note: 'tags on main' });
  assert.deepEqual(releasesOf(counts({ bumps: 26, bumpsFile: 'packages/app/package.json' })), { count: 26, note: 'version bumps of packages/app/package.json' });
  assert.deepEqual(releasesOf(counts({ bumps: null })), { count: 0, note: 'the version history did not read in 5 s' });
  assert.deepEqual(releasesOf(counts({ branch: 'master' })), { count: 0, note: 'no tags and no version bump on master' });
});

test('spanText counts from the first activity line when it is a later day than the first commit, else from the earlier (M9 fixes 837 and 1190)', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  const commit = new Date(2026, 8, 10, 19, 4).getTime();
  const line = new Date(2026, 8, 11, 9).getTime();
  assert.equal(spanText(commit, line, now), '37 days of activity, from Sep 11 to today');
  assert.equal(spanText(line, commit, now), '38 days, from Sep 10 to today', 'the earlier wins when the line is first');
  assert.equal(spanText(null, line, now), '37 days, from Sep 11 to today');
  assert.equal(spanText(new Date(2026, 9, 17, 8).getTime(), null, now), '1 day, from Oct 17 to today');
  assert.match(spanText(new Date(2025, 11, 30).getTime(), null, now), /, from Dec 30, 2025 to today$/);
  assert.equal(spanText(null, null, now), 'nothing yet');
  assert.equal(spanTitle(commit, line, true, now), 'From the first activity line (Sep 11), later than the first commit (Sep 10); the figures start there');
  assert.equal(spanTitle(line, commit, true, now), 'The earlier of the first commit (Sep 11) and the first activity line (Sep 10)');
  assert.equal(spanTitle(commit, null, true, now), 'The first commit (Sep 10); no activity line for this folder');
  assert.equal(spanTitle(null, line, false, now), 'The first activity line (Sep 11); not a git repository');
});

test('activityStart reaches back to a ledger month before the first line, projectStart keeps the earlier, and spanNoteText names both days only when the figures start later (M9 fix 1190)', () => {
  const now = new Date(2026, 10, 20, 12).getTime();
  const month = (key: string, from: number, to: number, requests: number, usd: number) => ({ month: key, from, to, requests, up: 0, fresh: 0, cacheWrite: 0, cached: 0, down: 0, usd, estimated: false, agentMs: 0, commits: 0, merges: 0, allUsd: usd });
  const sep = new Date(2026, 8, 1).getTime();
  const oct = new Date(2026, 9, 1).getTime();
  const nov = new Date(2026, 10, 1).getTime();
  const firstAt = new Date(2026, 9, 20, 9).getTime();
  const rows = [month('2026-10', oct, nov, 3, 1), month('2026-11', nov, now, 2, 1)];
  assert.equal(activityStart({ firstAt, months: rows }), firstAt, 'months of rows hold firstAt or follow it');
  const ledger = [month('2026-09', sep, oct, 0, 4.5), ...rows];
  assert.equal(activityStart({ firstAt, months: ledger }), sep, "a ledger month with dollars before the first line");
  assert.equal(activityStart({ firstAt, months: [month('2026-09', sep, oct, 0, 0), ...rows] }), firstAt, 'an empty month is not a start');
  assert.equal(activityStart({ firstAt: null, months: ledger }), sep);
  assert.equal(activityStart({ firstAt: null, months: [] }), null);
  const commit = new Date(2026, 8, 10, 19).getTime();
  const line = new Date(2026, 8, 11, 9).getTime();
  assert.equal(projectStart(commit, line), commit);
  assert.equal(projectStart(line, commit), commit);
  assert.equal(projectStart(null, line), line);
  assert.equal(spanNoteText(null, line, now), null, 'no first commit');
  assert.equal(spanNoteText(commit, new Date(2026, 8, 10, 23).getTime(), now), null, "the activity on the first commit's day");
  assert.equal(spanNoteText(line, commit, now), null, 'the activity earlier');
  assert.equal(spanNoteText(commit, line, now), "These figures start on Sep 11, when Emerald first saw work in this folder; the project's commits go back to Sep 10, and nothing before the figures' first day is counted.");
});

test('yieldText prices a release and a hundred commits and counts releases per $1,000, marked when estimated (M9 fix 837)', () => {
  assert.equal(yieldText(5012.33, false, 26, 2930), '$192.78 per release · $171.07 per hundred commits · 5.2 releases per $1,000');
  assert.equal(yieldText(5012.33, false, 0, 2930), '$171.07 per hundred commits · 0.0 releases per $1,000');
  assert.equal(yieldText(5012.33, false, 26, 0), '$192.78 per release · 5.2 releases per $1,000');
  assert.equal(yieldText(5012.33, true, 26, 2930), '~$192.78 per release · ~$171.07 per hundred commits · 5.2 releases per $1,000');
  assert.equal(yieldText(0, false, 26, 2930), 'no spend recorded');
  // M9 fix 885: the thousands marked in the count of releases.
  assert.equal(yieldText(0.65, false, 27, 0), '$0.02 per release · 41,538.5 releases per $1,000');
  assert.equal(yieldText(0.65, false, 27, 0, null), '$0.02 per release · 41,538.5 releases per $1,000');
});

test('the yield from the log\'s first day, the releases since, the as-of time and the log\'s first day (M9 fix 885)', () => {
  const now = new Date(2026, 9, 17, 12).getTime();
  assert.equal(yieldText(5012.33, false, 26, 2930, new Date(2026, 9, 5, 9).getTime(), now), "$192.78 per release · $171.07 per hundred commits · 5.2 releases per $1,000; releases and commits from Oct 5, the log's first day");
  assert.equal(releasesSince(counts({ tags: 3 })), null, 'null without since');
  assert.equal(releasesSince(counts({ tags: 3, since: { from: 1, commits: 5, tags: 2, bumps: 7 } })), 2, 'the tags with tags');
  assert.equal(releasesSince(counts({ tags: 0, bumps: 9, since: { from: 1, commits: 5, tags: 0, bumps: 7 } })), 7, 'the bumps without');
  assert.equal(releasesSince(counts({ tags: 0, bumps: null, since: { from: 1, commits: 5, tags: 0, bumps: null } })), 0);
  assert.equal(asOfText(new Date(2026, 9, 17, 9, 5).getTime()), 'as of 09:05');
  assert.equal(historyDay(new Date(2026, 9, 5, 9).getTime()), new Date(2026, 9, 5).getTime());
  assert.equal(historyDay(null), null);
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

test('agentsText marks where the agents\' count starts only when the span starts on an earlier day (M9 fix 1189)', () => {
  const now = new Date(2026, 10, 20, 12).getTime();
  const from = new Date(2026, 10, 20, 9).getTime();
  assert.equal(agentsText(undefined, new Date(2026, 8, 10).getTime(), now), null, 'an older daemon sends no mark');
  assert.equal(agentsText(from, null, now), null, 'no span');
  assert.equal(agentsText(from, new Date(2026, 10, 20, 7).getTime(), now), null, 'a span from the same day');
  assert.equal(agentsText(from, new Date(2026, 10, 19, 23).getTime(), now), "The agents' requests and tokens are counted from Nov 20; before it, the sessions' own alone");
});

test('formerText names the former folders counted with the folder (M9 fix 1191)', () => {
  assert.equal(formerText(undefined), null);
  assert.equal(formerText([]), null);
  assert.equal(formerText(['C:\\code\\zorca']), 'Counted with its former folder C:\\code\\zorca');
  assert.equal(formerText(['C:\\a', 'C:\\b']), 'Counted with its former folders C:\\a, C:\\b');
});
