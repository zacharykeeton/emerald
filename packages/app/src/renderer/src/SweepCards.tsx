import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { commitCardModel, commitsStats, commitsStatsTitle, debtStats, debtStatsTitle, formatDuration, formatSpanLength, formatTokens, formatUsd, splitUsage, timesLine, tokensRowText, tokensStats, tokensText } from '@emerald/shared';
import type { ActivitySession, ActivityStats, BranchRun, CommitCardModel, SessionInfo } from '@emerald/shared';
import type { GitCommit, HistorySession } from '../../preload/api.ts';
import { branchRunOf, branchWindow } from './commit-price-model.ts';
import type { BranchGroup, CommitSlice } from './commit-price-model.ts';
import type { CommitBranch } from './commit-depth-model.ts';
import { twinLineText } from './commit-twins-model.ts';
import type { TwinInfo } from './commit-twins-model.ts';
import { askUsage, useConversationUsage } from './commit-usage.ts';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import type { GraphWrite } from './write-graph-model.ts';

// M73 task 4: the cards the sweep of the tooltips gave, each on the
// context card's frame (`.sweep-popover`, style.css) with the same
// manners as the rest (Popover.tsx): the activity line's card, the
// history row's card and the commit row's card. Each carries what its
// element's title tooltip did, laid out as labelled lines rather than a
// block of text, and the element carries no title any more.

// The activity line (ActivitySection.tsx): the window and the scope as
// the heading, then each number of the stats line with what it means,
// which the tooltip said in one breath under the line.
export function ActivityTextAnchor({ id, text, stats, sessions, className, children }: { id: string; text: string; stats: ActivityStats; sessions: number; className: string; children: ReactNode }) {
  return (
    <PopoverAnchor id={`activity-text:${id}`} className={className} card={(props) => <ActivityTextCard id={id} text={text} stats={stats} sessions={sessions} {...props} />}>
      {children}
    </PopoverAnchor>
  );
}

function ActivityTextCard({ id, text, stats, sessions, anchor, onClose, onEnter, onLeave }: CardProps & { id: string; text: string; stats: ActivityStats; sessions: number }) {
  const rows: Array<[string, string]> =
    stats.agentMs === 0
      ? [['nothing yet', 'no session has worked in this window']]
      : [
          [`${formatSpanLength(stats.agentMs)} agent time`, 'the sum of the stretches the sessions spent working'],
          [`in ${formatSpanLength(stats.wallMs)}`, 'the wall time: how long at least one of them was working'],
          [`${stats.parallel.toFixed(1)}× parallel`, 'agent time over wall time, one being one session at a time'],
          [`peak ${stats.peak}`, 'the most sessions working at one instant'],
        ];
  // M9 fix 231: the debt part, when the window has any.
  const debt = stats.agentMs === 0 ? null : debtStats(stats);
  if (debt !== null) rows.push([debt, (debtStatsTitle(stats) ?? '').split('\n').join('; ')]);
  // M9 fix 218: what landed, and who landed the most.
  const tally = stats.agentMs === 0 ? null : commitsStats(stats);
  if (tally !== null) rows.push([tally, (commitsStatsTitle(stats) ?? '').replace(`${tally} `, '')]);
  // M9 fix 217: the window's tokens and cost, when its sessions posted
  // any status line, with the sent count split and the cached share.
  const tokens = stats.agentMs === 0 ? null : tokensStats(stats);
  if (tokens !== null) {
    const share = stats.up === 0 ? 0 : Math.round((stats.cached / stats.up) * 100);
    rows.push([`↑${tokens.up} ↓${tokens.down}`, `tokens sent and received over ${stats.requests} ${stats.requests === 1 ? 'request' : 'requests'}: ${formatTokens(stats.fresh)} fresh, ${formatTokens(stats.cacheWrite)} cache write, ${formatTokens(stats.cached)} cache read (${share}% cached)`]);
    rows.push([tokens.usd, stats.estimated ? 'at API rates, priced from the rates table where Claude Code gave no figure' : "at API rates, Claude Code's own figure summed over the requests"]);
  }
  // M9 fix 207: the count at this instant, on a window on the clock.
  if (stats.agentMs !== 0 && stats.running !== null) rows.push([`${stats.running} running now`, 'the sessions working at this instant']);
  return (
    <PopoverCard id={`activity-text:${id}`} className="sweep-popover activity-text-popover" anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="sweep-card-heading">{text}</div>
      {rows.map(([number, meaning]) => (
        <div key={number} className="sweep-card-line" data-part="stat">
          <span className="sweep-card-label">{number}</span>
          <span className="sweep-card-text">{meaning}</span>
        </div>
      ))}
      <div className="sweep-card-note">{`${sessions} ${sessions === 1 ? 'session' : 'sessions'} in the window, from the hooks' log and the daemon's records`}</div>
    </PopoverCard>
  );
}

// The history row's title (HistoryPanel.tsx): the conversation's title,
// where it ran, its branch and model, how many prompts, when it started
// and was last written to, and the transcript file.
export function HistoryRowAnchor({ session, className, children }: { session: HistorySession; className: string; children: ReactNode }) {
  return (
    <PopoverAnchor id={`history-row:${session.id}`} className={className} card={(props) => <HistoryRowCard session={session} {...props} />}>
      {children}
    </PopoverAnchor>
  );
}

function HistoryRowCard({ session: s, anchor, onClose, onEnter, onLeave }: CardProps & { session: HistorySession }) {
  const lines: Array<[string, string, string]> = [['folder', 'Folder', s.cwd]];
  if (s.branch !== null) lines.push(['branch', 'Branch', s.branch]);
  if (s.model !== null) lines.push(['model', 'Model', s.model]);
  lines.push(['prompts', 'Prompts', String(s.prompts)]);
  if (s.startedAt !== null) lines.push(['started', 'Started', new Date(s.startedAt).toLocaleString()]);
  if (s.lastAt !== null) lines.push(['last', 'Last written', new Date(s.lastAt).toLocaleString()]);
  lines.push(['path', 'Transcript', s.path]);
  return (
    <PopoverCard id={`history-row:${s.id}`} className="sweep-popover history-row-popover" data={{ 'data-id': s.id }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="sweep-card-heading">{s.title}</div>
      {lines.map(([part, label, text]) => (
        <div key={part} className="sweep-card-line" data-part={part}>
          <span className="sweep-card-label">{label}</span>
          <span className="sweep-card-text">{text}</span>
        </div>
      ))}
    </PopoverCard>
  );
}

// The commit row (CommitsPanel.tsx): the whole hash, the subject, the
// author and the clock time, who made it as the graph knows it, the
// branch it is on (M9 fix 253, off commit-depth-model.ts: the ref's
// name, or the merge subject's with `merged into main` after it once
// the ref is gone), and whether the block's lines are hidden. Under a
// hairline, the commit's
// price (M9 fix 252, docs/design/commit-price.md): the slice between the
// session's previous credited commit and this one stated first, in
// words, so nothing under it reads as a running total, then the cost,
// the tokens and the session's working time inside it, and the forked
// agents' share as the note. A commit no session claims has no block at
// all and says why, since a zero would be a lie and an empty block a
// puzzle. The Author line's clock is the committer's, the row's age
// (M9 fix 303); when the author's differs by a minute or more a line
// under it says both, `authored 6:27 PM, picked 6:45 PM` on a commit
// with a twin (fix 304) and `committed` otherwise. The twins (fix
// 304) are a line each under the branch, `picked onto main`, the
// original first on a pick's card.
export interface CommitPrice {
  session: SessionInfo;
  slice: CommitSlice;
  // The lines a merge brought in (state 5); empty on any other commit.
  branch: BranchGroup[];
  // On a subagent's own commit, the branch it worked on, for the note.
  agentBranch: string | null;
}

export function CommitCard({ commit, by, hidden, price, agent, color, branch, twins = null, anchor, onClose, onEnter, onLeave }: CardProps & { commit: GitCommit & { authoredAt?: number }; by: string; hidden: boolean; price: CommitPrice | null; agent: boolean; color: string | null; branch: CommitBranch | null; twins?: TwinInfo | null }) {
  const times = commit.authoredAt === undefined ? null : timesLine(commit.at, commit.authoredAt, twins !== null && !twins.original, clock);
  return (
    <PopoverCard id={`commit:${commit.hash}`} className="sweep-popover commit-popover" data={{ 'data-hash': commit.hash, ...(price === null ? { 'data-price': 'none' } : {}) }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="sweep-card-heading">{commit.subject}</div>
      <div className="sweep-card-line" data-part="hash">
        <span className="sweep-card-label">Commit</span>
        <span className="sweep-card-text sweep-card-mono">{commit.hash}</span>
      </div>
      <div className="sweep-card-line" data-part="author">
        <span className="sweep-card-label">Author</span>
        <span className="sweep-card-text">{`${commit.author}, ${new Date(commit.at).toLocaleString()}`}</span>
      </div>
      {times !== null && (
        <div className="sweep-card-line" data-part="times">
          <span className="sweep-card-label">When</span>
          <span className="sweep-card-text">{times}</span>
        </div>
      )}
      <div className="sweep-card-line" data-part="by">
        <span className="sweep-card-label">By</span>
        <span className="sweep-card-text" data-by={price === null ? 'outside' : agent ? 'agent' : undefined} style={price === null || color === null ? undefined : { color }}>
          {by}
        </span>
      </div>
      {branch !== null && branch.branch !== null && (
        <div className="sweep-card-line" data-part="branch">
          <span className="sweep-card-label">Branch</span>
          <span className="sweep-card-text">
            {branch.branch}
            {branch.mergedInto !== null && <span className="sweep-card-absent">{` merged into ${branch.mergedInto}`}</span>}
          </span>
        </div>
      )}
      {twins !== null && (
        <div className="sweep-card-line" data-part="twins">
          <span className="sweep-card-label">Twins</span>
          <span className="sweep-card-text">
            {twins.lines.map((line) => (
              <div key={line.hash} className="sweep-card-twin" data-hash={line.hash} data-original={line.original ? '' : undefined}>
                {twinLineText(line)}
              </div>
            ))}
          </span>
        </div>
      )}
      {hidden && <div className="sweep-card-note">its lines are hidden; click the hash to show them</div>}
      {price === null ? <div className="sweep-card-note" data-part="why">no session claimed it, so it has no price</div> : <CommitPriceBlock price={price} />}
    </PopoverCard>
  );
}

// The clock times of the slice, `14:02 to 14:40`.
function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// `11 agents ran here, priced on their own commits: ~$155` (M9 fix
// 275), on the card and on the row cell's tooltip.
export function elsewhereText(elsewhere: { count: number; usd: number | null }): string {
  const who = `${elsewhere.count} ${elsewhere.count === 1 ? 'agent' : 'agents'} ran here, priced on ${elsewhere.count === 1 ? 'its own commit' : 'their own commits'}`;
  return elsewhere.usd === null ? who : `${who}: ~${formatUsd(elsewhere.usd)}`;
}

// `credited with 2 others at 18:47` (M9 fix 276).
export function groupText(size: number, at: number): string {
  const others = size - 1;
  return `credited with ${others} ${others === 1 ? 'other' : 'others'} at ${clock(at)}`;
}

// `~$0.60, 12m`, whichever of the two is known; '' when neither is.
function moneyAndTime(usd: number | null, ms: number | null): string {
  const parts: string[] = [];
  if (usd !== null) parts.push(`~${formatUsd(usd)}`);
  if (ms !== null) parts.push(formatSpanLength(ms));
  return parts.join(', ');
}

// Past about 30 characters the tokens reading would wrap in the card's
// 188px value column (the board's `↑9.1M (8.5M cached) ↓61.7k` is 27
// and fits), so the cached share drops off the arrows into a line of
// its own under them, the way the sidebar row drops it at its first
// squeeze.
const TOKENS_WIDE = 30;

function CommitPriceBlock({ price }: { price: CommitPrice }) {
  const { session, slice, branch, agentBranch } = price;
  const { lists, asking } = useConversationUsage();
  // The transcripts' requests, asked for on every open so a card on a
  // commit that just landed reads the lines written since; the answer
  // is `same` and no list when nothing changed.
  useEffect(() => {
    if (slice.conversation !== null) askUsage(slice.conversation);
    for (const g of branch) if (g.conversation !== null) askUsage(g.conversation);
  }, [slice.conversation, branch]);
  // The session's working stretches over the slice, and over the
  // branch's run on a merge, off the daemon's activity log. Null until
  // answered and on a daemon that cannot answer, which the model reads
  // as the time not known.
  const [rows, setRows] = useState<ActivitySession[] | null>(null);
  const [branchRows, setBranchRows] = useState<ActivitySession[] | null>(null);
  useEffect(() => {
    let gone = false;
    window.emerald
      .request('activity.spans', { from: slice.from, to: slice.to })
      .then((res) => {
        if (!gone) setRows(res.sessions.filter((r) => r.sessionId === session.id));
      })
      .catch(() => {
        if (!gone) setRows(null);
      });
    const over = branchWindow(branch);
    if (over !== null) {
      window.emerald
        .request('activity.spans', over)
        .then((res) => {
          if (!gone) setBranchRows(res.sessions);
        })
        .catch(() => {
          if (!gone) setBranchRows(null);
        });
    }
    return () => {
      gone = true;
    };
  }, [slice.from, slice.to, session.id, branch]);
  const messages = slice.conversation === null ? null : lists.get(slice.conversation);
  // Pending while the store has not answered for this conversation yet,
  // and while an ask is out for it with nothing read so far, so the card
  // never shows an absence the answer on its way may fill.
  const pending = messages === undefined || (messages === null && slice.conversation !== null && asking.has(slice.conversation));
  // The slice's requests less those of the agents priced on commits of
  // their own (M9 fix 275), which the note names instead.
  const split = messages === undefined || messages === null ? { own: null, elsewhere: null } : splitUsage(messages, slice.from, slice.to, slice.priced, slice.commit.agent?.id ?? null);
  const run: BranchRun | null = branchRunOf(branch, lists, branchRows);
  const model: CommitCardModel = commitCardModel(slice.commit, slice.prev, slice.start, rows, split.own, run, { priced: slice.priced, elsewhere: split.elsewhere, group: slice.group });
  return <PriceLines model={model} pending={pending} agent={slice.commit.agent !== undefined} agentBranch={agentBranch} transcriptGone={!pending && split.own === null && split.elsewhere === null} />;
}

// The block's lines off the model, apart from the asks so the six
// states read off a model alone.
export function PriceLines({ model, pending, agent, agentBranch, transcriptGone }: { model: CommitCardModel; pending: boolean; agent: boolean; agentBranch: string | null; transcriptGone: boolean }) {
  const { slice } = model;
  const notKnown = <span className="sweep-card-absent">not known</span>;
  const rowText = model.tokens === null ? null : tokensRowText({ tokens: model.tokens });
  const wide = rowText !== null && rowText.length > TOKENS_WIDE;
  const notes: Array<{ part: string; text: string }> = [];
  if (agent) notes.push({ part: 'agent', text: agentBranch === null ? "all of it the agent's own work" : `all of it the agent's own work, on ${agentBranch}` });
  else if (model.agents !== null) {
    const share = moneyAndTime(model.agents.usd, model.agents.ms);
    notes.push({ part: 'agents', text: `of which ${model.agents.count} ${model.agents.count === 1 ? 'agent' : 'agents'}${share === '' ? '' : ` ${share}`}` });
  }
  if (!agent && model.elsewhere !== null) notes.push({ part: 'elsewhere', text: elsewhereText(model.elsewhere) });
  // A commit credited with others at one instant (M9 fix 276): the
  // figures above are the group's, priced once, and the note says so on
  // each of them so none reads as its own.
  if (model.group !== null) notes.push({ part: 'group', text: `${groupText(model.group.size, slice.to)}, priced together` });
  if (model.branch !== null) {
    const run = moneyAndTime(model.branch.usd, model.branch.ms);
    notes.push({ part: 'branch', text: `the branch's own run is priced on its ${model.branch.commits} ${model.branch.commits === 1 ? 'commit' : 'commits'}${run === '' ? '' : `: ${run}`}` });
  }
  if (transcriptGone) notes.push({ part: 'gone', text: "the session's transcript for this stretch is gone; the time comes from the hooks" });
  return (
    <div className="commit-price" data-pending={pending ? '' : undefined}>
      <div className="commit-price-slice" data-part="slice">
        {slice.fromHash === null ? 'since the session started' : <>since <span className="sweep-card-mono">{slice.fromHash.slice(0, 7)}</span></>}
        {`, ${clock(slice.from)} to ${clock(slice.to)}`}
      </div>
      <div className="sweep-card-line" data-part="cost">
        <span className="sweep-card-label">Cost</span>
        <span className={model.cost === null ? 'sweep-card-text' : 'sweep-card-text commit-price-cost'} title={model.cost === null ? undefined : 'an estimate from our rate table'}>{pending ? '' : model.cost === null ? notKnown : `~${formatUsd(model.cost)}`}</span>
      </div>
      <div className="sweep-card-line" data-part="tokens">
        <span className="sweep-card-label">Tokens</span>
        <span className="sweep-card-text">{pending ? '' : rowText === null || model.tokens === null ? notKnown : wide ? tokensText({ tokens: model.tokens }) : rowText}</span>
      </div>
      {wide && model.tokens !== null && (
        <div className="sweep-card-line" data-part="cached">
          <span className="sweep-card-label" />
          <span className="sweep-card-text sweep-card-absent">{`${formatTokens(model.tokens.cacheRead)} of the sent count cached`}</span>
        </div>
      )}
      <div className="sweep-card-line" data-part="agent-time">
        <span className="sweep-card-label">Agent time</span>
        <span className="sweep-card-text">{model.agentMs === null ? notKnown : formatSpanLength(model.agentMs)}</span>
      </div>
      {notes.map((n) => (
        <div key={n.part} className="sweep-card-note" data-part={n.part}>
          {n.text}
        </div>
      ))}
    </div>
  );
}

// A write's row on the write graph (M9 fix 255, CommitsPanel.tsx in a
// folder that is no repository): the path as the heading, the whole
// path, when it was written and how long ago, and who wrote it, the
// session or the session and its member.
export function WriteCard({ write, now, hidden, anchor, onClose, onEnter, onLeave }: CardProps & { write: GraphWrite; now: number; hidden: boolean }) {
  return (
    <PopoverCard id={`commit:${write.hash}`} className="sweep-popover commit-popover write-popover" data={{ 'data-hash': write.hash, 'data-path': write.path }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="sweep-card-heading">{write.rel}</div>
      <div className="sweep-card-line" data-part="path">
        <span className="sweep-card-label">File</span>
        <span className="sweep-card-text sweep-card-mono">{write.path}</span>
      </div>
      <div className="sweep-card-line" data-part="at">
        <span className="sweep-card-label">Written</span>
        <span className="sweep-card-text">{`${new Date(write.at).toLocaleString()}, ${formatDuration(write.at, now)} ago`}</span>
      </div>
      <div className="sweep-card-line" data-part="by">
        <span className="sweep-card-label">By</span>
        <span className="sweep-card-text">{write.by}</span>
      </div>
      {hidden && <div className="sweep-card-note">its lines are hidden; click the pen to show them</div>}
    </PopoverCard>
  );
}
