// The daemon hosts the update feed (M9 fix 240). The app's updater reads
// latest.yml from http://127.0.0.1:7420/, and before this something had
// to run `emmer feed serve` for it to see a build; a hidden one died at
// logoff, so the morning after a publish the check failed silently. The
// daemon lives across logins on this machine, so it serves the folder
// itself: bound only when the folder exists (a box that never published
// binds nothing), one log line either way, and a bind failure (another
// server on the port, a `feed serve` left from before) is a log line and
// no crash, with a try again every two minutes (M9 fix 486). EMERALD_FEED_DIR names another folder (`off` serves none) and
// EMERALD_FEED_PORT another port (0 lets the OS pick), for the scripts and
// a harness daemon that must not touch the real port.
import fs from 'node:fs';
import { FEED_PORT } from '@emerald/shared';
import { defaultFeedDir, serveFeed } from '@emerald/shared/feed-server';
import type { FeedServer } from '@emerald/shared/feed-server';
import type { Logger } from './log.ts';

export interface FeedHost {
  dir: string;
  // null while another process holds the port and the host is waiting
  // to take it (M9 fix 486); the daemon's hello then reports no feed.
  port: number | null;
  close(): Promise<void>;
}

export interface FeedHostOptions {
  dir?: string;
  port?: number;
  log: Logger;
  // How long a host that found the port taken waits between tries.
  retryMs?: number;
}

// An `emmer feed serve` or a stale harness holding 7420 at the daemon's
// start used to leave the daemon without a feed for its whole life.
export const FEED_RETRY_MS = 2 * 60 * 1000;

function isFolder(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// What the environment asks for, read once at start. `off` is how a
// harness says "serve nothing", since the real folder is on this box
// and every harness daemon would otherwise try the real port.
export function feedHostSettings(env: NodeJS.ProcessEnv = process.env): { dir: string | null; port: number } {
  const dirVar = env['EMERALD_FEED_DIR'];
  const dir = dirVar === undefined || dirVar === '' ? defaultFeedDir() : dirVar === 'off' ? null : dirVar;
  const portVar = Number(env['EMERALD_FEED_PORT']);
  const port = Number.isInteger(portVar) && portVar >= 0 && env['EMERALD_FEED_PORT'] !== undefined && env['EMERALD_FEED_PORT'] !== '' ? portVar : FEED_PORT;
  return { dir, port };
}

// Serves `dir` on `port` when the folder is there; null when it is not,
// or when the bind failed for any reason but a taken port. A taken port
// (EADDRINUSE) is one warning and a host with no port that tries again
// every `retryMs` on an unref'd timer while the folder exists, logging
// once when it binds (M9 fix 486). Never throws.
export async function startFeedHost(opts: FeedHostOptions): Promise<FeedHost | null> {
  const { log } = opts;
  const dir = opts.dir ?? defaultFeedDir();
  const port = opts.port ?? FEED_PORT;
  const retryMs = opts.retryMs ?? FEED_RETRY_MS;
  if (!isFolder(dir)) {
    log.info(`feed: no folder at ${dir}; not serving`);
    return null;
  }
  try {
    const server = await serveFeed(dir, port);
    log.info(`feed: serving ${dir} on ${server.port}`);
    return { dir, port: server.port, close: () => server.close() };
  } catch (err) {
    const taken = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
    log.warn(`feed: could not bind port ${port} for ${dir}: ${err instanceof Error ? err.message : String(err)}${taken ? `; trying again every ${Math.round(retryMs / 1000)} s` : ''}`);
    if (!taken) return null;
  }
  let bound: FeedServer | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  const host: FeedHost = {
    dir,
    port: null,
    close: async () => {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (bound !== null) await bound.close();
    },
  };
  const attempt = (): void => {
    timer = null;
    if (closed) return;
    if (!isFolder(dir)) {
      log.info(`feed: no folder at ${dir} any more; not trying port ${port} again`);
      return;
    }
    serveFeed(dir, port).then(
      (server) => {
        if (closed) {
          void server.close();
          return;
        }
        bound = server;
        host.port = server.port;
        log.info(`feed: serving ${dir} on ${server.port}`);
      },
      () => {
        if (!closed) schedule();
      },
    );
  };
  const schedule = (): void => {
    timer = setTimeout(attempt, retryMs);
    timer.unref();
  };
  schedule();
  return host;
}
