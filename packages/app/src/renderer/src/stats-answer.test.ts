import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityTotals, ActivityTotalsPart } from '@emerald/shared';
import type { GitProjectCounts } from '../../preload/api.ts';
import { askDue, countAsk, keepAnswer, keptAnswer, noteAsk, onAnswer, resetStatsAnswers, statsCounts, statsSheet } from './stats-answer.ts';
import type { StatsAnswer } from './stats-answer.ts';
import { statsFigures } from './stats-model.ts';

const part = (month: string | null, requests: number): ActivityTotalsPart => ({
  month,
  from: 0,
  to: 0,
  requests,
  up: requests * 10,
  fresh: requests,
  cacheWrite: 0,
  cached: 0,
  down: requests * 5,
  usd: requests / 10,
  estimated: false,
  agentMs: requests * 1000,
  commits: 1,
  merges: 0,
  allUsd: requests / 10,
});

const totals: ActivityTotals = { folder: 'C:\\x', from: 0, to: 0, total: part(null, 30), months: [part('2026-09', 10), part('2026-10', 20)], firstAt: 1_000, historyFrom: 1_000 };
const counts: GitProjectCounts = { root: 'C:\\x', branch: 'main', commits: 10, firstCommitAt: null, tags: 2, bumps: 0, bumpsFile: null };
const answer = (at: number): StatsAnswer => ({ totals, counts, now: at, at });

test('askDue is 0 with no answer and the rest of the minute with one, the key folding case and slashes (M9 fix 885)', () => {
  resetStatsAnswers();
  assert.equal(askDue('C:\\x', 1_000_000), 0);
  const a = answer(1_000_000);
  keepAnswer('C:\\x', a);
  assert.equal(askDue('C:\\x', 1_010_000), 50_000);
  assert.equal(askDue('C:\\x', 1_060_000), 0);
  assert.equal(keptAnswer('c:/X/'), a);
});

test('askDue counts from the later of the last ask started on the folder and the kept answer (M9 fix 942)', () => {
  resetStatsAnswers();
  keepAnswer('C:\\x', answer(1_000_000));
  noteAsk('c:/X/', 1_040_000);
  assert.equal(askDue('C:\\x', 1_061_000), 39_000);
  assert.equal(askDue('C:\\x', 1_100_000), 0);
  resetStatsAnswers();
  noteAsk('C:\\x', 2_000_000);
  assert.equal(askDue('C:\\x', 2_010_000), 50_000, 'an ask in flight with nothing kept yet');
  assert.equal(askDue('C:\\y', 2_010_000), 0);
});

test('keepAnswer hands the answer to every listener on the folder until it unsubscribes (M9 fix 942)', () => {
  resetStatsAnswers();
  const heard: string[] = [];
  const offA = onAnswer('C:\\x', (a) => heard.push(`a${a.at}`));
  onAnswer('c:/X/', (a) => heard.push(`b${a.at}`));
  onAnswer('C:\\y', (a) => heard.push(`y${a.at}`));
  keepAnswer('C:\\x', answer(1));
  offA();
  keepAnswer('C:\\x', answer(2));
  assert.deepEqual(heard, ['a1', 'b1', 'b2']);
  resetStatsAnswers();
  keepAnswer('C:\\x', answer(3));
  assert.deepEqual(heard, ['a1', 'b1', 'b2'], 'a reset drops the listeners');
});

test('statsSheet computes once per answer and counts only a computation; asks count per folder (M9 fix 885)', () => {
  resetStatsAnswers();
  const a = answer(5);
  const first = statsSheet('C:\\x', a);
  assert.equal(statsSheet('C:\\x', a), first);
  assert.equal(statsCounts('C:\\x').sheets, 1);
  statsSheet('C:\\x', answer(6));
  assert.equal(statsCounts('C:\\x').sheets, 2);
  countAsk('C:\\x');
  countAsk('C:\\x');
  assert.equal(statsCounts('C:\\x').asks, 2);
  assert.deepEqual(statsCounts('C:\\y'), { asks: 0, sheets: 0 });
});

test('the sheet holds the figures and the months newest first (M9 fix 885)', () => {
  resetStatsAnswers();
  const sheet = statsSheet('C:\\x', answer(5));
  assert.deepEqual(sheet.figures, statsFigures(totals, counts));
  assert.deepEqual(
    sheet.months.map((m) => m.month),
    ['2026-10', '2026-09'],
  );
  assert.equal(sheet.releases, 2);
});
