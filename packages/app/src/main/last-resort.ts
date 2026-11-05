// The main process's last resort (M9 fix 1071). With no listener for an
// uncaught exception, Electron shows its own modal error box, which on a
// Mac blocks the main thread and freezes the window, and CDP with it. A
// listener is what stops the box, so main logs the throw and carries on:
// the window's state is a view of the daemon's, which a reload rebuilds,
// and a half-working window is better than a frozen modal. The corner gets
// a line naming the log. A rejection is logged alone: Electron shows no box
// for one, and a rejection is often a fire-and-forget promise that a note
// would make noisy.

export const LAST_RESORT_NOTE = 'Something went wrong in Emerald; logs/main.log under the emerald home has the details';

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  if (err !== null && typeof err === 'object') {
    const e = err as { stack?: unknown; message?: unknown };
    if (typeof e.stack === 'string') return e.stack;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

export function installLastResort(proc: Pick<NodeJS.EventEmitter, 'on'>, log: (msg: string) => void, note: (text: string) => void): void {
  proc.on('uncaughtException', (err: unknown) => {
    log(`uncaught exception in main: ${describe(err)}`);
    // The handler can run before the windows exist (a throw while index.ts
    // is still evaluating meets its bindings in their dead zone), and a
    // throw out of here would end the process.
    try {
      note(LAST_RESORT_NOTE);
    } catch {
      // No window to tell; the log has the line.
    }
  });
  proc.on('unhandledRejection', (reason: unknown) => {
    log(`unhandled rejection in main: ${describe(reason)}`);
  });
}
