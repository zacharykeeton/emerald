import type { ServerMessage } from '@emerald/shared';
import { parse } from '../args.ts';
import { CliError, EXIT, usageError } from '../cli-error.ts';
import type { Command } from '../command.ts';
import { connectHello, findSession } from '../connect.ts';
import { MOD_CHANNEL_LEVEL } from '../mod-route.ts';

// The emerald mod's prompt channel (M9 fix 741). The mod starts this
// inside a hosted Claude at its session.start and reads stdout: one line
// of JSON per prompt the daemon pushes for the session, which the mod
// submits as the person's own. It ends when the pipe closes; a stopped
// daemon ends every hosted Claude with it, so nothing starts it again.
const command: Command = {
  name: 'mod-channel',
  summary: "stream a session's queued prompts to the emerald mod, which starts this itself",
  usage: 'emmer mod-channel <session>',
  async run(argv) {
    const parsed = parse(argv, {});
    const [ref] = parsed.positionals;
    if (ref === undefined) throw usageError('missing session');
    const { client, hello } = await connectHello();
    const level = hello.featureLevel ?? 1;
    if (level < MOD_CHANNEL_LEVEL) {
      client.close();
      throw new CliError(`emmerd ${hello.daemonVersion} is older than the mod's channel (level ${level}, needs ${MOD_CHANNEL_LEVEL})`);
    }
    const found = await findSession(client, ref);
    const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    client.on('message', (msg: ServerMessage) => {
      if (msg.type !== 'mod.submit' || msg.sessionId !== found.id) return;
      process.stdout.write(JSON.stringify({ text: msg.text }) + '\n');
    });
    await client.request('mod.channel', { sessionId: found.id });
    await closed;
    return EXIT.ok;
  },
};

export default command;
