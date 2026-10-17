import type { SessionInfo } from '@emerald/shared';

// The reason Claude Code's SessionEnd gives for /exit (typed, or sent from
// the chat box or the / menu).
export const EXIT_TO_SHELL_REASON = 'prompt_input_exit';

// M9 fix 813: the Claude sessions this window saw running that have now
// exited with /exit, whose panes drop to a shell. A session first seen
// exited (a reload, a new window, a daemon restart) is never one, so a
// reload fails safe. An exit whose SessionEnd has not landed yet (its
// reason still unset) stays in live for the next call to read.
export function exitsToShell(live: ReadonlySet<string>, sessions: Iterable<Pick<SessionInfo, 'id' | 'kind' | 'state' | 'endReason'>>): { live: Set<string>; exited: string[] } {
  const next = new Set<string>();
  const exited: string[] = [];
  for (const s of sessions) {
    if (s.kind !== 'claude') continue;
    if (s.state !== 'exited') {
      next.add(s.id);
      continue;
    }
    if (!live.has(s.id)) continue;
    const reason = s.endReason ?? null;
    if (reason === null) next.add(s.id);
    else if (reason === EXIT_TO_SHELL_REASON) exited.push(s.id);
  }
  return { live: next, exited };
}
