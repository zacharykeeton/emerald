import { clockTime, shortModel } from '@emerald/shared';
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
  const words = effortWords(s, span.from, to);
  const head = words === null ? `${name} · ${when}` : `${name} · ${when} · ${words}`;
  return (span.prompt === null ? head : `${head}\n${span.prompt}`) + outsideNote(s);
}

// M9 fix 852: the model and effort a span ran at, off its request points, in fix 800's words ("Opus 5.5 · high"); each pair once, in the order first met, a later one on the same model as the pair before it giving the level alone ("Opus 5.5 · high, then medium"); a point with no effort counts for nothing, so an older daemon's span reads as before.
export function effortWords(s: Pick<ActivitySession, 'requests'>, from: number, to: number): string | null {
  const named = new Set<string>();
  const parts: string[] = [];
  let lastModel: string | null = null;
  for (const p of s.requests ?? []) {
    if (p.at < from || p.at > to) continue;
    const effort = p.effort;
    if (typeof effort !== 'string' || effort === '') continue;
    const pair = `${p.model ?? ''}\n${effort}`;
    if (named.has(pair)) continue;
    named.add(pair);
    parts.push(p.model === null || p.model === lastModel ? effort : `${shortModel(p.model)} · ${effort}`);
    lastModel = p.model;
  }
  return parts.length === 0 ? null : parts.join(', then ');
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
