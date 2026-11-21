import type { NotifyRequest } from '../preload/api.ts';

// The notification policy (M14 task 3), moved out of notify.ts so it can
// be tested without electron (M9 fix 560): notify.ts builds the deps from
// the environment, the window and electron's Notification, and this holds
// every decision in the order it is made. Nothing while the window is
// focused (the row pulses there already, and a toast over it is noise)
// and at most one per session every five seconds, since a permission
// prompt right after a turn's end would otherwise post twice; a post with
// `always` skips the focus check (M9 fix 282). Under a private EMERALD_HOME
// the notification is held to the main log (fix 49), and EMERALD_NOTIFY_LOG
// names a file that gets one JSON line per notification instead of a
// toast. `post` answers where the notification went (M9 fix 312): a
// toast's promise settles on its `show` or `failed` event, the other
// branches settle at once.

export const REPEAT_MS = 5000;

// The toasts still in the notification centre (M9 fix 479): Electron's
// main-process Notification stops delivering its events once the JS
// wrapper is collected, and nothing else holds one after `show` settles
// the promise, so a click minutes later could do nothing. Each is held
// until it is clicked, closed or failed; a day of toasts nobody touches
// is capped by letting the oldest go.
export const HELD_TOASTS = 50;

// A permission ask's toast buttons (M9 fix 1199): the index a press
// answers is the place here, 0 Allow once and 1 Deny. Never "don't ask
// again": a standing rule is given in the dialog, where its scope is said.
export const ASK_ACTIONS = ['Allow once', 'Deny'] as const;

export type NotifyLog = (msg: string) => void;

export type NotifyOutcome = 'shown' | 'failed' | 'held' | 'logged' | 'unsupported' | 'skipped';

export interface ToastHandle {
  on(event: 'show' | 'close' | 'click', fn: () => void): void;
  on(event: 'failed', fn: (error: string) => void): void;
  on(event: 'action', fn: (index: number) => void): void;
  show(): void;
}

export interface ToastMaker {
  supported(): boolean;
  create(title: string, body: string, actions?: readonly string[]): ToastHandle;
}

export interface NotifyDeps {
  logFile: string | undefined;
  always: boolean;
  held: boolean;
  focused: () => boolean;
  now: () => number;
  appendLine: (file: string, line: string) => void;
  toasts: ToastMaker;
  onClick: (sessionId: string) => void;
  // A button pressed on a permission ask's toast (M9 fix 1199), with the
  // call it was posted for; the window is not raised.
  onAction: (sessionId: string, toolUseId: string, index: number) => void;
  log: NotifyLog;
}

// The ask a request carries (M9 fix 1199), or null when it carries none or
// a malformed one, which is then posted as a toast with no buttons.
function askOf(req: NotifyRequest): { toolUseId: string; command: string } | null {
  const ask: unknown = (req as { ask?: unknown }).ask;
  if (typeof ask !== 'object' || ask === null) return null;
  const { toolUseId, command } = ask as { toolUseId?: unknown; command?: unknown };
  return typeof toolUseId === 'string' && typeof command === 'string' ? { toolUseId, command } : null;
}

export function createNotifyPolicy(deps: NotifyDeps): { post(req: NotifyRequest, opts?: { always?: boolean }): Promise<NotifyOutcome>; heldToasts(): number } {
  const lastAt = new Map<string, number>();
  const toasts = new Set<ToastHandle>();
  return {
    heldToasts: () => toasts.size,
    post(req, opts) {
      if (typeof req.sessionId !== 'string' || typeof req.title !== 'string' || typeof req.body !== 'string') return Promise.resolve('skipped');
      if (!deps.always && opts?.always !== true && deps.focused()) return Promise.resolve('skipped');
      const now = deps.now();
      const last = lastAt.get(req.sessionId);
      if (last !== undefined && now - last < REPEAT_MS) return Promise.resolve('skipped');
      lastAt.set(req.sessionId, now);
      const ask = askOf(req);
      if (deps.held) {
        // M9 fix 1199: an ask's two-line body on one line, its buttons named.
        if (ask !== null) deps.log(`notification held under a private EMERALD_HOME: ${req.title}: ${req.body.replace(/\r?\n/g, ' ')} [${ASK_ACTIONS.join(', ')}]`);
        else deps.log(`notification held under a private EMERALD_HOME: ${req.title}: ${req.body}`);
        return Promise.resolve('held');
      }
      if (deps.logFile !== undefined) {
        // A harness's own file: a folder its fresh-state step removed
        // would otherwise throw inside the ipcMain.on listener, an
        // uncaught main-process exception whose modal lands on the
        // person's screen (M9 fix 480, L41).
        try {
          deps.appendLine(deps.logFile, `${JSON.stringify({ sessionId: req.sessionId, title: req.title, body: req.body, ...(ask === null ? {} : { ask }), at: now })}\n`);
        } catch (err) {
          deps.log(`notification log ${deps.logFile} not written: ${err instanceof Error ? err.message : String(err)}`);
          return Promise.resolve('failed');
        }
        return Promise.resolve('logged');
      }
      if (!deps.toasts.supported()) return Promise.resolve('unsupported');
      return new Promise((resolve) => {
        try {
          const toast = ask === null ? deps.toasts.create(req.title, req.body) : deps.toasts.create(req.title, req.body, ASK_ACTIONS);
          toasts.add(toast);
          if (toasts.size > HELD_TOASTS) {
            const oldest = toasts.values().next().value;
            if (oldest !== undefined) toasts.delete(oldest);
          }
          toast.on('close', () => toasts.delete(toast));
          toast.on('click', () => {
            toasts.delete(toast);
            deps.onClick(req.sessionId);
          });
          if (ask !== null) {
            toast.on('action', (index) => {
              toasts.delete(toast);
              deps.onAction(req.sessionId, ask.toolUseId, index);
            });
          }
          toast.on('show', () => resolve('shown'));
          toast.on('failed', (error) => {
            toasts.delete(toast);
            deps.log(`notification failed: ${error}`);
            resolve('failed');
          });
          toast.show();
        } catch (err) {
          deps.log(`notification failed: ${err instanceof Error ? err.message : String(err)}`);
          resolve('failed');
        }
      });
    },
  };
}
