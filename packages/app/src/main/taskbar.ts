import { app, nativeImage } from 'electron';
import type { BrowserWindow, NativeImage } from 'electron';
import type { AttentionRequest } from '../preload/api.ts';
import { BADGE_SIZE, badgeColour, createTaskbarPolicy, drawBadge } from './taskbar-policy.ts';
import { currentSkin } from './skin.ts';
import { createDockSignal } from './dock-signal.ts';
import type { TaskbarLog, TaskbarWindow } from './taskbar-policy.ts';

// The taskbar button as an attention signal (M9 fix 104). From another
// window the sidebar's pulse and the chime are all a session at needs-input
// has, and the toast is gone in seconds; the button at the bottom of the
// screen is what a glance finds. The policy (the count, the flash, the
// pulse, the held lines under a private EMERALD_HOME) is taskbar-policy.ts's
// since M9 fix 560, tested there; this adapts a BrowserWindow to it: the
// flash is flashFrame (which Windows clears on its own when the window
// takes focus), a count is the cached badge frame with its description,
// and the pulse is a setInterval; the bar is setProgressBar, the tooltip
// setThumbnailToolTip (M9 fix 870).

export type { TaskbarLog };

export interface Taskbar {
  set(req: AttentionRequest): void;
  dispose(): void;
}

// One dock for every window on a Mac (M9 fix 1024): the signal is shared,
// made at the first taskbar, and each taskbar is one key in it.
let dockSignal: ReturnType<typeof createDockSignal> | null = null;
let nextDockKey = 0;

export function createTaskbar(getWindow: () => BrowserWindow | null, log: TaskbarLog): Taskbar {
  const frames = new Map<string, NativeImage>();
  const frame = (count: number, isBright: boolean): NativeImage => {
    // The skin is in the key (M9 fix 569), so a flip shows on the badge's
    // next frame; the pulse repaints every 800 ms while anything wants.
    const key = `${currentSkin()}:${count}:${isBright ? 'bright' : 'dim'}`;
    let img = frames.get(key);
    if (img === undefined) {
      img = nativeImage.createFromBitmap(drawBadge(count, isBright, badgeColour(currentSkin())), { width: BADGE_SIZE, height: BADGE_SIZE });
      frames.set(key, img);
    }
    return img;
  };
  const adapt = (): TaskbarWindow | null => {
    const win = getWindow();
    if (win === null || win.isDestroyed()) return null;
    return {
      flashFrame: (on) => win.flashFrame(on),
      setOverlay: (count, bright) => {
        if (count === null) win.setOverlayIcon(null, '');
        else win.setOverlayIcon(frame(count, bright), `${count} ${count === 1 ? 'session wants' : 'sessions want'} you`);
      },
      // Electron removes the bar below zero; the mode is normal by default.
      setProgress: (fraction) => win.setProgressBar(fraction === null ? -1 : fraction),
      setTooltip: (text) => win.setThumbnailToolTip(text),
    };
  };
  // On a Mac the dock stands in for the button, and no badge frame is drawn.
  const dock = process.platform === 'darwin' ? app.dock : undefined;
  const key = nextDockKey++;
  const dockAdapt = (): TaskbarWindow | null => {
    const win = getWindow();
    if (dock === undefined || win === null || win.isDestroyed()) return null;
    return (dockSignal ??= createDockSignal(dock)).windowFor(key);
  };
  const policy = createTaskbarPolicy(dock !== undefined ? dockAdapt : adapt, {
    held: process.env['EMERALD_HOME'] !== undefined,
    windows: process.platform === 'win32',
    dock: dock !== undefined,
    log,
    every: (ms, fn) => {
      const timer = setInterval(fn, ms);
      return () => clearInterval(timer);
    },
  });
  return {
    set: (req) => policy.set(req),
    dispose: () => {
      policy.dispose();
      dockSignal?.drop(key);
    },
  };
}
