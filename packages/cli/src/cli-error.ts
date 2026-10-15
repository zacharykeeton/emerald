// Exit codes, in one place so scripts can rely on them:
//   0   done
//   1   something went wrong (no daemon, no such session, request refused)
//   2   emmer wait (or prompt) gave up before the state arrived
//   3   emmer prompt sent the text and the session never started working
//   64  the command line itself was wrong (sysexits EX_USAGE)
//   69  the command needs a window and none is open (emmer open, emmer update; sysexits EX_UNAVAILABLE)
//   75  emmer open reached a window that did not answer within 3 s; the open may still land (sysexits EX_TEMPFAIL)
//   77  emmer browser: the person clicked or typed in the driven page; emmer browser resume hands it back (sysexits EX_NOPERM)
export const EXIT = {
  ok: 0,
  failure: 1,
  timeout: 2,
  stalled: 3,
  usage: 64,
  noWindow: 69,
  noAnswer: 75,
  paused: 77,
} as const;

// The one line for a command that needs a window when none is open (M9
// fix 540), thrown with EXIT.noWindow; its tail matches the daemon's own
// not-running line in connect.ts.
export const NO_WINDOW = 'no window open; open the Emerald app';

// An error the router prints as one line on stderr, then exits with the code.
export class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number = EXIT.failure) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.usage);
}
