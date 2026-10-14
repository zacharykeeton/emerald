import type { SessionInfo, SessionState } from '@emerald/shared';

// M56: a prompt sent from the sidebar's box goes through the same two
// gates as emmer prompt (packages/cli/src/commands/prompt.ts). Gate one
// is here: a session waiting on a person would take the text as its
// answer, and an exited one has no PTY to take it. Gate two, that the
// session moves within STALL_MS of the Enter, is a watch on the store in
// actions.ts; a session already busy is taken as moving, since the text
// queues behind its turn.

// Claude Code posts UserPromptSubmit as soon as it takes the line; five
// seconds covers a box under load (the CLI's STALL_MS).
export const STALL_MS = 5000;

// The pause between the text and the Enter for a Claude session, so
// Claude Code does not take the two for one paste and turn the Enter
// into a newline (the CLI's CLAUDE_ENTER_DELAY_MS).
export const CLAUDE_ENTER_DELAY_MS = 1500;

const BUSY = new Set<SessionState>(['working', 'waiting']);

export function isBusy(state: SessionState): boolean {
  return BUSY.has(state);
}

// Why the text must not be sent, in the words the box shows; null when
// it may go.
export function promptRefusal(session: Pick<SessionInfo, 'state'>): string | null {
  if (session.state === 'exited') return 'Resume it first';
  if (session.state === 'needs-input') return 'Answer what it is waiting on first';
  return null;
}

// The words on the row when the session did not start working after the
// Enter, gate two's failure.
export const STALLED_TITLE = 'did not start working; the text may be sitting in its input box';
