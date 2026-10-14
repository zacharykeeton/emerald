// The update relay (M9 fix 271): the app's side of `emmer update`. The
// updater's state goes to the daemon on every change and at each
// connect (update.report), so the CLI reads `0.1.240 installed, 0.1.258
// ready` off the daemon without touching the window; and the main
// process sits on the daemon's app topic, where a click relayed from the
// CLI (update.act) lands as update.requested and runs the same act() the
// badge's click does. A daemon before level 49 has neither the requests
// nor the topic, so under it the relay does nothing and the badge is the
// only way.
import type { UpdateState } from '@emerald/shared';

export const UPDATE_RELAY_LEVEL = 49;

// The slice of PipeClient the relay uses, so a test hands in an emitter.
export interface RelayClient {
  daemonInfo: { featureLevel: number | null } | null;
  request(type: 'subscribe', body: { topics: Array<'app'> }): Promise<unknown>;
  request(type: 'update.report', body: { state: UpdateState }): Promise<unknown>;
  on(event: 'connected', listener: () => void): unknown;
  on(event: 'message', listener: (msg: { type: string }) => void): unknown;
}

export interface RelayUpdater {
  state(): UpdateState;
  act(): Promise<void>;
}

export interface UpdateRelay {
  // Called by the updater's push with every state it sets.
  report(state: UpdateState): void;
}

export function wireUpdateRelay(client: RelayClient, updater: () => RelayUpdater, log: (msg: string) => void): UpdateRelay {
  const supported = () => (client.daemonInfo?.featureLevel ?? 0) >= UPDATE_RELAY_LEVEL;
  const report = (state: UpdateState) => {
    if (!supported()) return;
    client.request('update.report', { state }).catch((err: unknown) => log(`update.report failed: ${err instanceof Error ? err.message : String(err)}`));
  };
  client.on('connected', () => {
    if (!supported()) return;
    client
      .request('subscribe', { topics: ['app'] })
      .then(() => report(updater().state()))
      .catch((err: unknown) => log(`update relay: subscribe failed: ${err instanceof Error ? err.message : String(err)}`));
  });
  client.on('message', (msg) => {
    if (msg.type !== 'update.requested') return;
    log('update: a click relayed from emmer update');
    updater()
      .act()
      .catch((err: unknown) => log(`update: the relayed click failed: ${err instanceof Error ? err.message : String(err)}`));
  });
  return { report };
}
