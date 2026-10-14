import { parse, positionals } from '../args.ts';
import { CliError } from '../cli-error.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';

const command: Command = {
  name: 'rm',
  summary: 'forget an exited session',
  usage: 'emmer rm <session>',
  async run(argv) {
    const { session } = positionals(parse(argv, {}), ['session']);
    await withDaemon(async (client) => {
      const found = await findSession(client, session);
      // The daemon refuses this too, but its message names the id only.
      if (found.state !== 'exited') throw new CliError(`${shortId(found.id)} ${found.name} is ${found.state}; kill it first`);
      await client.request('session.remove', { sessionId: found.id });
      println(`removed ${shortId(found.id)} ${found.name}`);
    });
  },
};

export default command;
