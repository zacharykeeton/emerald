import { dayBounds } from '@emerald/shared';
import type { ActivityTotalsPart } from '@emerald/shared';
import { usdText } from './stats-model.ts';

// The person's Claude plan over time (M9 fix 838), for the Statistics
// tab's subscription line: what the plan cost over the span against the
// API price. A list, so a change of plan keeps its history; kept in the
// window's localStorage as emerald.plan (ui.ts), the window's, not a
// folder's. Pure, so a test reads the sums.

export const PLAN_KINDS = ['Pro', 'Max 5x', 'Max 20x', 'Team', 'Other'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export interface PlanEntry {
  plan: PlanKind;
  monthlyUsd: number;
  // A local day key, `2026-09-10`: the plan runs from that day's midnight
  // to the next entry's day.
  from: string;
}

// Monthly prices, billed monthly, read off claude.com/pricing on
// 2026-10-18: Pro $20, Max from $100 (the 5x tier), Team $25 a standard
// seat; the 20x tier is not priced on the page and is the plan's $200.
// The box takes any price, so a stale one costs a click.
export const PLAN_PRICES: Record<PlanKind, number | null> = { Pro: 20, 'Max 5x': 100, 'Max 20x': 200, Team: 25, Other: null };
export const PLAN_PRICES_READ = '2026-10-18';

// A month as an average month, so a plan's price prorates by the
// millisecond over any stretch.
export const MS_PER_MONTH = (365.25 / 12) * 86_400_000;

function isPlanKind(v: unknown): v is PlanKind {
  return typeof v === 'string' && (PLAN_KINDS as readonly string[]).includes(v);
}

function byFrom(a: PlanEntry, b: PlanEntry): number {
  return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
}

// The stored list read back: an entry with an unknown plan, a price not
// finite or below 0, or a day that names no day is dropped; sorted by its
// day, and of two on one day the later in the list is kept.
export function parsePlan(raw: string | null): PlanEntry[] {
  if (raw === null) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const byDay = new Map<string, PlanEntry>();
  for (const e of list) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    const plan = o['plan'];
    const monthlyUsd = o['monthlyUsd'];
    const from = o['from'];
    if (!isPlanKind(plan) || typeof monthlyUsd !== 'number' || !Number.isFinite(monthlyUsd) || monthlyUsd < 0 || typeof from !== 'string' || dayBounds(from) === null) continue;
    byDay.set(from, { plan, monthlyUsd, from });
  }
  return [...byDay.values()].sort(byFrom);
}

export function withPlanEntry(plan: readonly PlanEntry[], entry: PlanEntry): PlanEntry[] {
  return [...plan.filter((e) => e.from !== entry.from), entry].sort(byFrom);
}

export function withoutPlanEntry(plan: readonly PlanEntry[], from: string): PlanEntry[] {
  return plan.filter((e) => e.from !== from);
}

// What the plan cost over [from, to]: each entry runs from its day's local
// midnight to the next entry's, the last to `to`, and pays its monthly
// price for its overlap, prorated by the millisecond.
export function paidOver(plan: readonly PlanEntry[], from: number, to: number): number {
  const sorted = [...plan].sort(byFrom);
  let paid = 0;
  for (let i = 0; i < sorted.length; i++) {
    const start = dayBounds(sorted[i]!.from)?.from;
    if (start === undefined) continue;
    const next = sorted[i + 1];
    const end = next === undefined ? to : (dayBounds(next.from)?.from ?? to);
    const overlap = Math.min(end, to) - Math.max(start, from);
    if (overlap > 0) paid += (sorted[i]!.monthlyUsd * overlap) / MS_PER_MONTH;
  }
  return paid;
}

// This folder's share of what was paid: per month of fix 836's rows, the
// month's part of the plan times the folder's spend against every
// folder's that month; a month with no spend anywhere adds nothing.
export function paidShare(plan: readonly PlanEntry[], months: readonly Pick<ActivityTotalsPart, 'from' | 'to' | 'usd' | 'allUsd'>[], spanFrom: number, to: number): number {
  let share = 0;
  for (const m of months) {
    if (m.allUsd <= 0) continue;
    share += paidOver(plan, Math.max(m.from, spanFrom), Math.min(m.to, to)) * (m.usd / m.allUsd);
  }
  return share;
}

// The subscription line. `paid` is null with no plan entered.
export function paidText(usd: number, estimated: boolean, paid: number | null, days: number): string {
  if (paid === null) return 'No plan entered. Add the plan below to set what was paid against the API price.';
  if (paid <= 0) return `${usdText(usd, estimated)} at API prices; the plan entered starts after the span`;
  return `${usdText(usd, estimated)} at API prices for ${usdText(paid, false)} paid on the plan over ${days} days, ${(usd / paid).toFixed(1)}× what was paid`;
}

export function paidTitle(share: number, paid: number, leftOut: boolean): string {
  const head = `This folder's share of what was paid, by its API-price spend against every folder's each month: ${usdText(share)} of ${usdText(paid)}`;
  return leftOut ? `${head}. The days before the log's history are left out of the share.` : head;
}

// The text of one entry in the tab's list.
export function planEntryText(e: PlanEntry): string {
  return `${e.plan} · ${usdText(e.monthlyUsd)} a month from ${e.from}`;
}
