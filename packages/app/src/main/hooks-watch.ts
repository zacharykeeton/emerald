import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Limits } from '@emerald/shared';
import type { HookTestOutcome, HooksStatus } from '../preload/api.ts';
import { watchFolder } from './watch-folder.ts';

// The hooks banner's watch on Claude Code's settings (M9 fix 606). The
// banner read the status once when the window loaded, so a hook taken out
// while the app ran (by another program, by hand, by a second emerald)
// left every row without word until the next launch. The main process
// watches the folder of the settings file `hooks status` read, and on a
// change that is not emerald's own write to a complete install it reads
// the status again and pushes it to the renderer. It never installs.

// A save is often two or three events (the temp file renamed over, the
// times touched); one status read answers them all.
export const HOOKS_WATCH_DEBOUNCE_MS = 500;

export interface HooksReply {
  status: HooksStatus;
  // The record of what emerald wrote (hooks-install.ts's SETTINGS_WRITTEN).
  written: string;
}

// `emmer hooks status --json`, trimmed to what the banner needs.
export function parseHooksStatus(json: unknown): HooksReply {
  const s = (json ?? {}) as Record<string, unknown>;
  return {
    status: {
      complete: s['complete'] === true,
      installed: Array.isArray(s['installed']) ? (s['installed'] as string[]) : [],
      missing: Array.isArray(s['missing']) ? (s['missing'] as string[]) : [],
      scriptPresent: s['scriptPresent'] === true,
      scriptStale: s['scriptStale'] === true,
      statusLine: s['statusLine'] === true,
      skill: s['skill'] === true,
      settings: String(s['settings'] ?? ''),
      fighting: s['fighting'] === true,
    },
    written: String(s['written'] ?? ''),
  };
}

const OUTCOMES: readonly string[] = ['passed', 'no-script', 'no-daemon', 'old-daemon', 'not-heard'];

export function isHookTestOutcome(value: unknown): value is HookTestOutcome {
  return typeof value === 'string' && OUTCOMES.includes(value);
}

function sha256Of(file: string): string {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    bytes = Buffer.alloc(0);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

// The hash emerald last wrote to this settings file, off the record, or
// null when there is none to read.
export function ownSha256(recordPath: string, settingsPath: string): string | null {
  try {
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as Record<string, { sha256?: unknown }>;
    const entry = record[path.resolve(settingsPath).toLowerCase()];
    return typeof entry?.sha256 === 'string' ? entry.sha256 : null;
  } catch {
    return null;
  }
}

export class HooksWatch {
  private watcher: fs.FSWatcher | null = null;
  private settings: string | null = null;
  private written = '';
  private complete = false;
  private debounce: NodeJS.Timeout | null = null;
  private recheck: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly check: () => Promise<HooksReply>;
  private readonly push: (status: HooksStatus) => void;
  private readonly log: (msg: string) => void;

  constructor(check: () => Promise<HooksReply>, push: (status: HooksStatus) => void, log: (msg: string) => void) {
    this.check = check;
    this.push = push;
    this.log = log;
  }

  // Called with every status the main process reads.
  follow(reply: HooksReply): void {
    if (this.closed) return;
    this.complete = reply.status.complete;
    this.written = reply.written;
    if (reply.status.fighting) this.scheduleRecheck();
    const settings = reply.status.settings;
    if (settings === '') return;
    if (this.watcher !== null && this.settings === settings) return;
    this.stopWatch();
    this.settings = settings;
    // The folder, not the file: a missing file that appears is seen, and
    // the rename-over of emerald's own write and of Claude Code's does not
    // end the watch. Only the file's own name counts, so the .emerald-tmp
    // and .emerald-bak siblings are ignored.
    const dir = path.dirname(settings);
    const base = path.basename(settings).toLowerCase();
    const w = watchFolder(
      dir,
      (name) => {
        if (name === null || path.basename(name).toLowerCase() === base) this.onEvent();
      },
      () => {
        this.watcher = null;
        this.log(`hooks watch ended (${dir} went or the watch failed); trying again at the next status read`);
      },
    );
    if (w === null) {
      this.log(`hooks watch not started on ${dir}`);
      return;
    }
    this.watcher = w;
    this.log(`hooks watch on ${dir} for ${path.basename(settings)}`);
  }

  close(): void {
    this.closed = true;
    this.stopWatch();
    if (this.debounce !== null) clearTimeout(this.debounce);
    if (this.recheck !== null) clearTimeout(this.recheck);
    this.debounce = null;
    this.recheck = null;
  }

  private stopWatch(): void {
    if (this.watcher !== null) this.watcher.close();
    this.watcher = null;
  }

  private onEvent(): void {
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.settled();
    }, HOOKS_WATCH_DEBOUNCE_MS);
    this.debounce.unref();
  }

  private settled(): void {
    if (this.closed || this.settings === null) return;
    // Emerald's own install or uninstall, read while the hooks were
    // complete, has nothing to show. While they were incomplete the same
    // bytes are read anyway: a person who puts back by hand exactly what
    // emerald wrote must see the banner lower.
    const own = ownSha256(this.written, this.settings);
    if (own !== null && own === sha256Of(this.settings) && this.complete) return;
    this.refresh(true);
  }

  private refresh(logChange: boolean): void {
    this.check().then(
      (reply) => {
        if (this.closed) return;
        this.follow(reply);
        this.push(reply.status);
        if (logChange) this.log(`settings change: hooks ${reply.status.complete ? 'complete' : 'incomplete'}${reply.status.fighting ? ', another writer' : ''}`);
      },
      (err: unknown) => this.log(`hooks status after a settings change failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  // Once the minute passes the installs age out of the window, and the
  // banner offers Install again.
  private scheduleRecheck(): void {
    if (this.recheck !== null) clearTimeout(this.recheck);
    this.recheck = setTimeout(() => {
      this.recheck = null;
      this.refresh(false);
    }, Limits.hookInstallWindowMs);
    this.recheck.unref();
  }
}
