import type { ReactNode } from 'react';
import { ROSTER_NOTE, describeState, hasState, markKind, memberParts, modelWord, rollupLines, rollupWords, rosterLines, workingMotion } from '@emerald/shared';
import type { FolderRollup, SessionInfo, TeamCounts, TeamMember } from '@emerald/shared';
import { PopoverAnchor, PopoverCard } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { SessionMark } from './session-mark.tsx';
import type { MarkSize } from './session-mark.tsx';

// The roster (M46): one unit per kind with its count, on a row's sub
// line, in a pane title and on a folder heading, and (fix 88) on the
// title bar. The marks are session-mark.tsx's; this file holds the units
// and, since M9 fix 89, the card that opens on them: the roster is a
// mark and a count per kind, and nothing on screen said what the marks
// meant, so the card (Popover.tsx: hover after a moment, a click pins
// it) says first what the visual is saying, one sentence per unit shown
// with that unit's own mark beside it, then where the counts come from,
// then the details: the members for a session's roster, the sessions
// for a heading's. The title attributes the rosters carried are gone,
// the card being the tooltip; the title bar's units too since M73 (task
// 3), their span the one no-drag spot on the bar's drag region.

interface UnitShown {
  unit: string;
  kind: 'claude' | 'shell';
  working: boolean;
}

// A roster's units in its order: agents still out (stepping), agents
// returned this turn (still), background shells running now (the caret
// blinking); a kind with nothing in it prints nothing. The shells that
// finished this turn are a unit of the card alone (M9 fix 101), so the
// row's number is the one Claude Code's own status line prints.
function rosterUnits(counts: TeamCounts, card = false): UnitShown[] {
  const units: UnitShown[] = [];
  if (counts.out > 0) units.push({ unit: 'out', kind: 'claude', working: true });
  if (counts.returned > 0) units.push({ unit: 'returned', kind: 'claude', working: false });
  if (counts.shells > 0) units.push({ unit: 'shells', kind: 'shell', working: true });
  if (card && counts.shellsReturned > 0) units.push({ unit: 'shells-returned', kind: 'shell', working: false });
  return units;
}

// A heading's, the same shapes split active and inactive
// (docs/design/team-roster.md section 3).
function rollupUnits(roll: FolderRollup): UnitShown[] {
  const units: UnitShown[] = [];
  if (roll.agentsActive > 0) units.push({ unit: 'agents-active', kind: 'claude', working: true });
  if (roll.agentsInactive > 0) units.push({ unit: 'agents-inactive', kind: 'claude', working: false });
  if (roll.shellsRunning > 0) units.push({ unit: 'shells-running', kind: 'shell', working: true });
  if (roll.shellsIdle > 0) units.push({ unit: 'shells-idle', kind: 'shell', working: false });
  return units;
}

// The roster on a row's sub line and in a pane title; an empty team
// prints no roster at all, so a lone session's row looks as it did.
// Folded (a squeezed pane title, M9 fix 77) it is one unit, the total
// behind the mark of the most alive kind, an agent out, else one
// returned, else the shells. The card opens on either form.
export function RosterUnits({ id, counts, members, size, now, folded, models, onClick }: { id: string; counts: TeamCounts; members: readonly TeamMember[]; size: MarkSize; now?: number | undefined; folded?: boolean | undefined; models?: Record<string, string> | undefined; onClick?: (() => void) | undefined }) {
  // A team of finished shells alone still opens the card, off a roster
  // with nothing on it otherwise; the row prints no unit for them.
  if (counts.out === 0 && counts.returned === 0 && counts.shells === 0) return null;
  const anchorId = `roster:${id}`;
  const card = (props: CardProps) => <RosterCard counts={counts} members={members} now={now} models={models} anchorId={anchorId} {...props} />;
  if (folded === true) {
    const alive = counts.out > 0 ? 'out' : counts.returned > 0 ? 'returned' : 'shells';
    return (
      <PopoverAnchor id={anchorId} className="roster" data={{ 'data-size': size, 'data-folded': '' }} card={card} onClick={onClick}>
        <Unit unit="total" kind={alive === 'shells' ? 'shell' : 'claude'} working={alive === 'out' || alive === 'shells'} count={counts.out + counts.returned + counts.shells} size={size} alive={alive} />
      </PopoverAnchor>
    );
  }
  return (
    <PopoverAnchor id={anchorId} className="roster" data={{ 'data-size': size }} card={card} onClick={onClick}>
      {counts.out > 0 && <Unit unit="out" count={counts.out} kind="claude" working size={size} />}
      {counts.returned > 0 && <Unit unit="returned" count={counts.returned} kind="claude" working={false} size={size} />}
      {counts.shells > 0 && <Unit unit="shells" count={counts.shells} kind="shell" working size={size} />}
    </PopoverAnchor>
  );
}

// The folder heading's units, with the card listing the group's
// sessions; the title bar shows the same four over every folder (M9 fix
// 88) at its own size, its card listing every session (M73). A caller
// with no sessions to list opens no card and keeps the units in words
// as its hover.
export function HeadingUnits({ id, roll, sessions, size = 'heading' }: { id?: string | undefined; roll: FolderRollup; sessions?: readonly SessionInfo[] | undefined; size?: MarkSize | undefined }) {
  const units = rollupUnits(roll).map((u) => <Unit key={u.unit} unit={u.unit} count={countOf(roll, u.unit)} kind={u.kind} working={u.working} size={size} />);
  if (sessions === undefined || id === undefined) {
    return (
      <span className="roster" data-size={size} title={rollupWords(roll)}>
        {units}
      </span>
    );
  }
  const anchorId = `rollup:${id}`;
  return (
    <PopoverAnchor id={anchorId} className="roster" data={{ 'data-size': size }} card={(props) => <RollupCard roll={roll} sessions={sessions} anchorId={anchorId} {...props} />}>
      {units}
    </PopoverAnchor>
  );
}

function countOf(roll: FolderRollup, unit: string): number {
  switch (unit) {
    case 'agents-active':
      return roll.agentsActive;
    case 'agents-inactive':
      return roll.agentsInactive;
    case 'shells-running':
      return roll.shellsRunning;
    default:
      return roll.shellsIdle;
  }
}

// data-alive on the folded total says which kind's colour it takes.
function Unit({ unit, count, kind, working, size, alive }: { unit: string; count: number; kind: 'claude' | 'shell'; working: boolean; size: MarkSize; alive?: string | undefined }) {
  return (
    <span className="roster-unit" data-unit={unit} data-alive={alive}>
      <SessionMark kind={kind} working={working} size={size} />
      <span className="roster-count">{count}</span>
    </span>
  );
}

// One unit's sentence with its mark, the mark stepping for an active
// unit and still for the rest, as on the roster itself; the unit's own
// colour through the roster-unit rules.
function UnitLine({ unit, kind, working, text }: UnitShown & { text: string }) {
  return (
    <div className="roster-card-unit" data-unit={unit}>
      <span className="roster-unit" data-unit={unit}>
        <SessionMark kind={kind} working={working} size="unit" />
      </span>
      <span className="roster-card-text">{text}</span>
    </div>
  );
}

function CardFrame({ units, lines, children, ...card }: CardProps & { anchorId: string; units: UnitShown[]; lines: string[]; children: ReactNode }) {
  return (
    <PopoverCard id={card.anchorId} className="roster-popover" anchor={card.anchor} onClose={card.onClose} onEnter={card.onEnter} onLeave={card.onLeave}>
      <div className="roster-card-units">
        {units.map((u, i) => (
          <UnitLine key={u.unit} {...u} text={lines[i] ?? ''} />
        ))}
      </div>
      <div className="roster-card-note">{ROSTER_NOTE}</div>
      {children}
    </PopoverCard>
  );
}

export function RosterCard({ counts, members, now, models, ...card }: CardProps & { counts: TeamCounts; members: readonly TeamMember[]; now?: number | undefined; models?: Record<string, string> | undefined; anchorId: string }) {
  const at = now ?? Date.now();
  const parts = members.map((m) => ({ id: m.id, model: modelWord(models?.[m.id] ?? null), ...memberParts(m, at) }));
  // The running ones first, each set in spawn order.
  const ordered = [...parts.filter((p) => p.working), ...parts.filter((p) => !p.working)];
  return (
    <CardFrame units={rosterUnits(counts, true)} lines={rosterLines(counts)} {...card}>
      {ordered.length > 0 && (
        <div className="roster-card-members">
          {ordered.map((p) => (
            <div key={p.id} className="roster-card-member" data-working={p.working || undefined} data-kind={p.kind}>
              <span className="roster-unit" data-unit={p.kind === 'shell' ? (p.working ? 'shells' : 'shells-returned') : p.working ? 'out' : 'returned'}>
                <SessionMark kind={p.kind === 'shell' ? 'shell' : 'claude'} working={p.working} size="unit" family={p.model} />
              </span>
              <span className="roster-card-member-type">{p.type}</span>
              {p.model !== null && <span className="roster-card-member-model">{p.model}</span>}
              <span className="roster-card-member-elapsed">{p.elapsed}</span>
              {p.task !== null && <span className="roster-card-member-task">{p.task}</span>}
            </div>
          ))}
        </div>
      )}
    </CardFrame>
  );
}

export function RollupCard({ roll, sessions, ...card }: CardProps & { roll: FolderRollup; sessions: readonly SessionInfo[]; anchorId: string }) {
  return (
    <CardFrame units={rollupUnits(roll)} lines={rollupLines(roll)} {...card}>
      <div className="roster-card-members">
        {sessions.map((s) => {
          const kind = markKind(s);
          const label = hasState(s) ? describeState(s) : null;
          const working = kind === 'claude' ? workingMotion(s) !== null : false;
          return (
            <div key={s.id} className="roster-card-member" data-session-id={s.id} data-working={working || undefined} data-kind={kind}>
              <SessionMark kind={kind} tone={kind === 'claude' ? label?.tone : undefined} working={working} size="unit" />
              <span className="roster-card-member-type">{s.name}</span>
              {label !== null && <span className="roster-card-member-elapsed">{label.text}</span>}
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
