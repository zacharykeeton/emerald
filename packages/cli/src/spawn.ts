import fs from 'node:fs';
import path from 'node:path';
import { isShellId } from '@emerald/shared';
import type { SessionInfo, SessionKind, ShellId } from '@emerald/shared';
import { parse, positionals } from './args.ts';
import { CliError, usageError } from './cli-error.ts';
import { printJson, println } from './command.ts';
import { connectHello, withDaemon } from './connect.ts';
import { shortId } from './resolve.ts';

const options = {
  json: { type: 'boolean', default: false },
  // The sidebar label; the folder name when omitted, as in the app.
  name: { type: 'string' },
} as const;

// emmer shell's own: which installed shell (M9 fix 624). emmer new does
// not take it, so --shell there stays parseArgs' unknown option.
const shellOptions = {
  ...options,
  shell: { type: 'string' },
} as const;

// The level at which the daemon takes shell on session.spawn (M9 fix 624).
const SHELL_LEVEL = 61;

// --shell's value, one of the four ids; undefined when not given.
export function parseShellId(value: string | undefined): ShellId | undefined {
  if (value === undefined) return undefined;
  if (isShellId(value)) return value;
  throw usageError(`--shell must be one of pwsh, powershell, gitbash, cmd, got ${JSON.stringify(value)}`);
}

// A session started from the CLI has no pane yet, so it gets the same size
// the app uses for a resume; the pane that later shows it resizes it.
export const SPAWN_COLS = 120;
export const SPAWN_ROWS = 30;

// Shared body of `emmer new` and `emmer shell`: resolve the folder, spawn,
// print the id. Everything after `--` goes to the program as its arguments.
export async function spawnCommand(kind: SessionKind, argv: string[]): Promise<void> {
  let shell: ShellId | undefined;
  let parsed: ReturnType<typeof parse<typeof options>>;
  if (kind === 'shell') {
    const own = parse(argv, shellOptions);
    shell = parseShellId(own.values.shell);
    parsed = own;
  } else {
    parsed = parse(argv, options);
  }
  const { dir } = positionals(parsed, ['dir']);
  const cwd = path.resolve(dir);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new CliError(`no such directory: ${cwd}`);
  }
  if (!stat.isDirectory()) throw new CliError(`not a directory: ${cwd}`);

  const req = {
    kind,
    cwd,
    cols: SPAWN_COLS,
    rows: SPAWN_ROWS,
    ...(parsed.values.name !== undefined ? { name: parsed.values.name } : {}),
    ...(parsed.rest.length > 0 ? { args: parsed.rest } : {}),
  };
  if (shell === undefined) {
    const session = await withDaemon(async (client) => (await client.request('session.spawn', req)).session);
    printSession(session, parsed.values.json);
    return;
  }
  // An older daemon would drop the field and start its PowerShell, so it
  // is refused here rather than starting the wrong shell.
  const { client, hello } = await connectHello();
  try {
    const level = hello.featureLevel ?? 1;
    if (level < SHELL_LEVEL) throw new CliError(`emmerd ${hello.daemonVersion} is older than emmer shell --shell (level ${level}, needs ${SHELL_LEVEL}); restart it from the app's banner`);
    const { session } = await client.request('session.spawn', { ...req, shell });
    printSession(session, parsed.values.json);
  } finally {
    client.close();
  }
}

export function printSession(session: SessionInfo, json: boolean): void {
  if (json) printJson({ session });
  else println(`${shortId(session.id)}  ${session.state}  ${session.kind}  ${session.name}  ${session.id}`);
}
