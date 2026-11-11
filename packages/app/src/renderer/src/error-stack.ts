// The stack of an uncaught error in the window, kept as one console line
// (M9 fix 1128). Chromium's own `Uncaught ...` console message carries the
// bundle's line and no stack, so the xterm `loadCell` and `isWrapped` throws
// of the installed build named only `index-<hash>.js:<line>` in main.log;
// this writes the stack beside it once per distinct throw, so the next burst
// names its frame. Main writes a line with this prefix as a note
// (renderer-log.ts), so neither of the usage report's counts moves.
// Imports nothing, so a test runs stackLine under node --test.

// Frames V8 keeps per stack (Error.stackTraceLimit) against its default 10,
// since an emerald frame under xterm's own is likely past the tenth.
export const ERROR_STACK_FRAMES = 30;
// The most of one folded stack kept in its line.
export const ERROR_STACK_CHARS = 4000;
// Distinct stacks logged in one page load; a burst of one throw logs once.
export const ERROR_STACKS_KEPT = 20;
export const ERROR_STACK_PREFIX = '[emerald] uncaught stack: ';

export function stackLine(err: unknown, seen: Set<string>): string | null {
  if (!(err instanceof Error)) return null;
  const stack = err.stack;
  if (typeof stack !== 'string' || stack === '') return null;
  const folded = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' | ')
    .slice(0, ERROR_STACK_CHARS);
  if (folded === '') return null;
  if (seen.has(folded) || seen.size >= ERROR_STACKS_KEPT) return null;
  seen.add(folded);
  return ERROR_STACK_PREFIX + folded;
}

const seen = new Set<string>();

export function startErrorStacks(): void {
  // V8's own field, which the DOM lib's ErrorConstructor does not declare.
  (Error as unknown as { stackTraceLimit: number }).stackTraceLimit = ERROR_STACK_FRAMES;
  // No preventDefault: Chromium's own Uncaught line still goes out as before.
  window.addEventListener('error', (ev) => {
    const line = stackLine(ev.error, seen);
    if (line !== null) console.error(line);
  });
}
