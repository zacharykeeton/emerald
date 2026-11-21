import type { SessionInfo } from '@emerald/shared';
import type { NotifyRequest } from '../../preload/api.ts';
import { answerOptions } from './screen-prompt-model.ts';

// A permission ask answered from its Windows toast (M9 fix 1199): the
// toast's words and buttons, the check a press goes through before it
// types anything, and the pieces of the ask card's head. Pure, so a test
// reads every branch; ask-notify.ts holds the effects.

type Asked = NonNullable<SessionInfo['askedFor']>;

// The asking agent's name under an agent's permission ask: the team
// member's type, else the bare word.
export function askAgentName(session: Pick<SessionInfo, 'team' | 'askedFor'>): string {
  const id = session.askedFor?.agentId ?? null;
  const member = id === null ? undefined : session.team?.find((m) => m.id === id);
  return member?.type ?? 'agent';
}

function isPermission(session: Pick<SessionInfo, 'needsInputReason'>): boolean {
  return session.needsInputReason === 'permission' || session.needsInputReason === 'agent-permission';
}

// The toast for a permission ask the mod named, with its command in full
// on its own line and the ask main gives Allow once and Deny; null for any
// other arrival, which keeps today's toast.
export function askNotice(session: SessionInfo): NotifyRequest | null {
  const asked = session.askedFor ?? null;
  if (session.state !== 'needs-input' || !isPermission(session) || asked === null || asked.input === null || asked.toolUseId === null) return null;
  const agent = session.needsInputReason === 'agent-permission' ? askAgentName(session) : null;
  return {
    sessionId: session.id,
    title: agent === null ? session.name : `${session.name} · ${agent}`,
    body: agent === null ? `Claude asks to run ${asked.tool}:\n${asked.input}` : `Agent ${agent} asks to run ${asked.tool}:\n${asked.input}`,
    ask: { toolUseId: asked.toolUseId, command: asked.input },
  };
}

// What a toast's press sends, or why it sends nothing. Checked in this
// order, each drop with its own words; anything not a live permission
// dialog for the very call the toast was posted with is a drop. Deny is
// Escape, Claude Code's own reject-and-stop, never 3 (which wants words).
export function toastAnswer(o: { session: SessionInfo | undefined; toolUseId: string; index: number; rows: readonly string[] | null; answered: boolean }): { keys: '1' | '\x1b'; allowed: boolean } | { dropped: string } {
  if (o.answered) return { dropped: 'already answered' };
  const session = o.session;
  if (session === undefined) return { dropped: 'the session is gone' };
  if (session.state !== 'needs-input' || !isPermission(session)) return { dropped: 'the ask is over' };
  if (session.askedFor?.toolUseId !== o.toolUseId) return { dropped: 'another ask is up' };
  if (o.index !== 0 && o.index !== 1) return { dropped: 'no such action' };
  if (o.rows === null) return { dropped: 'the screen could not be read' };
  const first = answerOptions(o.rows)[0];
  if (first === undefined || first.key !== '1' || !first.label.startsWith('Yes')) return { dropped: 'the screen shows no permission dialog' };
  return o.index === 0 ? { keys: '1', allowed: true } : { keys: '\x1b', allowed: false };
}

// Whether the ask card and the answer popover head with the mod's record
// (AskHead) rather than the screen's excerpt: a permission ask whose input
// the mod named. A daemon before level 85 sends no input, so the excerpt.
export function askHeadShown(session: Pick<SessionInfo, 'needsInputReason' | 'askedFor'>): boolean {
  return isPermission(session) && session.askedFor !== undefined && session.askedFor !== null && session.askedFor.input != null;
}

// The ask card's head lines off the mod's record: the input's own
// description, and under an agent's ask the agent it is for; and why it
// was asked, the rule when there is one, else the reason, else nothing
// (no wording of our own, the handoff's correction 2).
export function askHeadParts(asked: Pick<Asked, 'description' | 'rule' | 'reason'>, agent: string | null): { desc: string | null; why: string | null } {
  const forAgent = agent === null ? null : `for agent ${agent}`;
  const desc = asked.description !== null ? (forAgent === null ? asked.description : `${asked.description} ${forAgent}`) : forAgent;
  const why = asked.rule !== null ? `Rule: ${asked.rule}` : asked.reason;
  return { desc, why };
}
