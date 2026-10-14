import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { COMPACT_BUFFER_TOKENS, compactPercent, contextPercentText, costParts, formatTokens, formatUsd, ratesFor, ratesLookStale, tokensUp, uncachedCost } from '@emerald/shared';
import type { SessionInfo, UsageMessage } from '@emerald/shared';
import { askUsageLive, useConversationUsage } from './commit-usage.ts';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { askAgentsRunning, useAgentsRunning } from './agents-running.ts';
import { runningFigure } from './agents-running-model.ts';

// M9 fix 67: the context reading on a pane title or a sidebar row opens
// a card with everything the rail's footer bar (M42) and the reading's
// title tooltip used to say, for that reading's session: the model and
// the window size as a heading, how full it is, the stacked bar with its
// used, free and buffer legend, the compaction point, and the last
// request's four counts. The footer sat in the corner nobody looked at;
// the reading is where the eye goes for context. The hover, the pin and
// the card's placement and closing are Popover.tsx's.

interface ReadingProps {
  session: SessionInfo;
  className: string;
  children: ReactNode;
}

// The reading itself: the caller's spans (the words, the dial, the
// percent) in the anchor that opens the card.
export function ContextReading({ session, className, children }: ReadingProps) {
  return (
    <PopoverAnchor id={session.id} className={className} card={(props) => <ContextPopover session={session} {...props} />}>
      {children}
    </PopoverAnchor>
  );
}

export function ContextPopover({ session, anchor, onClose, onEnter, onLeave }: CardProps & { session: SessionInfo }) {
  const cw = session.contextWindow !== null && session.contextWindow.size > 0 ? session.contextWindow : null;
  const percent = contextPercentText(session);
  const used = cw === null ? 0 : Math.min(100, (cw.used / cw.size) * 100);
  const buffer = cw === null ? 0 : 100 - compactPercent(cw);
  const bufferTokens = cw === null ? 0 : Math.min(cw.size, COMPACT_BUFFER_TOKENS);
  const free = cw === null ? 0 : Math.max(0, cw.size - cw.used - bufferTokens);
  const t = session.tokens;
  const rates = ratesFor(session.model);
  // M9 fix 278: the running sum carries no split of which cache write
  // was billed at which TTL, so the card asks the conversation's own
  // requests for the last one's split and prices every cache write in
  // the sum the same way that request was billed. Until the list is in,
  // or the session has no bound conversation, the sum prices as it
  // always did (the 5-minute rate).
  // M9 fix 401: asked again whenever the record's own lastEventAt moves,
  // so a card left open on a working session follows it rather than
  // pricing for ever on the split it read at its mount.
  const conversationId = session.conversation?.id ?? null;
  useEffect(() => {
    if (conversationId !== null) askUsageLive(conversationId, session.lastEventAt);
  }, [conversationId, session.lastEventAt]);
  const { lists } = useConversationUsage();
  const usageList = conversationId === null ? null : (lists.get(conversationId) ?? null);
  let lastOwn: UsageMessage | null = null;
  if (usageList !== null) for (const m of usageList) if (m.agentId === null) lastOwn = m;
  const write1h = (lastOwn?.cacheWrite1h ?? 0) > 0;
  const parts = t !== null && rates !== null ? costParts(write1h ? { ...t, cacheWrite1h: t.cacheWrite } : t, rates) : null;
  const cost = session.costUsd ?? null;
  // The forks' spend since the main thread's last request (M9 fix 277),
  // asked for as the card opens so it reads the files as they stand.
  const conversation = session.conversation?.id ?? null;
  const running = useAgentsRunning();
  useEffect(() => {
    if (conversation !== null) askAgentsRunning(conversation);
  }, [conversation]);
  const figure = runningFigure(cost, conversation === null ? null : (running.get(conversation) ?? null));
  return (
    <PopoverCard id={session.id} className="context-popover" data={{ 'data-session-id': session.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="context-popover-heading">
        <span className="context-popover-model">{session.model ?? 'Model not reported'}</span>
        {cw !== null && <span className="context-popover-size"> · {formatTokens(cw.size)}</span>}
      </div>
      {percent !== null && (
        <div className="context-popover-fill">
          {percent} full{cw !== null && `, ${formatTokens(cw.used)} of ${formatTokens(cw.size)} tokens`}
        </div>
      )}
      {cw !== null && (
        <>
          <div className="context-bar-track">
            <span className="context-bar-used" style={{ width: `${used.toFixed(1)}%` }} />
            <span className="context-bar-free" />
            <span className="context-bar-buffer" style={{ width: `${buffer.toFixed(1)}%` }} />
          </div>
          <div className="context-bar-legend">
            <span className="context-bar-key" data-part="used">
              used {formatTokens(cw.used)}
            </span>
            <span className="context-bar-key" data-part="free">
              free {formatTokens(free)}
            </span>
            <span className="context-bar-key" data-part="buffer">
              buffer {formatTokens(bufferTokens)}
            </span>
          </div>
          <div className="context-popover-compact">
            auto-compact at {compactPercent(cw).toFixed(1)}% ({formatTokens(bufferTokens)} buffer)
          </div>
          <div className="context-popover-request">
            {[`cache read ${formatTokens(cw.cacheRead)}`, `cache write ${formatTokens(cw.cacheWrite)}`, `fresh ${formatTokens(cw.fresh)}`, `out ${formatTokens(cw.output)}`].join(' · ')}
          </div>
        </>
      )}
      {/* M9 fix 143: the running sum the row's ↑ ↓ reading shortens, whole; M9 fix 154: a row per part with its rate and its dollars from our table. Fix 209 put the two dollar figures in their places: the table prices this pane's own requests, so its total and what the same traffic would have cost uncached sit as one line under the parts; Claude Code's total covers every request the process made, the forked agents' included, and comes last as the line that covers everything. The stale note blames the gap between the two on what it can be. */}
      {t !== null && (
        <div className="context-popover-tokens">
          <div className="context-popover-tokens-heading">Since the start</div>
          <table className="context-popover-parts">
            <tbody>
              {(
                [
                  ['fresh', t.fresh, rates?.fresh, parts?.fresh],
                  ['cache write', t.cacheWrite, rates?.cacheWrite, parts?.cacheWrite],
                  ['cache read', t.cacheRead, rates?.cacheRead, parts?.cacheRead],
                  ['output', t.output, rates?.output, parts?.output],
                ] as Array<[string, number, number | undefined, number | undefined]>
              ).map(([part, count, rate, usd]) => (
                <tr key={part} data-part={part.replace(' ', '-')}>
                  <td className="context-popover-part">{part}</td>
                  <td className="context-popover-count">{count.toLocaleString()}</td>
                  <td className="context-popover-rate">{rate === undefined ? '' : `$${rate}/M`}</td>
                  <td className="context-popover-usd">{usd === undefined ? '' : formatUsd(usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rates !== null && <div className="context-popover-cache-rate">cache writes at the {write1h ? '1-hour' : '5-minute'} rate</div>}
          <div className="context-popover-token-totals">
            sent {tokensUp(t).toLocaleString()}, received {t.output.toLocaleString()}
          </div>
          {rates !== null && parts !== null && (
            <div className="context-popover-own">
              this pane's requests: ~{formatUsd(parts.total)} cached, ~{formatUsd(uncachedCost(t, rates))} uncached · the dollars are an estimate from our rate table
            </div>
          )}
          {figure?.tokens !== null && figure !== null && (
            <div className="context-popover-running-tokens" title="the forks' requests since this pane's own last request, not yet in the counts above">
              {figure.tokens}
            </div>
          )}
          {cost !== null && figure !== null && (
            <div className="context-popover-cost" data-usd={cost} data-running={figure.running || undefined}>
              {figure.card} at API rates, subagents included, Claude Code's own figure{figure.running && " and the forks' since its last request"}
            </div>
          )}
          {cost !== null && parts !== null && ratesLookStale(parts.total, cost) && (
            <div className="context-popover-stale">
              {cost > parts.total ? "well above this pane's own requests: subagents, an older rate table, or a change of model" : "well below this pane's own requests: cache writes at the 1-hour rate, an older rate table, or a change of model"}
            </div>
          )}
        </div>
      )}
    </PopoverCard>
  );
}
