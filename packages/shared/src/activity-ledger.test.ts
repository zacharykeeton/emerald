import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityRequest, ActivitySession, ActivityTotals, ActivityTotalsPart } from './activity.ts';
import { activityTotals } from './activity-model.ts';
import { addLedger, heldDrops, ledgerDrop } from './activity-ledger.ts';
import type { Ledger, LedgerDrop } from './activity-ledger.ts';

// M9 fix 1188: the ledger of the dropped generations.

const MIN = 60_000;

function req(at: number, usd: number): ActivityRequest {
  return { at, fresh: 10, cacheWrite: 0, cacheRead: 0, output: 5, usd, model: 'Opus 5' };
}

function row(id: string, cwd: string | null, groupCwd: string | null, spans: Array<[number, number]>, requests: ActivityRequest[]): ActivitySession {
  return { sessionId: id, name: id, color: null, kind: 'claude', claudeSessionId: null, removedAt: null, cwd, groupCwd, requests, commits: [], lifetime: false, spans: spans.map(([from, to]) => ({ from, to, prompt: null })), debt: [], awayMs: 0, cappedMs: 0, parentId: null, agentId: null, agentType: null, outside: false } as ActivitySession;
}

test('ledgerDrop cuts a place\'s months at local midnight on the 1st, keeps a row with no folder in allUsd alone, and shares one place per folder pair (M9 fix 1188)', () => {
  const sep30 = (h: number, m: number) => new Date(2026, 8, 30, h, m).getTime();
  const oct1 = (h: number, m: number) => new Date(2026, 9, 1, h, m).getTime();
  const rows = [
    row('a', 'C:/code/p', 'C:/code/p', [[sep30(23, 40), oct1(0, 20)]], [req(sep30(23, 50), 0.1), req(oct1(0, 10), 0.2)]),
    row('b', 'C:/code/p', 'C:/code/p', [], [req(oct1(0, 15), 0.05)]),
    row('c', null, null, [], [req(oct1(0, 12), 0.3)]),
  ];
  const from = sep30(23, 40);
  const to = oct1(0, 20);
  const drop = ledgerDrop(rows, from, to, { name: 'hooks.3.jsonl', bytes: 100, droppedAt: 7 });
  assert.equal(drop.places.length, 1, 'a and b share one place; c has none');
  const place = drop.places[0]!;
  assert.deepEqual(Object.keys(place.months), ['2026-09', '2026-10']);
  assert.equal(place.months['2026-09']!.requests, 1);
  assert.equal(place.months['2026-09']!.agentMs, 20 * MIN);
  assert.equal(place.months['2026-10']!.requests, 2);
  assert.equal(place.months['2026-10']!.agentMs, 20 * MIN);
  assert.equal(place.firstAt, from);
  assert.ok(Math.abs(drop.allUsd['2026-09']! - 0.1) < 1e-9);
  assert.ok(Math.abs(drop.allUsd['2026-10']! - 0.55) < 1e-9, 'c counts in every folder\'s price');
  assert.deepEqual({ name: drop.name, bytes: drop.bytes, droppedAt: drop.droppedAt, from: drop.from, to: drop.to }, { name: 'hooks.3.jsonl', bytes: 100, droppedAt: 7, from, to });
});

function zeroTotals(folder: string, from: number, to: number, historyFrom: number): ActivityTotals {
  return activityTotals([], folder, from, to, historyFrom);
}

function dropOf(places: LedgerDrop['places'], from: number, to: number, allUsd: Record<string, number>): LedgerDrop {
  return { name: 'hooks.9.jsonl', bytes: 1, droppedAt: 0, from, to, allUsd, places };
}

const month = (requests: number, usd: number, estimated = false) => ({ requests, up: requests * 10, fresh: requests * 10, cacheWrite: 0, cached: 0, down: requests * 5, usd, estimated, agentMs: requests * MIN });

test('addLedger adds a month before the log\'s to its zero part, sums a month both hold, adds to the total and allUsd, takes the earlier firstAt, and counts a place under two folders once (M9 fix 1188)', () => {
  const sepFrom = new Date(2026, 8, 1).getTime();
  const octMid = new Date(2026, 9, 15).getTime();
  const novMid = new Date(2026, 10, 15).getTime();
  // The log's own rows: one request in October.
  const log = activityTotals([row('a', 'C:/a/b', 'C:/a/b', [], [req(octMid, 1)])], 'C:/a', sepFrom, novMid, sepFrom);
  const sepPart = log.months.find((m) => m.month === '2026-09')!;
  assert.equal(sepPart.requests, 0, 'the zero part activityTotals made for September');
  const drop = dropOf([{ cwd: 'C:/a/b', groupCwd: 'C:/a/b', firstAt: sepFrom + MIN, months: { '2026-09': month(2, 0.5, true), '2026-10': month(1, 0.25) } }], sepFrom, octMid - 1, { '2026-09': 0.75, '2026-10': 0.25 });
  const added = addLedger(log, [drop], ['C:/a', 'C:/a/b']);
  const part = (t: ActivityTotals, key: string): ActivityTotalsPart => t.months.find((m) => m.month === key)!;
  assert.equal(part(added, '2026-09').requests, 2);
  assert.equal(part(added, '2026-09').estimated, true);
  assert.ok(Math.abs(part(added, '2026-09').allUsd - 0.75) < 1e-9);
  assert.equal(part(added, '2026-10').requests, 2, 'the log\'s and the ledger\'s October summed');
  assert.ok(Math.abs(part(added, '2026-10').usd - 1.25) < 1e-9);
  assert.equal(added.total.requests, 4, 'the place counted once though both folders hold it');
  assert.ok(Math.abs(added.total.usd - 1.75) < 1e-9);
  assert.equal(added.total.agentMs, 3 * MIN);
  assert.ok(Math.abs(added.total.allUsd - (log.total.allUsd + 1)) < 1e-9);
  assert.equal(added.firstAt, sepFrom + MIN);
  assert.equal(log.total.requests, 1, 'the answer it was handed is unchanged');
  // A month with no part in the answer is skipped.
  const late = zeroTotals('C:/a', octMid, novMid, octMid);
  assert.equal(addLedger(late, [drop], ['C:/a']).total.requests, 1, 'September has no part, October adds its one');
});

test('heldDrops leaves out a drop the log still holds, and with a start one that begins before it (M9 fix 1188)', () => {
  const a = dropOf([], 100, 199, {});
  const b = dropOf([], 200, 299, {});
  const ledger: Ledger = { version: 1, drops: [b, a] };
  assert.deepEqual(heldDrops(ledger, null, 1000, 300), [a, b], 'both before the log, oldest first');
  assert.deepEqual(heldDrops(ledger, null, 1000, 250), [a], 'b ends at or after the log\'s first line');
  assert.deepEqual(heldDrops(ledger, null, 1000, 299), [a]);
  assert.deepEqual(heldDrops(ledger, 150, 1000, 300), [b], 'a starts before the window');
  assert.deepEqual(heldDrops(ledger, 100, 250, 300), [a], 'b ends past the window');
  assert.deepEqual(heldDrops(ledger, null, 1000, null), [a, b], 'an empty log holds every drop');
  assert.deepEqual(heldDrops(null, null, 1000, 300), []);
});
