import { parse, positionals } from '../args.ts';
import { CliError } from '../cli-error.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';
import { SPAWN_COLS, SPAWN_ROWS, printSession } from '../spawn.ts';

const options = {
  json: { type: 'boolean', default: false },
} as const;

const command: Command = {
  name: 'resume',
  summary: 'start an exited session again under the same id',
  usage: 'emmer resume <session> [--json]',
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    const resumed = await withDaemon(async (client) => {
      const found = await findSession(client, session);
      if (found.state !== 'exited') throw new CliError(`${shortId(found.id)} ${found.name} is ${found.state}, not exited`);
      return (await client.request('session.resume', { sessionId: found.id, cols: SPAWN_COLS, rows: SPAWN_ROWS })).session;
    });
    printSession(resumed, parsed.values.json);
  },
};

export default command;
