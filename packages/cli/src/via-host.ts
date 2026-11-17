// M9 fix 1167: a request naming a remote host, which the daemon carries to
// the window. The daemon holds no line to a host; the window's main process
// does, so the reply is the window's, or the daemon's line for no window or
// no answer.
import type { Requests } from '@emerald/shared';
import { CliError, EXIT } from './cli-error.ts';
import { connectHello } from './connect.ts';

// The first daemon that does.
export const HOST_LEVEL = 83;
// The first daemon that carries a kill or a remove to the window (M9 fix 1182).
export const HOST_END_LEVEL = 84;

export async function viaHost<K extends 'session.spawn' | 'session.list' | 'session.kill' | 'session.remove'>(what: string, type: K, body: Requests[K]['req'], need: number = HOST_LEVEL): Promise<Requests[K]['res']> {
  const { client, hello } = await connectHello();
  try {
    // An older daemon would drop the field and act on this PC.
    const level = hello.featureLevel ?? 1;
    if (level < need) throw new CliError(`emmerd ${hello.daemonVersion} is older than ${what} (level ${level}, needs ${need}); restart it from the app's banner`);
    try {
      return await client.request(type, body);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'no-window') throw new CliError(message, EXIT.noWindow);
      if (code === 'no-answer') throw new CliError(message, EXIT.noAnswer);
      if (code === 'host') throw new CliError(message, EXIT.failure);
      throw err;
    }
  } finally {
    client.close();
  }
}
