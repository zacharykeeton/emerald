import { updateText } from '@emerald/shared';
import type { UpdateState } from '@emerald/shared';
import { parse, positionals } from '../args.ts';
import { CliError, EXIT, NO_WINDOW, usageError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connectHello } from '../connect.ts';

// The badge's clicks from the command line (M9 fix 271), so a batch run
// from a pane can install itself: the daemon keeps the updater's state
// the app reports and relays a click to the window as update.requested,
// which runs the same act() the badge does (check, download, restart to
// install). The CLI never touches the feed or the installer itself; a
// box with no window open has nothing to click.
const options = {
  check: { type: 'boolean', default: false },
  download: { type: 'boolean', default: false },
  install: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
} as const;

// The first daemon build with the relay.
const UPDATE_LEVEL = 49;
// No updater state was ever reported (never, where NO_WINDOW is now).
const NO_REPORT = 'no window has reported; open the Emerald app';

export interface UpdateRunOptions {
  // How often the state is read while a step runs; a test shortens it.
  pollMs?: number;
  // How long a check and a download may take before the command gives up.
  checkTimeoutMs?: number;
  downloadTimeoutMs?: number;
  print?: (line: string) => void;
}

type Mode = 'show' | 'check' | 'download' | 'install';

// Runs one `emmer update` and returns the exit code; exported so the test
// drives it against a stub daemon without a process.
export async function runUpdate(argv: string[], opts: UpdateRunOptions = {}): Promise<number> {
  const parsed = parse(argv, options);
  positionals(parsed, []);
  const picked = (['check', 'download', 'install'] as const).filter((k) => parsed.values[k]);
  if (picked.length > 1) throw usageError(`pick one of --${picked.join(', --')}`);
  const mode: Mode = picked[0] ?? 'show';
  const json = parsed.values.json;
  const print = opts.print ?? println;
  const pollMs = opts.pollMs ?? 500;

  const { client, hello } = await connectHello();
  try {
    const level = hello.featureLevel ?? 1;
    if (level < UPDATE_LEVEL) throw new CliError(`emmerd ${hello.daemonVersion} is older than emmer update (level ${level}, needs ${UPDATE_LEVEL}); restart it from the app's banner`);

    const read = () => client.request('update.state', {});
    let last = await read();
    if (mode === 'show') {
      if (json) {
        printJson(last);
        return last.state === null ? EXIT.failure : EXIT.ok;
      }
      if (last.state === null) {
        print(NO_REPORT);
        return EXIT.failure;
      }
      print(updateText(last.state) + (last.apps === 0 ? ' (no window open now)' : ''));
      return EXIT.ok;
    }

    // The steps. Every act goes to the window; the state comes back
    // through the daemon, so a step waits for the report that shows the
    // click took (the state differs from the one before the act) and
    // then for the phase it is heading for.
    const act = async () => {
      const { apps } = await client.request('update.act', {});
      if (apps === 0) throw new CliError(NO_WINDOW, EXIT.noWindow);
    };
    let shown: string | null = null;
    const show = (state: UpdateState) => {
      // Each phase once; a download's percent every quarter; an idle
      // again when its message moved, since that is a check's outcome.
      const text = updateText(state);
      // An idle is keyed on its count as well where the window reports
      // one (M9 fix 539), so an answer that reads the same as the line
      // before is still printed.
      const idleKey = state.checks === undefined ? text : `${text} #${state.checks}`;
      const key = state.phase === 'downloading' ? `downloading ${Math.floor((state.percent ?? 0) / 25)}` : state.phase === 'idle' ? idleKey : state.phase;
      if (key === shown) return;
      shown = key;
      if (json) printJson(state);
      else print(text);
    };
    const waitUntil = async (what: string, done: (s: UpdateState) => boolean, timeoutMs: number): Promise<UpdateState> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        last = await read();
        if (last.state !== null) {
          show(last.state);
          if (done(last.state)) return last.state;
          if (last.state.phase === 'error') throw new CliError(`update failed: ${last.state.message ?? 'unknown error'}`);
          if (last.state.phase === 'off') throw new CliError('the update check is off in this build');
        }
        if (Date.now() >= deadline) throw new CliError(`timed out waiting for ${what}`, EXIT.timeout);
        await sleep(pollMs);
      }
    };

    if (last.apps === 0) throw new CliError(NO_WINDOW, EXIT.noWindow);
    if (last.state === null) throw new CliError(NO_REPORT);
    let state = last.state;
    show(state);
    if (state.phase === 'off') throw new CliError('the update check is off in this build');

    // check: from idle or error one act runs a check; any other phase is
    // already past it and is printed as it is.
    if (state.phase === 'idle' || state.phase === 'error') {
      // The check's answer is the window's count moving (M9 fix 539): a
      // local check answers inside one poll, and one in the same minute as
      // the last reads the same, so the state alone may never differ. A
      // window from before the count keeps the old rule.
      const before = JSON.stringify(state);
      const beforeChecks = state.checks;
      await act();
      const answered = (s: UpdateState) => (beforeChecks === undefined ? JSON.stringify(s) !== before : (s.checks ?? 0) > beforeChecks) && s.phase !== 'checking';
      state = await waitUntil('the check', answered, opts.checkTimeoutMs ?? 30000);
    } else if (state.phase === 'checking') {
      state = await waitUntil('the check', (s) => s.phase !== 'checking', opts.checkTimeoutMs ?? 30000);
    }
    if (mode === 'check') return EXIT.ok;

    // download: available takes one act and the wait runs to ready.
    if (state.phase === 'idle') {
      print('nothing to download');
      return EXIT.ok;
    }
    if (state.phase === 'available') await act();
    if (state.phase === 'available' || state.phase === 'downloading') {
      state = await waitUntil('the download', (s) => s.phase === 'ready' || s.phase === 'installing', opts.downloadTimeoutMs ?? 15 * 60 * 1000);
    }
    if (mode === 'download') return EXIT.ok;

    // install: the last click. The window closes, the daemon stops and
    // this process's own pty goes with it, so the command returns the
    // moment the act is sent rather than waiting for a reply that may
    // never come.
    if (state.phase === 'ready') {
      await act();
      print(`installing ${state.latest ?? '?'}: the window closes, the daemon stops with every screen kept, and every pane comes back through Resume once the new build opens`);
    }
    return EXIT.ok;
  } finally {
    client.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const command: Command = {
  name: 'update',
  summary: "show the app's update state, or click its badge: --check, --download, --install",
  usage: 'emmer update [--check | --download | --install] [--json]',
  run: (argv) => runUpdate(argv),
};

export default command;
