import { Limits, commandText, shellCommand } from '@emerald/shared';
import type { SessionInfo, ShellCommand } from '@emerald/shared';

// The pure part of the session mark (M46, once the state meter's): which
// rate samples a mark's tooltip reads, and whether a shell is running a
// command. The samples are the bytes the PTY wrote in each of the last
// Limits.rateSamples windows, oldest first, pushed by a daemon at feature
// level 14 or later (M41); an older daemon never sends them.

export const RATE_FEATURE_LEVEL = 14;

// The samples behind a working Claude mark's tooltip, or null: only a
// session in motion (working, not stale, the M33 rule) on a daemon that
// sends rates, and only once a push has arrived for it.
export function liveSamples(working: string | null | undefined, featureLevel: number | null | undefined, samples: number[] | undefined): number[] | null {
  if (working === null || working === undefined) return null;
  if (featureLevel === null || featureLevel === undefined || featureLevel < RATE_FEATURE_LEVEL) return null;
  if (samples === undefined) return null;
  return samples;
}

// Whether a shell is running a command. The record says since M9 fix
// 196: the daemon reads the prompt's marks and keeps the last command,
// running from its Enter to the next prompt, which holds through a
// command's silence and knows a failure's code. A shell whose prompt
// never reports (cmd, a bash, an older daemon) has no command on the
// record, so the guess before it stands: the PTY writes while a command
// runs and sits quiet at the prompt, so the last rate window says. The
// daemon's last report of a burst is all zeros, so the caret stops on
// its own about a second after the output does; a session no push has
// reached is at its prompt.
export function shellRunning(samples: readonly number[] | undefined, command?: ShellCommand | null): boolean {
  if (command !== undefined && command !== null) return command.state === 'running';
  return samples !== undefined && (samples[samples.length - 1] ?? 0) > 0;
}

// The shell sessions running a command, for the headings' units and the
// title bar's (M9 fix 88): built once per render of each rather than per
// heading. Every session is read, since a shell mid-command on the
// record may have no rate push yet.
export function runningShells(rates: ReadonlyMap<string, readonly number[]>, sessions: Iterable<Pick<SessionInfo, 'id' | 'kind' | 'claudeSessionId' | 'command'>>): Set<string> {
  const running = new Set<string>();
  for (const s of sessions) if (shellRunning(rates.get(s.id), shellCommand(s))) running.add(s.id);
  return running;
}

// The mark's tooltip on a shell with no badge: the last command's words
// when the prompt reports them (M9 fix 196), else what the mark can mean.
export function shellMarkTitle(command: ShellCommand | null, now: number): string {
  return command === null ? 'A shell at its prompt, or running a command' : commandText(command, now);
}

// The busiest of several sessions per window, for a mark over a group.
export function maxSamples(lists: readonly number[][]): number[] | null {
  if (lists.length === 0) return null;
  const width = Math.max(...lists.map((l) => l.length));
  const out: number[] = [];
  for (let i = 0; i < width; i++) out.push(Math.max(0, ...lists.map((l) => l[l.length - width + i] ?? 0)));
  return out;
}

// The last window as a rate, for the tooltip.
export function rateText(samples: readonly number[]): string {
  const last = samples[samples.length - 1] ?? 0;
  const perSecond = (last * 1000) / Limits.rateWindowMs;
  if (perSecond >= 1024) return `${(perSecond / 1024).toFixed(1)} KB/s`;
  return `${Math.round(perSecond)} B/s`;
}

// The still star's size for a team member's unit mark by the model's
// family (M9 fix 288): the sidebar's fold, the shade's list and the
// graph's agent markers all step a member's star by the family the
// agents-running answer names, so 12 says Fable, 10 Opus, 8 Sonnet or
// Haiku; a member with no request yet sits at the unit's usual 10. The
// session's own star never takes it.
export function familyStar(word: string | null): 12 | 10 | 8 {
  if (word === 'Fable') return 12;
  if (word === 'Sonnet' || word === 'Haiku') return 8;
  return 10;
}
