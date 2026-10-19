import { memo, useEffect, useMemo, useState } from 'react';
import { dayBounds, dayKey, formatSpanLength } from '@emerald/shared';
import type { ActivityTotals } from '@emerald/shared';
import { statsSupported } from './daemon-model.ts';
import { folderName } from './files-model.ts';
import { PLAN_KINDS, PLAN_PRICES, PLAN_PRICES_READ, paidOver, paidShare, paidText, paidTitle, planEntryText, withPlanEntry, withoutPlanEntry } from './plan-model.ts';
import type { PlanKind } from './plan-model.ts';
import { askDue, countAsk, keepAnswer, keptAnswer, statsCounts, statsSheet } from './stats-answer.ts';
import type { StatsAnswer, StatsSheet } from './stats-answer.ts';
import { STATS_OLD_TEXT, STATS_REFRESH_MS, countText, historyDay, monthName, spanDays, startsBeforeHistory, tokensText, usdText } from './stats-model.ts';
import { useStore } from './store.ts';
import { statsFolder } from './tabs-model.ts';
import { setPlan, usePlan } from './ui.ts';

// A folder's statistics as a tab (M9 fix 837), and as the rail's Stats tab
// (fix 885): the commits and releases off the repository, and the requests,
// tokens, API price and agent time of the sessions started in the folder or
// under it off the daemon's fold of its whole log (activity.totals), a row
// per month under them. Asked when shown and once a minute while shown, the
// answer kept per folder for a minute outside the component
// (stats-answer.ts, M9 fix 885), so a remount or the rail's tab asks
// nothing new inside the minute.
export function StatsView({ path }: { path: string }) {
  const folder = statsFolder(path);
  if (folder === null) return null;
  return <StatsPanel folder={folder} place="tab" />;
}

// The answer to a folder and the ask for it: it starts on the kept answer,
// so one draws at once however old, and the first ask waits until that
// answer is a minute old.
function useStatsAnswer(folder: string, live: boolean): { answer: StatsAnswer | null; failed: string | null } {
  const [answer, setAnswer] = useState<StatsAnswer | null>(() => keptAnswer(folder));
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!live) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const asked = Date.now();
      countAsk(folder);
      // Serial: the git read takes the log's first day, which the fold
      // answers (M9 fix 885), so a span before the log is priced on its tail.
      void window.emerald
        .request('activity.totals', { folder })
        .then(async (t) => [t, await window.emerald.files.gitProjectCounts(folder, historyDay(t.historyFrom))] as const)
        .then(([t, c]) => {
          const a: StatsAnswer = { totals: t, counts: c, now: t.to > 0 ? t.to : asked, at: asked };
          keepAnswer(folder, a);
          if (gone) return;
          setAnswer(a);
          setFailed(null);
        })
        .catch((err: unknown) => {
          if (!gone) setFailed(err instanceof Error ? err.message : String(err));
        });
      timer = setTimeout(tick, STATS_REFRESH_MS);
    };
    timer = setTimeout(tick, askDue(folder, Date.now()));
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [folder, live]);
  return { answer, failed };
}

export const StatsPanel = memo(function StatsPanel({ folder, place }: { folder: string; place: 'tab' | 'rail' }) {
  const { daemon, connected } = useStore('daemon', 'connected');
  const supported = statsSupported(daemon);
  const { answer, failed } = useStatsAnswer(folder, supported && connected);
  // Before the counters are read, so the attributes count this render's sheet.
  const sheet = useMemo(() => (answer === null ? null : statsSheet(folder, answer)), [folder, answer]);
  const counts = statsCounts(folder);
  const state = daemon !== null && !supported ? 'old' : failed !== null ? 'failed' : answer !== null ? 'ready' : 'loading';
  const name = folderName(folder) || folder;
  return (
    <div
      className={place === 'tab' ? 'file-view stats-view' : 'stats-view'}
      data-place={place}
      data-folder={folder}
      data-state={state}
      data-now={state === 'ready' && answer !== null ? answer.now : undefined}
      data-asks={counts.asks}
      data-sheets={counts.sheets}
    >
      {place === 'tab' && (
        <div className="file-header">
          <span className="file-path stats-view-title" title={`The statistics of ${folder}`}>
            Statistics · {name}
          </span>
        </div>
      )}
      <div className="stats-view-body">
        {state === 'old' && <div className="stats-message">{STATS_OLD_TEXT}</div>}
        {state === 'failed' && <div className="stats-message">The daemon did not answer the totals: {failed}</div>}
        {state === 'loading' && <div className="stats-message">Reading the totals…</div>}
        {state === 'ready' && sheet !== null && answer !== null && <StatsBody sheet={sheet} answer={answer} />}
      </div>
    </div>
  );
});

// The rail's Stats tab: the level message first, so it shows with no
// folder too, then the empty word, then the panel keyed on the folder so a
// cd remounts it on that folder's own kept answer.
export const RailStats = memo(function RailStats({ folder }: { folder: string | null }) {
  const { daemon } = useStore('daemon');
  if (daemon !== null && !statsSupported(daemon)) {
    return (
      <div className="stats-view" data-place="rail" data-state="old">
        <div className="stats-view-body">
          <div className="stats-message">{STATS_OLD_TEXT}</div>
        </div>
      </div>
    );
  }
  if (folder === null) return <div className="files-empty">No session in this pane</div>;
  return <StatsPanel key={folder} folder={folder} place="rail" />;
});

function StatsBody({ sheet, answer }: { sheet: StatsSheet; answer: StatsAnswer }) {
  const { totals, now } = answer;
  return (
    <>
      <div className="stats-span-row">
        <div className="stats-span" data-from={sheet.start ?? undefined} title={sheet.spanTitle}>
          {sheet.span}
        </div>
        <span className="stats-asof" title="When these figures were read; read again once they are a minute old, while shown">
          {sheet.asOf}
        </span>
      </div>
      <div className="stats-figures">
        {sheet.figures.map((f) => (
          <div key={f.key} className="stats-figure" data-figure={f.key} title={f.title}>
            <span className="stats-figure-label">{f.label}</span>
            <span className="stats-figure-value">{f.value}</span>
            {f.note !== null && <span className="stats-figure-note">{f.note}</span>}
          </div>
        ))}
      </div>
      <div className="stats-yield">{sheet.yieldLine}</div>
      <StatsPaid totals={totals} start={sheet.start} now={now} />
      <div className="stats-months-box">
        <table className="stats-months">
          <thead>
            <tr>
              <th>Month</th>
              <th>Requests</th>
              <th>Tokens in</th>
              <th>Tokens out</th>
              <th>At API prices</th>
              <th>Agent time</th>
              <th title="The commits made by the sessions in this folder (a Claude-Session trailer naming one, or what one of their git commands added to HEAD); the Commits figure above counts every commit on HEAD">By sessions</th>
            </tr>
          </thead>
          <tbody>
            {sheet.months.map((m) => (
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
      </div>
      <div className="stats-history">{sheet.history}</div>
      <StatsPlan now={now} />
    </>
  );
}

// What the plan cost over the span against the API price (M9 fix 838),
// the folder's share by spend in its title.
function StatsPaid({ totals, start, now }: { totals: ActivityTotals; start: number | null; now: number }) {
  const plan = usePlan();
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
  const plan = usePlan();
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
