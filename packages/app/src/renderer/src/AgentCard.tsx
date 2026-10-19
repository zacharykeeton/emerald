import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type React from 'react';
import { agentLineText, describeState, formatDuration, formatTokens, formatUsd, markKind, memberHandle, memberParts, modelName, sliceUsage, tasksOfAgent, tokensUp, workingMotion } from '@emerald/shared';
import type { SessionInfo, TeamMember } from '@emerald/shared';
import { commitsLine, nowLine } from './agent-card-model.ts';
import { agentLabel, agentRole } from './commit-graph-model.ts';
import { askAgentsRunning, useAgentsRunning } from './agents-running.ts';
import { askUsageLive, useConversationUsage } from './commit-usage.ts';
import { PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { SessionMark } from './session-mark.tsx';

// The card on an agent's marker in the Commits graph (M65): the
// stepping glyph, the agent's name and state, its branch off the
// member's own record (a commit-less worktree has no ref in the log to
// read one from), or that it works in the session's folder when it has
// none (M9 fix 150: its lane forks from the session's line, and the
// card says why), the session it belongs to with the elapsed, and the
// activity line. On a session's own row (M68, member null) the same
// four lines are about the session: its mark and name, the badge's
// word, the branch the daemon reads for it, the time in its state and
// the sidebar's agent line. Popover.tsx's manners: hover opens after
// the delay, a click pins, Escape or a press outside closes.
//
// A member's card also gains (M9 fix 325) the model word beside its
// state, off the agents-running store's `models` the way `ShadeTeam`
// reads it (Pane.tsx), and a tokens line off the conversation usage
// `commit-usage.ts` already holds for the commit cards, sliced to the
// member's own span and picked out by its id from `sliceUsage`'s
// `agents`. Both are one-shot asks kept fresh by the same stores the
// row's own model word and the commit price ride; neither draws
// anything until a request has landed for the member. The session's
// own row (member null) gains nothing here.
//
// M9 fix 821: the card also opens on a hover over a member's box under the
// shade (Pane.tsx's ShadeMemberCard), and says more: the name wraps whole,
// the model by its full name (`Opus 5`), the price the box prints, the
// commits the member made and its checklist. A shell member's card is the
// same card with its command for a name and none of those lines.
//
// M9 fix 834: every heading is two lines, the mark and the name on the
// first and the rest as chips under the name, so the name keeps its width
// however many chips a member carries.
//
// M9 fix 835: a subagent's card also says the first lines it was asked,
// its calls before the latest above the activity line, and the model its
// Agent call resolved until its own transcript names one.
//
// M9 fix 903: a working subagent's card ends on its latest words, the now line, off its own transcript through the agents-running store, with their age once it is a minute or more; it updates in place as the store does.
//
// M9 fix 904: a subagent's card leads its chips with its handle (A3), the number its box and emmer ls --team show.

interface Props extends CardProps {
  member: TeamMember | null;
  session: SessionInfo;
  now: number;
  anchorId: string;
}

export function AgentCard({ member, session, now, anchorId, anchor, onClose, onEnter, onLeave }: Props): ReactNode {
  const style = session.color === null ? undefined : ({ '--lane': session.color } as React.CSSProperties);
  // Asked unconditionally (hooks cannot sit behind the member check
  // below): the conversation's requests and the agents-running store's
  // per-member models, the same two asks the row's own model word and
  // the commit card's price already keep warm. Both follow the record's
  // own lastEventAt (M9 fix 401), which a push moves on every hook, so a
  // card left open on a working session follows the forks' files and the
  // cache-write split rather than holding what it read at its mount;
  // both stores drop an ask while one is in flight, so a burst of hooks
  // costs one ask each, and a quiet session asks nothing.
  const conversationId = session.conversation?.id ?? null;
  useEffect(() => {
    if (conversationId === null) return;
    askAgentsRunning(conversationId);
    askUsageLive(conversationId, session.lastEventAt);
  }, [conversationId, session.lastEventAt]);
  const running = useAgentsRunning();
  const { lists } = useConversationUsage();
  if (member === null) {
    const working = workingMotion(session) !== null;
    const label = describeState(session);
    const activity = agentLineText(session);
    return (
      <PopoverCard id={anchorId} className="agent-popover" data={{ 'data-session': session.id, 'data-working': working ? '' : 'no' }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
        <div className="agent-card-heading" style={style}>
          <SessionMark kind={markKind(session)} tone={label.tone} working={working} size="unit" className="agent-card-mark" />
          <span className="agent-card-name">{session.name}</span>
          <span className="agent-card-chips">
            <span className="agent-card-state">{label.text}</span>
          </span>
        </div>
        {session.branch !== null && <div className="agent-card-branch">⑂ {session.branch}</div>}
        <div className="agent-card-session">
          session {session.name} · {label.text} for {formatDuration(session.stateSince, now)}
        </div>
        {activity !== '' && <div className="agent-card-activity">{activity}</div>}
      </PopoverCard>
    );
  }
  const working = member.outcome === 'running';
  const elapsed = working ? formatDuration(member.startedAt, now) : `returned after ${formatDuration(member.startedAt, member.endedAt ?? now)}`;
  const answer = running.get(conversationId ?? '');
  // The transcript's model once a request has landed, else the one the
  // Agent call resolved (M9 fix 835), so a member names its model from
  // its launch.
  const word = modelName(answer?.models[member.id] ?? member.model ?? null);
  const said = nowLine(answer?.said[member.id], now);
  const usd = answer?.spend?.[member.id] ?? null;
  const messages = conversationId === null ? null : (lists.get(conversationId) ?? null);
  const slice = messages === null ? null : sliceUsage(messages, member.startedAt, member.endedAt ?? now);
  const usage = slice?.agents.find((a) => a.id === member.id) ?? null;
  if (member.kind === 'shell') {
    const parts = memberParts(member, now);
    return (
      <PopoverCard id={anchorId} className="agent-popover" data={{ 'data-member': member.id, 'data-kind': 'shell', 'data-working': working ? '' : 'no' }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
        <div className="agent-card-heading" style={style}>
          <SessionMark kind="shell" working={working} size="unit" className="agent-card-mark" />
          <span className="agent-card-name agent-card-command">{member.command ?? 'shell'}</span>
          <span className="agent-card-chips">
            <span className="agent-card-role">shell</span>
            <span className="agent-card-state">{working ? 'running' : 'finished'}</span>
          </span>
        </div>
        <div className="agent-card-session">
          session {session.name} · {parts.elapsed}
        </div>
      </PopoverCard>
    );
  }
  const commits = commitsLine(member.commits);
  const handle = memberHandle(member);
  const tasks = tasksOfAgent(session, member.id);
  return (
    <PopoverCard id={anchorId} className="agent-popover" data={{ 'data-member': member.id, 'data-working': working ? '' : 'no' }} anchor={anchor} onClose={onClose} onEnter={onEnter} onLeave={onLeave}>
      <div className="agent-card-heading" style={style}>
        <SessionMark kind="claude" working={working} size="unit" className="agent-card-mark" />
        <span className="agent-card-name">{agentLabel(member)}</span>
        <span className="agent-card-chips">
          {handle !== null && <span className="agent-card-handle">{handle}</span>}
          <span className="agent-card-role" data-type={member.type ?? undefined}>{agentRole(member)}</span>
          {word !== null && <span className="agent-card-model">{word}</span>}
          <span className="agent-card-state">{working ? 'working' : 'idle'}</span>
          {usd !== null && <span className="agent-card-price">{formatUsd(usd)}</span>}
        </span>
      </div>
      {member.branch !== null ? <div className="agent-card-branch">⑂ {member.branch}</div> : <div className="agent-card-branch" data-folder="">in the session's folder</div>}
      {commits !== null && <div className="agent-card-commits">{commits}</div>}
      <div className="agent-card-session">
        session {session.name} · {elapsed}
      </div>
      {member.prompt !== undefined && <div className="agent-card-prompt">{member.prompt}</div>}
      {(member.recent ?? []).slice(0, -1).map((phrase, i) => (
        <div key={i} className="agent-card-earlier">
          {phrase}
        </div>
      ))}
      {member.activity !== null && <div className="agent-card-activity">{member.activity}</div>}
      {tasks.length > 0 && (
        <div className="agent-card-tasks">
          {tasks.map((t) => (
            <div key={t.id} className="agent-card-task" data-status={t.status}>
              {t.subject}
            </div>
          ))}
        </div>
      )}
      {working && said !== null && (
        <div className="agent-card-now">
          <span className="agent-card-now-text">{said.text}</span>
          {said.age !== null && <span className="agent-card-now-age">{said.age}</span>}
        </div>
      )}
      {usage !== null && (
        <div className="agent-card-tokens">
          {`↑ ${formatTokens(tokensUp(usage.tokens))} sent, ↓ ${formatTokens(usage.tokens.output)} received${usage.usd === null ? '' : `, ~${formatUsd(usage.usd)}`}`}
        </div>
      )}
    </PopoverCard>
  );
}
