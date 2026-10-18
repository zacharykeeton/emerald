import { useEffect, useState } from 'react';
import { dayBounds, dayKey, formatSpanLength } from '@emerald/shared';
import type { ActivityTotals } from '@emerald/shared';
import type { GitProjectCounts } from '../../preload/api.ts';
import { statsSupported } from './daemon-model.ts';
import { folderName } from './files-model.ts';
import { PLAN_KINDS, PLAN_PRICES, PLAN_PRICES_READ, paidOver, paidShare, paidText, paidTitle, planEntryText, withPlanEntry, withoutPlanEntry } from './plan-model.ts';
import type { PlanKind } from './plan-model.ts';
import { STATS_REFRESH_MS, countText, historyText, monthName, releasesOf, spanDays, spanStart, spanText, spanTitle, startsBeforeHistory, statsFigures, tokensText, usdText, yieldText } from './stats-model.ts';
import { useStore } from './store.ts';
import { statsFolder } from './tabs-model.ts';
import { setPlan, useUi } from './ui.ts';

// A folder's statistics as a tab (M9 fix 837): the commits and releases
// off the repository, and the requests, tokens, API price and agent time
// of the sessions started in the folder or under it off the daemon's fold
// of its whole log (activity.totals), a row per month under them. Asked
// on mount and every minute while shown; nothing is kept on the tab.
export function StatsView({ path }: { path: string }) {
  const folder = statsFolder(path);
  const { daemon, connected } = useStore('daemon', 'connected');
  const supported = statsSupported(daemon);
  const [totals, setTotals] = useState<ActivityTotals | null>(null);
  const [counts, setCounts] = useState<GitProjectCounts | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (folder === null || !supported || !connected) return;
    let gone = false;
    const ask = () => {
      const asked = Date.now();
      void Promise.all([window.emerald.request('activity.totals', { folder }), window.emerald.files.gitProjectCounts(folder)])
        .then(([t, c]) => {
          if (gone) return;
          setTotals(t);
          setCounts(c);
          setFailed(null);
          setNow(t.to > 0 ? t.to : asked);
        })
        .catch((err: unknown) => {
          if (!gone) setFailed(err instanceof Error ? err.message : String(err));
        });
    };
    ask();
    const timer = setInterval(ask, STATS_REFRESH_MS);
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [folder, supported, connected]);

  const state = daemon !== null && !supported ? 'old' : failed !== null ? 'failed' : totals !== null && counts !== null ? 'ready' : 'loading';
  const name = folder === null ? path : folderName(folder) || folder;
  return (
    <div className="file-view stats-view" data-path={path} data-folder={folder ?? undefined} data-state={state} data-now={state === 'ready' ? now : undefined}>
      <div className="file-header">
        <span className="file-path stats-view-title" title={`The statistics of ${folder ?? path}`}>
          Statistics · {name}
        </span>
      </div>
      <div className="stats-view-body">
        {state === 'old' && <div className="stats-message">Statistics need emmerd at level 70 or later; restart it from the banner.</div>}
        {state === 'failed' && <div className="stats-message">The daemon did not answer the totals: {failed}</div>}
        {state === 'loading' && <div className="stats-message">Reading the totals…</div>}
        {state === 'ready' && totals !== null && counts !== null && <StatsBody totals={totals} counts={counts} now={now} />}
      </div>
    </div>
  );
}

function StatsBody({ totals, counts, now }: { totals: ActivityTotals; counts: GitProjectCounts; now: number }) {
  const start = spanStart(counts.firstCommitAt, totals.firstAt);
  const figures = statsFigures(totals, counts);
  const releases = releasesOf(counts).count;
  const months = [...totals.months].reverse();
  return (
    <>
      <div className="stats-span" data-from={start ?? undefined} title={spanTitle(counts.firstCommitAt, totals.firstAt, counts.root !== null, now)}>
        {spanText(counts.firstCommitAt, totals.firstAt, now)}
      </div>
      <div className="stats-figures">
        {figures.map((f) => (
          <div key={f.key} className="stats-figure" data-figure={f.key} title={f.title}>
            <span className="stats-figure-label">{f.label}</span>
            <span className="stats-figure-value">{f.value}</span>
            {f.note !== null && <span className="stats-figure-note">{f.note}</span>}
          </div>
        ))}
      </div>
      <div className="stats-yield">{yieldText(totals.total.usd, totals.total.estimated, releases, counts.commits)}</div>
      <StatsPaid totals={totals} start={start} now={now} />
      <table className="stats-months">
        <thead>
          <tr>
            <th>Month</th>
            <th>Requests</th>
            <th>Tokens in</th>
            <th>Tokens out</th>
            <th>At API prices</th>
            <th>Agent time</th>
            <th>Commits credited</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month} className="stats-month" data-month={m.month ?? undefined}>
              <td>{monthName(m.month ?? '')}</td>
              <td>{countText(m.requests)}</td>
              <td>{tokensText(m.up)}</td>
              <td>{tokensText(m.down)}</td>
              <td>{usdText(m.usd, m.estimated)}</td>
              <td>{formatSpanLength(m.agentMs)}</td>
              <td>{countText(m.commits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stats-history">{historyText(totals.historyFrom, start, now)}</div>
      <StatsPlan now={now} />
    </>
  );
}

// What the plan cost over the span against the API price (M9 fix 838),
// the folder's share by spend in its title.
function StatsPaid({ totals, start, now }: { totals: ActivityTotals; start: number | null; now: number }) {
  const { plan } = useUi();
  const from = start ?? now;
  const days = spanDays(from, now);
  const t = totals.total;
  if (plan.length === 0) return <div className="stats-paid">{paidText(t.usd, t.estimated, null, days)}</div>;
  const paid = paidOver(plan, from, now);
  const share = paidShare(plan, totals.months, from, now);
  const leftOut = startsBeforeHistory(from, totals.historyFrom);
  return (
    <div className="stats-paid" data-paid={paid} data-share={share} title={paidTitle(share, paid, leftOut)}>
      {paidText(t.usd, t.estimated, paid, days)}
    </div>
  );
}

// The plan list and its add row (M9 fix 838): the window's, so every
// folder's tab shows the same list.
function StatsPlan({ now }: { now: number }) {
  const { plan } = useUi();
  const [kind, setKind] = useState<PlanKind>('Max 20x');
  const [price, setPrice] = useState(() => String(PLAN_PRICES['Max 20x']));
  const [from, setFrom] = useState(() => dayKey(now));
  const priceValue = Number(price);
  const ok = price.trim() !== '' && Number.isFinite(priceValue) && priceValue >= 0 && dayBounds(from) !== null;
  return (
    <div className="stats-plan">
      <div className="stats-plan-heading">Plan</div>
      {plan.map((e) => (
        <div key={e.from} className="stats-plan-entry" data-from={e.from}>
          <span className="stats-plan-entry-text">{planEntryText(e)}</span>
          <button type="button" className="stats-plan-remove" title="Remove this plan entry" onClick={() => setPlan(withoutPlanEntry(plan, e.from))}>
            ×
          </button>
        </div>
      ))}
      <div className="stats-plan-add-row">
        <select
          className="stats-plan-kind"
          value={kind}
          onChange={(ev) => {
            const next = ev.target.value as PlanKind;
            setKind(next);
            const p = PLAN_PRICES[next];
            setPrice(p === null ? '' : String(p));
          }}
        >
          {PLAN_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input className="stats-plan-price" type="number" min="0" step="0.01" value={price} onChange={(ev) => setPrice(ev.target.value)} title="The plan's price a month, in dollars" />
        <input className="stats-plan-from" type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} title="The day the plan started" />
        <button type="button" className="stats-plan-add" disabled={!ok} onClick={() => setPlan(withPlanEntry(plan, { plan: kind, monthlyUsd: priceValue, from }))}>
          Add
        </button>
      </div>
      <div className="stats-plan-note">Prices as read off claude.com/pricing on {PLAN_PRICES_READ}; a Team price is per seat.</div>
    </div>
  );
}
