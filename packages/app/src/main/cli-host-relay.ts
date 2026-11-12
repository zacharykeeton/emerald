// M9 fix 1167: the CLI's requests naming a remote host, emmer new --host,
// emmer shell --host and (M9 fix 1168) emmer ls --host. The daemon cannot
// reach a host; this process holds the line to each (hostClients in
// index.ts), so the daemon pushes host.requested to one window and holds
// the CLI's reply for its host.done. An ask runs as the empty pane's Start
// runs one: hostConnect (a setup first when the host's kit is not this
// version), then hostRequest, which keeps a started session so its later
// requests route by its id. Imports nothing from electron, so node:test
// runs it.
import { hostFolder } from '@emerald/shared';
import type { HostAsk, RemoteHost, Requests, ServerMessage, SessionInfo } from '@emerald/shared';
import { decodeRequestError } from './request-error.ts';

export interface CliHostClient {
  on(event: 'message', listener: (msg: ServerMessage) => void): unknown;
  request(type: 'host.done', body: Requests['host.done']['req']): Promise<unknown>;
}

export interface CliHostDeps {
  hosts: () => Promise<RemoteHost[]>;
  connect: (host: string) => Promise<void>;
  record: (host: string) => RemoteHost | undefined;
  spawn: (host: string, body: Extract<HostAsk, { type: 'session.spawn' }>['body']) => Promise<{ session: SessionInfo }>;
  list: (host: string, body: Extract<HostAsk, { type: 'session.list' }>['body']) => Promise<{ sessions: SessionInfo[] }>;
  log: (msg: string) => void;
}

type HostAnswer = Omit<Requests['host.done']['req'], 'relayId'>;

// The one line the CLI prints: the host client's own lines already start
// with the host's name (`stub is unreachable`, `stub did not answer`).
export function hostLine(host: string, message: string): string {
  return message.startsWith(`${host} `) ? message : `${host}: ${message}`;
}

export async function answerHostAsk(host: string, ask: HostAsk, deps: CliHostDeps): Promise<HostAnswer> {
  try {
    // An unknown name is refused before any connect, which would make a
    // client for it.
    const known = await deps.hosts();
    if (!known.some((h) => h.name === host)) {
      return { error: `no host named ${host}; the window lists ${known.length === 0 ? 'none' : known.map((h) => h.name).join(', ')}` };
    }
    await deps.connect(host);
    // M9 fix 1168: a list has no folder to expand.
    if (ask.type === 'session.list') return { sessions: (await deps.list(host, ask.body)).sessions };
    let cwd = ask.body.cwd;
    if (/^~([\\/]|$)/.test(cwd)) {
      // The home and the shell are what first contact read of the host.
      const r = deps.record(host);
      if (r?.home === undefined || r.shell === undefined) {
        return { error: `${host}'s home folder is not known yet; give an absolute folder` };
      }
      cwd = hostFolder(cwd, { home: r.home, shell: r.shell });
    }
    const { session } = await deps.spawn(host, { ...ask.body, cwd });
    return { session };
  } catch (err) {
    // hostRequest encodes a coded error into its message for the page's
    // invoke; take it back out so the line is the daemon's own.
    const e = decodeRequestError(err);
    return { error: hostLine(host, e instanceof Error ? e.message : String(e)) };
  }
}

export function wireCliHostRelay(client: CliHostClient, deps: CliHostDeps): void {
  client.on('message', (msg) => {
    if (msg.type !== 'host.requested') return;
    const { relayId, host, ask } = msg;
    deps.log(`host relay: ${ask.type} on ${host}`);
    void (async () => {
      const answer = await answerHostAsk(host, ask, deps);
      if (answer.error !== undefined) deps.log(`host relay: ${ask.type} on ${host} refused: ${answer.error}`);
      else deps.log(`host relay: ${ask.type} on ${host} done`);
      try {
        await client.request('host.done', { relayId, ...answer });
      } catch (err) {
        deps.log(`host relay: done for ${relayId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  });
}
