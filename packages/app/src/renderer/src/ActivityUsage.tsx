import { Fragment } from 'react';
import { HIGH_PERCENT, STRIP_BAR_PX, dialStyle, paceBar, segmentLabel, segmentRest, stripRunway, stripText } from './usage-model.ts';
import { UsageBar, UsageWindowAnchor } from './UsageCard.tsx';
import { usageAgeText, useUsageAge, useUsageReading } from './usage-reading.ts';

// M9 fix 766: the usage windows in the activity view, a row under the
// controls, the sidebar strip's segments drawn the way the strip draws
// them in its row form, each opening the same card on hover. It reads
// the reading the strip last wrote (usage-reading.ts) and never asks the
// endpoint (fix 321's rule: the strip stays the only asker, so a dozen
// activity panes cost no requests). With no reading it draws nothing;
// the toggle in the header says why. A reading the strip could not
// refresh, or one kept while the sidebar is folded, is dimmed and says
// so in its title and on the card.
export function ActivityUsage({ now }: { now: number }) {
  const windows = useUsageReading();
  const age = useUsageAge();
  if (windows === null || windows.length === 0) return null;
  const stale = usageAgeText(age);
  return (
    <div className="activity-view-usage" data-windows={windows.length} data-stale={stale !== null || undefined} title={stale ?? undefined}>
      {windows.map((w, i) => {
        const bar = paceBar(w, now, STRIP_BAR_PX);
        const runway = stripRunway(bar, now);
        const rest = runway === null ? stripText(w, bar, now) : segmentRest(w, now);
        return (
          <Fragment key={w.key}>
            {i > 0 && <span className="usage-dot">·</span>}
            <UsageWindowAnchor windows={windows} current={w} now={now} fetchedAt={age.fetchedAt} stale={stale} className="activity-usage-window">
              <span className="usage-label">{segmentLabel(w)}</span>
              {bar !== null ? <UsageBar bar={bar} form="strip" /> : <span className="usage-meter" style={dialStyle(w.percent)} data-high={w.percent >= HIGH_PERCENT || undefined} />}
              <span className="usage-text" data-tone={bar?.tone}>
                {runway === null ? rest : <><span className="usage-rest">{rest}</span><span className="usage-join"> · </span><span className="usage-runway">{runway}</span></>}
              </span>
            </UsageWindowAnchor>
          </Fragment>
        );
      })}
    </div>
  );
}
