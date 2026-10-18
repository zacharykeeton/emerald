// The file open relay (M9 fix 341): a path handed to the window from
// outside its renderer. Two senders: the daemon's file.open.requested
// push, which is `emmer open` from a pane (the update relay's subscribe
// already put the main process on the app topic), and a launch with a
// file on its command line (M9 fix 342), which the instance holding the
// single-instance lock gets as second-instance. Either way the path goes
// to the renderer as emerald:open-file and the window lifts itself the way
// a notification's click does. A path that arrives before the renderer
// has said it is listening (its preload's onOpenFile, which sends
// emerald:open-file-ready) waits for that, so a launch with a file opens
// it once the tabs are up rather than losing it to a page not yet loaded.
// A reload or a crashed page puts the relay back to holding (M9 fix 527)
// until the new page says it is listening again, so an open that lands
// in between is held and opened then rather than sent to a page with no
// listener.

export interface OpenRequest {
  path: string;
  pane: boolean;
  // M9 fix 375: the file's own colour scheme to set before it opens
  // (null clears the pick), and the id the renderer answers the daemon
  // with (file.open.done) so the CLI hears whether the name was known;
  // a launch with a file carries neither.
  scheme?: string | null;
  openId?: number;
  // M9 fix 376: the session whose pane the file goes beside.
  beside?: string;
  // M9 fix 659: path holds a URL for a browser pane.
  url?: boolean;
  // M9 fix 700: a launch with a file (a double-click in Explorer, or a second launch handing its file over), never set by the daemon's push.
  launch?: true;
  // M9 fix 853: path is a folder from Explorer's Open in Emerald items, to open in a new tab with a Claude or a shell started there; a launch only, never set by the daemon's push.
  kind?: 'claude' | 'shell';
}

// What rides the open to the renderer beside the path and the pane flag.
export function openExtraOf(req: OpenRequest): { scheme?: string | null | undefined; openId?: number | undefined; beside?: string | undefined; url?: boolean | undefined; launch?: boolean | undefined; kind?: 'claude' | 'shell' | undefined } {
  return { scheme: req.scheme, openId: req.openId, beside: req.beside, url: req.url, launch: req.launch, kind: req.kind };
}

export interface OpenRelayClient {
  on(event: 'message', listener: (msg: { type: string; path?: string; pane?: boolean; scheme?: string | null; openId?: number; beside?: string; url?: boolean }) => void): unknown;
}

export interface OpenRelaySink {
  // Sends one request to the renderer, or answers false when there is no
  // window yet.
  deliver(req: OpenRequest): boolean;
  lift(): void;
}

export interface FileOpenRelay {
  // A request from anywhere: relayed now, or held until the renderer is
  // listening.
  open(req: OpenRequest): void;
  // The renderer's word that its handler is installed (each load).
  ready(): void;
  // A new page is loading, or the page is gone (M9 fix 527): hold what
  // arrives until the next ready.
  loading(): void;
}

export function wireFileOpenRelay(client: OpenRelayClient, sink: OpenRelaySink, log: (msg: string) => void): FileOpenRelay {
  const held: OpenRequest[] = [];
  let listening = false;
  const open = (req: OpenRequest) => {
    if (!listening || !sink.deliver(req)) {
      held.push(req);
      log(`open: ${req.path} held until the window is listening`);
      return;
    }
    log(`open: ${req.path}${req.kind === undefined ? '' : `, a ${req.kind === 'claude' ? 'Claude' : 'shell'} in a new tab`}${req.pane ? ' in a pane' : ''}${req.beside === undefined ? '' : ` beside ${req.beside}`}${req.scheme === undefined ? '' : req.scheme === null ? ', its scheme cleared' : ` in ${req.scheme}`}`);
    sink.lift();
  };
  client.on('message', (msg) => {
    if (msg.type !== 'file.open.requested' || typeof msg.path !== 'string') return;
    open({
      path: msg.path,
      pane: msg.pane === true,
      ...(msg.scheme === null || typeof msg.scheme === 'string' ? { scheme: msg.scheme } : {}),
      ...(typeof msg.openId === 'number' ? { openId: msg.openId } : {}),
      ...(typeof msg.beside === 'string' ? { beside: msg.beside } : {}),
      ...(msg.url === true ? { url: true } : {}),
    });
  });
  return {
    open,
    ready: () => {
      listening = true;
      const queue = held.splice(0);
      for (const req of queue) open(req);
    },
    loading: () => {
      listening = false;
    },
  };
}

// The View menu's reload (M9 fix 549): the relay holds from the click, not
// from the commit, so an open that lands while the old page unloads waits
// for the new page rather than going to one about to be torn down.
export function reloadHolding(contents: { reload(): void; reloadIgnoringCache(): void }, relay: Pick<FileOpenRelay, 'loading'>, ignoreCache: boolean): void {
  relay.loading();
  if (ignoreCache) contents.reloadIgnoringCache();
  else contents.reload();
}
