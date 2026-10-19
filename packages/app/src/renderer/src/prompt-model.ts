import { MOD_CHANNEL_LEVEL, modRoutable } from '@emerald/shared';
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

// The least time between two Ctrl+Cs any renderer sender sends one
// session (M9 fix 748, shared since fix 783: sendCtrlC in actions.ts).
// Claude Code 2.1.301 counts any Ctrl+C toward its press-again exit, the
// one that clears the input too: two Ctrl+Cs 0.4 s apart ended the
// session in fix 748's runs, 1.6 s apart did not.
export const CTRL_C_GAP_MS = 2000;

// How long a Ctrl+C must wait after the last one sent to the session.
export function ctrlCWaitMs(last: number | undefined, now: number): number {
  return last === undefined ? 0 : Math.max(0, last + CTRL_C_GAP_MS - now);
}

// M9 fix 781: how a prompt from the renderer reaches the session. A plain
// prompt to a Claude whose daemon has session.submit goes in through its
// emerald mod, with no Enter pause, when the session is not busy. A send
// while it works is typed, since a mod submit made mid-turn waits in the
// mod's own chain and writes no enqueue line, which would lose fix 754's
// Queued card; Claude Code's own queue holds a typed one. A session at
// waiting (its turn ended with a background task still running) is at
// rest for this: the mod takes the submit at once there (read on Claude
// Code 2.1.303, M9 fix 911), and there is no turn to queue behind. `typed`
// is the caller's word that the text must be typed (an image chip's
// [Image #N] marker lives in Claude Code's input, and a mod submit would
// leave it there). The daemon itself answers typed when the mod has no
// channel.
export function sendRoute(session: Pick<SessionInfo, 'kind' | 'state'>, text: string, level: number, typed: boolean): 'mod' | 'typed' {
  if (typed || session.kind !== 'claude' || level < MOD_CHANNEL_LEVEL) return 'typed';
  if (session.state === 'working' || session.state === 'needs-input') return 'typed';
  return modRoutable(text) ? 'mod' : 'typed';
}

// M9 fix 781: one chain per key, so two quick sends to one session stay
// two messages; without it the second's text was typed inside the first's
// Enter pause and the TUI read one line. A run starts once the previous run
// for the key has settled, resolved or rejected, and the key is dropped
// when its last run settles, so an idle session holds nothing.
export function chainOn<T>(chains: Map<string, Promise<unknown>>, key: string, run: () => Promise<T>): Promise<T> {
  const before = chains.get(key) ?? Promise.resolve();
  const result = before.then(run, run);
  const tail: Promise<unknown> = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}
