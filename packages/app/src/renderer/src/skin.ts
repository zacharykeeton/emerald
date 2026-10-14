import { useSyncExternalStore } from 'react';
import type { Skin } from '../../preload/api.ts';

export type { Skin };

// The window's skin (M9 fix 569): Classic or Emerald, picked on the app
// menu and kept in localStorage. With nothing stored the renderer follows
// main's answer (M9 fix 628: Emerald, Classic under the harness), since
// main painted the first frame from it. Applied as data-skin on <html>,
// where style.css's :root[data-skin="emerald"] block sets the tokens again,
// and sent to main, which paints what the renderer cannot. Its own file
// rather than ui.ts, so the skin's readers import nothing else.
export const SKIN_KEY = 'emerald.skin';

export function loadSkin(): Skin {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SKIN_KEY);
  } catch {
    // Read as nothing stored.
  }
  if (stored === 'emerald' || stored === 'classic') return stored;
  try {
    return window.emerald.mainSkin();
  } catch {
    return 'emerald';
  }
}

// Read at module load, so a caller before the first render gets the
// stored skin.
let current: Skin = loadSkin();
const listeners = new Set<() => void>();

export function getSkin(): Skin {
  return current;
}

export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSkin(skin: Skin): void {
  current = skin;
  try {
    localStorage.setItem(SKIN_KEY, skin);
  } catch {
    // The skin then lasts the session.
  }
  if (skin === 'emerald') document.documentElement.dataset.skin = 'emerald';
  else delete document.documentElement.dataset.skin;
  window.emerald.setSkin(skin);
  for (const listener of listeners) listener();
}

export function useSkin(): Skin {
  return useSyncExternalStore(subscribeSkin, getSkin);
}
