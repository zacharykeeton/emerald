import { Notification } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'node:fs';
import type { NotifyRequest } from '../preload/api.ts';
import { createNotifyPolicy } from './notify-policy.ts';
import type { NotifyLog, NotifyOutcome, ToastHandle } from './notify-policy.ts';

// System notifications for a session that wants someone (M14 task 3). The
// policy (focus, the repeat window, the private-home hold, the log file,
// the held toasts) is notify-policy.ts's since M9 fix 560, tested there;
// this builds its deps from the environment, the window and electron's
// Notification. A click brings the window up and tells the renderer which
// session to show.
//
// EMERALD_NOTIFY_LOG names a file that gets one JSON line per notification
// instead of a toast, and EMERALD_NOTIFY_ALWAYS skips the focus check; both
// are for the verify script, which drives a window that has the focus and
// cannot see a toast. With neither set, a window on a private EMERALD_HOME
// (a verify script's or a click-through's, never focused since M9 fix 48)
// writes the notification to the main log and posts nothing, so a fake
// done from a harness never reaches the notification centre (fix 49),
// the way its chime is muted (fix 47).
//
// The install-gap launch awaits a post's answer before quitting (M9 fix
// 312), since a process that exits a second after `show()` can take a
// Windows toast with it; the daily posts ignore the value.

export type { NotifyLog, NotifyOutcome };

export interface Notifier {
  post(req: NotifyRequest, opts?: { always?: boolean }): Promise<NotifyOutcome>;
}

// Electron's Notification as the policy's toast: its `failed` event
// carries the error second, after the event.
function electronToast(title: string, body: string): ToastHandle {
  const toast = new Notification({ title, body });
  const handle = {
    on(event: 'show' | 'close' | 'click' | 'failed', fn: ((error: string) => void) | (() => void)) {
      if (event === 'failed') toast.on('failed', (_event, error) => (fn as (error: string) => void)(String(error)));
      else if (event === 'show') toast.on('show', () => (fn as () => void)());
      else if (event === 'close') toast.on('close', () => (fn as () => void)());
      else toast.on('click', () => (fn as () => void)());
    },
    show: () => toast.show(),
  };
  return handle as ToastHandle;
}

export function createNotifier(getWindow: () => BrowserWindow | null, onClick: (sessionId: string) => void, log: NotifyLog): Notifier {
  const logFile = process.env['EMERALD_NOTIFY_LOG'];
  const always = process.env['EMERALD_NOTIFY_ALWAYS'] !== undefined;
  const held = process.env['EMERALD_HOME'] !== undefined && logFile === undefined && !always;
  return createNotifyPolicy({
    logFile,
    always,
    held,
    focused: () => {
      const win = getWindow();
      return win !== null && !win.isDestroyed() && win.isFocused();
    },
    now: Date.now,
    appendLine: (file, line) => fs.appendFileSync(file, line),
    toasts: { supported: () => Notification.isSupported(), create: electronToast },
    onClick: (sessionId) => {
      const w = getWindow();
      if (w !== null && !w.isDestroyed()) {
        if (w.isMinimized()) w.restore();
        w.show();
        w.focus();
      }
      onClick(sessionId);
    },
    log,
  });
}
