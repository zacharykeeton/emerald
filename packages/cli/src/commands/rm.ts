import { parse, positionals } from '../args.ts';
import { CliError, usageError } from '../cli-error.ts';
import { println } from '../command.ts';
import type { Command } from '../command.ts';
import { findSessionHinted, withDaemon } from '../connect.ts';
import { resolveSession, shortId } from '../resolve.ts';
import { HOST_END_LEVEL, viaHost } from '../via-host.ts';

const options = {
  // M9 fix 1182: a remote host the window lists, whose exited session is forgotten through the window.
  host: { type: 'string' },
} as const;

const command: Command = {
  name: 'rm',
  summary: 'forget an exited session',
  usage: 'emmer rm <session> [--host <name>]\n--host <name> forgets that remote host\'s exited session through the window, which must be open',
  async run(argv) {
    const parsed = parse(argv, options);
    const { session } = positionals(parsed, ['session']);
    const host = parsed.values.host;
    if (host !== undefined && host.trim() === '') throw usageError('--host needs a host name, as the window lists it');
    if (host !== undefined) {
      const { sessions } = await viaHost('emmer rm --host', 'session.list', { host }, HOST_END_LEVEL);
      const found = resolveSession(sessions, session, `emmer ls --host ${host}`);
      if (found.state !== 'exited') throw new CliError(`${shortId(found.id)} ${found.name} is ${found.state}; kill it first`);
      await viaHost('emmer rm --host', 'session.remove', { sessionId: found.id, host }, HOST_END_LEVEL);
      println(`removed ${shortId(found.id)} ${found.name}`);
      return;
    }
    await withDaemon(async (client) => {
      const found = await findSessionHinted(client, session);
      // The daemon refuses this too, but its message names the id only.
      if (found.state !== 'exited') throw new CliError(`${shortId(found.id)} ${found.name} is ${found.state}; kill it first`);
      await client.request('session.remove', { sessionId: found.id });
      println(`removed ${shortId(found.id)} ${found.name}`);
    });
  },
};

export default command;
