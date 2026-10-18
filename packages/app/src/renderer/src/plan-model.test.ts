import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MS_PER_MONTH, paidOver, paidShare, paidText, paidTitle, parsePlan, planEntryText, withPlanEntry, withoutPlanEntry } from './plan-model.ts';
import type { PlanEntry } from './plan-model.ts';

const t = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

test('paidOver prorates each entry from its day to the next entry\'s, a change of plan mid-span counted on both sides (M9 fix 838)', () => {
  const plan: PlanEntry[] = [
    { plan: 'Pro', monthlyUsd: 20, from: '2026-09-01' },
    { plan: 'Max 20x', monthlyUsd: 200, from: '2026-10-01' },
  ];
  const want = (20 * (t(2026, 10, 1) - t(2026, 9, 10))) / MS_PER_MONTH + (200 * (t(2026, 10, 17) - t(2026, 10, 1))) / MS_PER_MONTH;
  assert.ok(Math.abs(paidOver(plan, t(2026, 9, 10), t(2026, 10, 17)) - want) < 1e-9);
  assert.equal(paidOver([{ plan: 'Pro', monthlyUsd: 20, from: '2026-11-01' }], t(2026, 9, 10), t(2026, 10, 17)), 0, 'an entry after the span pays nothing');
  assert.equal(paidOver([], t(2026, 9, 10), t(2026, 10, 17)), 0);
});

test('paidShare shares each month\'s part of the plan by the folder\'s spend against every folder\'s (M9 fix 838)', () => {
  const plan: PlanEntry[] = [{ plan: 'Max 20x', monthlyUsd: 200, from: '2026-09-01' }];
  const sep = { from: t(2026, 9, 1), to: t(2026, 10, 1), usd: 10, allUsd: 20 };
  const oct = { from: t(2026, 10, 1), to: t(2026, 11, 1), usd: 30, allUsd: 30 };
  const spanFrom = t(2026, 9, 10);
  const to = t(2026, 10, 17);
  const want = paidOver(plan, spanFrom, t(2026, 10, 1)) * 0.5 + paidOver(plan, t(2026, 10, 1), to);
  assert.ok(Math.abs(paidShare(plan, [sep, oct], spanFrom, to) - want) < 1e-9);
  assert.equal(paidShare(plan, [{ ...sep, usd: 0, allUsd: 0 }], spanFrom, to), 0, 'a month with no spend anywhere adds nothing');
});

test('parsePlan drops a bad entry, sorts by day and keeps the later of two on one day; withPlanEntry replaces on the same day (M9 fix 838)', () => {
  const raw = JSON.stringify([
    { plan: 'Max 20x', monthlyUsd: 200, from: '2026-10-01' },
    { plan: 'Ultra', monthlyUsd: 10, from: '2026-09-02' },
    { plan: 'Pro', monthlyUsd: -1, from: '2026-09-03' },
    { plan: 'Pro', monthlyUsd: 20, from: '2026-13-40' },
    { plan: 'Pro', monthlyUsd: 20, from: '2026-09-01' },
    { plan: 'Max 5x', monthlyUsd: 100, from: '2026-10-01' },
  ]);
  assert.deepEqual(parsePlan(raw), [
    { plan: 'Pro', monthlyUsd: 20, from: '2026-09-01' },
    { plan: 'Max 5x', monthlyUsd: 100, from: '2026-10-01' },
  ]);
  assert.deepEqual(parsePlan(null), []);
  assert.deepEqual(parsePlan('not json'), []);
  const one: PlanEntry[] = [{ plan: 'Pro', monthlyUsd: 20, from: '2026-09-01' }];
  assert.deepEqual(withPlanEntry(one, { plan: 'Team', monthlyUsd: 25, from: '2026-09-01' }), [{ plan: 'Team', monthlyUsd: 25, from: '2026-09-01' }]);
  assert.deepEqual(withPlanEntry(one, { plan: 'Team', monthlyUsd: 25, from: '2026-08-01' }).map((e) => e.from), ['2026-08-01', '2026-09-01']);
  assert.deepEqual(withoutPlanEntry(one, '2026-09-01'), []);
  assert.equal(planEntryText({ plan: 'Max 20x', monthlyUsd: 200, from: '2026-09-28' }), 'Max 20x · $200.00 a month from 2026-09-28');
});

test('paidText says no plan, a plan after the span, or the price against what was paid (M9 fix 838)', () => {
  assert.equal(paidText(5012.33, false, null, 37), 'No plan entered. Add the plan below to set what was paid against the API price.');
  assert.equal(paidText(5012.33, false, 0, 37), '$5,012.33 at API prices; the plan entered starts after the span');
  assert.equal(paidText(5012.33, false, 243.12, 37), '$5,012.33 at API prices for $243.12 paid on the plan over 37 days, 20.6× what was paid');
  assert.equal(paidText(5012.33, true, 243.12, 37), '~$5,012.33 at API prices for $243.12 paid on the plan over 37 days, 20.6× what was paid');
  assert.equal(paidTitle(12.5, 243.12, false), "This folder's share of what was paid, by its API-price spend against every folder's each month: $12.50 of $243.12");
  assert.ok(paidTitle(12.5, 243.12, true).endsWith(". The days before the log's history are left out of the share."));
});
