import type { TaskbarWindow } from './taskbar-policy.ts';

// The dock as the attention signal on a Mac (M9 fix 1024). Windows has a
// taskbar button per window (fix 866), each with its own flash and badge; a
// Mac has one dock icon for every window. So each window's taskbar gets a
// TaskbarWindow that keeps that window's last count here, the badge is the
// largest count over the windows, and the flash is one informational bounce
// held until the policy clears it. The pulse, the bar and the tooltip are
// Windows' and do nothing here. No electron import: Electron's Dock fits
// DockLike, and the test hands a fake.

export interface DockLike {
  setBadge(text: string): void;
  bounce(type?: 'critical' | 'informational'): number;
  cancelBounce(id: number): void;
}

export interface DockSignal {
  windowFor(key: number): TaskbarWindow;
  drop(key: number): void;
}

export function createDockSignal(dock: DockLike): DockSignal {
  const counts = new Map<number, number>();
  let bounceId: number | null = null;
  // The text last set, so a repeated count calls setBadge once.
  let shown: string | null = null;

  const badge = () => {
    let max = 0;
    for (const n of counts.values()) if (n > max) max = n;
    const text = max > 0 ? String(max) : '';
    if (text === shown) return;
    shown = text;
    dock.setBadge(text);
  };

  return {
    windowFor(key) {
      return {
        flashFrame(on) {
          if (on) {
            if (bounceId === null) bounceId = dock.bounce('informational');
          } else if (bounceId !== null) {
            dock.cancelBounce(bounceId);
            bounceId = null;
          }
        },
        setOverlay(count) {
          counts.set(key, count ?? 0);
          badge();
        },
        setProgress() {},
        setTooltip() {},
      };
    },
    drop(key) {
      counts.delete(key);
      badge();
    },
  };
}
