// The window-wide toast's words (M9 fix 1181): a refused Clear exited,
// Resume all or folder sweep says on screen how many of how many failed and
// why, where before it reached the console alone. Plain functions, so a
// test imports them without the DOM.

// How long a toast stays up (M9 fix 1181); a new one replaces it and starts the time again.
export const TOAST_MS = 8000;

export type RefusedVerb = 'clear' | 'resume' | 'close' | 'kill' | 'remove';

export function refusedText(verb: RefusedVerb, failed: number, total: number, reason: string): string {
  const exited = verb === 'clear' || verb === 'resume';
  const one = total === 1;
  const noun = exited ? (one ? 'exited session' : 'exited sessions') : one ? 'session' : 'sessions';
  return `Could not ${verb} ${failed} of ${total} ${noun}: ${reason}`;
}

// An uncoded rejection from main reaches the page with Electron's prefix
// ("Error invoking remote method 'emerald:request': Error: stub is
// unreachable"); a coded one is decoded clean by the preload. Either way the
// toast shows the reason alone.
export function refusalReason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

// A single refused Resume or rename (M9 fix 1198): what was asked and why,
// with no session named, since the click was on it.
export type FailedVerb = 'resume' | 'rename';

export function failedText(verb: FailedVerb, err: unknown): string {
  return `Could not ${verb}: ${refusalReason(err)}`;
}
