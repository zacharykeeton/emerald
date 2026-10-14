import { clockTime } from '@emerald/shared';
import type { ActivitySession, CappedSpan, DebtSpan } from '@emerald/shared';
import { usageWindowName } from './usage-model.ts';

// The hover words of the activity strip's spans and stretches, pure so
// the crosshair's lane line (M9 fix 251) can share them under node.

// The word for a track emerald did not start (M9 fix 233), on the span's
// and the name's hover; the daemon before level 45 answers no flag.
export const OUTSIDE_WORD = 'outside emerald';

export function outsideNote(s: Pick<ActivitySession, 'outside'>): string {
  return s.outside === true ? `\n${OUTSIDE_WORD}` : '';
}

// The hover: the session's name, when it ran, and what set it going; for
// an agent, its name and type and the parent it was sent out by; a
// track outside emerald says so on a last line.
export function spanTitle(s: ActivitySession, span: { from: number; prompt: string | null }, to: number, parentName?: string | null): string {
  const when = `${clockTime(span.from)} to ${clockTime(to)}`;
  if (s.agentId !== null && s.agentId !== undefined) {
    const name = s.name ?? 'an agent';
    const type = s.agentType !== null && s.agentType !== undefined && s.agentType !== s.name ? ` (${s.agentType})` : '';
    const by = parentName === undefined || parentName === null ? 'a subagent' : `a subagent of ${parentName}`;
    return `${name}${type} · ${when}\n${by}`;
  }
  const name = s.name ?? (s.outside === true ? 'a session outside emerald' : 'a session no longer listed');
  return (span.prompt === null ? `${name} · ${when}` : `${name} · ${when}\n${span.prompt}`) + outsideNote(s);
}

// The hover on a capped band (M9 fix 285): which usage window was spent,
// when, and when it reset.
export function cappedTitle(c: CappedSpan): string {
  return `${usageWindowName(c.window)} spent, ${clockTime(c.from)} to ${clockTime(c.to)}, reset ${clockTime(c.resetsAt)}`;
}

// The hover on a waiting stretch (M9 fix 231): the session's name, the
// kind in the user's words, and when.
export function debtTitle(s: ActivitySession, d: DebtSpan): string {
  const name = s.name ?? 'a session no longer listed';
  const what = d.kind === 'asked' ? 'asked, waiting on you' : 'done, unread past the grace';
  return `${name} · ${what} · ${clockTime(d.from)} to ${clockTime(d.to)}`;
}
