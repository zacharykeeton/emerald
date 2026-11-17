import { parse, positionals } from '../args.ts';
import { usageError } from '../cli-error.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSessionHinted, withDaemon } from '../connect.ts';
import { resolveSession, shortId } from '../resolve.ts';
import { HOST_END_LEVEL, viaHost } from '../via-host.ts';

const options = {
  // M9 fix 1182: a remote host the window lists, whose session is ended through the window.
  host: { type: 'string' },
} as const;

const command: Command = {
  name: 'kill',
  summary: 'end a session; it stays listed as exited',
  usage: 'emmer kill <session> [--host <name>]\n--host <name> ends that remote host\'s session through the window, which must be open',
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    const host = parsed.values.host;
    if (host !== undefined && host.trim() === '') throw usageError('--host needs a host name, as the window lists it');
    if (host !== undefined) {
      const { sessions } = await viaHost('emmer kill --host', 'session.list', { host }, HOST_END_LEVEL);
      const found = resolveSession(sessions, session, `emmer ls --host ${host}`);
      await viaHost('emmer kill --host', 'session.kill', { sessionId: found.id, host }, HOST_END_LEVEL);
      println(`killed ${shortId(found.id)} ${found.name}`);
      return;
    }
    await withDaemon(async (client) => {
      const found = await findSessionHinted(client, session);
      await client.request('session.kill', { sessionId: found.id });
      println(`killed ${shortId(found.id)} ${found.name}`);
    });
  },
};

export default command;
