import { integerOption, parse, positionals } from '../args.ts';
import { CliError } from '../cli-error.ts';
import { printJson, println } from '../command.ts';
import type { Command } from '../command.ts';
import { connect } from '../connect.ts';
import { DEFAULT_EXPLAIN_LINES, hookLogPath, lastEventsFor, readHookLog, readLastHookEvents, readStoredSessions, renderExplain, subjectFromSession, subjectFromStored } from '../explain.ts';
import type { ExplainJson, ExplainSubject } from '../explain.ts';
import { resolveSession } from '../resolve.ts';

const options = {
  // How many of the session's hook events to print, newest kept.
  lines: { type: 'string' },
  // Read every kept generation for the exact total, as before fix 541.
  all: { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
} as const;

// The session as the daemon has it, or as sessions.json last wrote it when
// there is no daemon to ask: explain is for the moment a row looks wrong,
// and that includes the daemon being down.
async function subject(ref: string): Promise<ExplainSubject> {
  let client;
  try {
    client = await connect();
  } catch (err) {
    if (!(err instanceof CliError) || !/not running/.test(err.message)) throw err;
    const stored = readStoredSessions().map((s) => ({ ...s, state: s.exitedAt === null ? ('idle' as const) : ('exited' as const) }));
    if (stored.length === 0) throw new CliError('emmerd is not running and sessions.json lists no sessions');
    const found = resolveSession(stored, ref);
    return subjectFromStored(found);
  }
  try {
    const { sessions } = await client.request('session.list', {});
    const found = subjectFromSession(resolveSession(sessions, ref));
    // The kept frame (M9 fix 159): an exited session's pane shows it, so
    // the report does too. A daemon from before the request answers no
    // rows and no kept mark.
    if (found.state === 'exited') {
      const screen = await client.request('pty.screen', { sessionId: found.id }).catch(() => null);
      if (screen !== null && screen.kept === true) found.screen = screen.rows;
    }
    return found;
  } finally {
    client.close();
  }
}

const command: Command = {
  name: 'explain',
  summary: 'say why a session is in its state, from its hook events',
  usage: `emmer explain <session> [--lines N] [--all] [--json]`,
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    const lines = integerOption(parsed.values.lines, 'lines', DEFAULT_EXPLAIN_LINES);
    const found = await subject(session);
    const logFile = hookLogPath();
    // The backward read stops once it has enough (M9 fix 541); --all is
    // the whole read, for the exact total.
    const { events, total } = parsed.values.all ? lastEventsFor(await readHookLog(logFile, found.id), found.id, lines) : await readLastHookEvents(logFile, found.id, lines);
    if (parsed.values.json) {
      const out: ExplainJson = { session: found, log: logFile, total, events };
      printJson(out);
      return;
    }
    for (const line of renderExplain(found, events, total, logFile, Date.now())) println(line);
  },
};

export default command;
