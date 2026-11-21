import { ipcMain, Notification } from 'electron';
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
// M9 fix 1199: a permission ask's toast carries its buttons, and a press
// fires `action` with the button's place (darwin and win32).
function electronToast(title: string, body: string, actions?: readonly string[]): ToastHandle {
  const toast = new Notification({ title, body, ...(actions !== undefined && actions.length > 0 ? { actions: actions.map((text) => ({ type: 'button' as const, text })) } : {}) });
  const handle = {
    on(event: 'show' | 'close' | 'click' | 'failed' | 'action', fn: ((error: string) => void) | (() => void) | ((index: number) => void)) {
      if (event === 'failed') toast.on('failed', (_event, error) => (fn as (error: string) => void)(String(error)));
      else if (event === 'action') toast.on('action', (details) => (fn as (index: number) => void)(details.actionIndex));
      else if (event === 'show') toast.on('show', () => (fn as () => void)());
      else if (event === 'close') toast.on('close', () => (fn as () => void)());
      else toast.on('click', () => (fn as () => void)());
    },
    show: () => toast.show(),
  };
  return handle as ToastHandle;
}

// The windows the notifier asks about (M9 fix 866): whether any window of
// the app has the focus, and the window a session's click should raise
// (the one showing it, else the one in front).
export interface NotifyWindows {
  focused: () => boolean;
  forSession: (sessionId: string) => BrowserWindow | null;
}

export function createNotifier(windows: NotifyWindows, onClick: (sessionId: string) => void, log: NotifyLog): Notifier {
  const logFile = process.env['EMERALD_NOTIFY_LOG'];
  const always = process.env['EMERALD_NOTIFY_ALWAYS'] !== undefined;
  const held = process.env['EMERALD_HOME'] !== undefined && logFile === undefined && !always;
  const raise = (sessionId: string): void => {
    const w = windows.forSession(sessionId);
    if (w !== null && !w.isDestroyed()) {
      if (w.isMinimized()) w.restore();
      w.show();
      w.focus();
    }
    onClick(sessionId);
  };
  // M9 fix 1199: a toast answer the renderer would not send raises the
  // window as a body click does, so the person sees why; a harness window,
  // on any private EMERALD_HOME, is never raised and only logs it.
  ipcMain.on('emerald:notify-dropped', (_e, sessionId: unknown) => {
    if (typeof sessionId !== 'string') return;
    if (process.env['EMERALD_HOME'] !== undefined) log('notification answer dropped, the window left where it is under a private EMERALD_HOME');
    else raise(sessionId);
  });
  return createNotifyPolicy({
    logFile,
    always,
    held,
    focused: windows.focused,
    now: Date.now,
    appendLine: (file, line) => fs.appendFileSync(file, line),
    toasts: { supported: () => Notification.isSupported(), create: electronToast },
    onClick: raise,
    // M9 fix 1199: a button's press goes to the session's window as it is,
    // never raised, restored or focused: the answer is the whole point.
    onAction: (sessionId, toolUseId, index) => {
      const w = windows.forSession(sessionId);
      if (w !== null && !w.isDestroyed()) w.webContents.send('emerald:notify-action', { sessionId, toolUseId, index });
    },
    log,
  });
}
