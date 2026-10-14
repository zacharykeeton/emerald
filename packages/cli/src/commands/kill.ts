import { parse, positionals } from '../args.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSession, withDaemon } from '../connect.ts';
import { shortId } from '../resolve.ts';

const command: Command = {
  name: 'kill',
  summary: 'end a session; it stays listed as exited',
  usage: 'emmer kill <session>',
  async run(argv) {
    const { session } = positionals(parse(argv, {}), ['session']);
    await withDaemon(async (client) => {
      const found = await findSession(client, session);
      await client.request('session.kill', { sessionId: found.id });
      println(`killed ${shortId(found.id)} ${found.name}`);
    });
  },
};

export default command;
