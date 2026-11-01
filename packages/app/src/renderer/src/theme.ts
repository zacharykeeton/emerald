import { useSyncExternalStore } from 'react';
import type { Theme, ThemePick, ThemeState } from '../../preload/api.ts';

export type { Theme, ThemePick, ThemeState };

// The window's theme (M9 fix 1032), as main resolves it: the pick made on
// the app menu's Theme item (fix 1033) and the theme it comes to now. Only
// main can resolve Follow Windows, so this page never decides the theme:
// it shows main's answer at start and every one main sends after. Under
// light <html> carries data-theme="light", where style.css's two light
// blocks set the tokens again; under dark it carries no data-theme at all.
// Nothing else in the app writes the attribute and no localStorage key
// holds the theme, so a script that writes the attribute by CDP changes
// the page's colours without telling main or this module.
const START: ThemeState = { pick: 'system', theme: 'dark' };
let current: ThemeState = START;
const listeners = new Set<() => void>();

export function getTheme(): ThemeState {
  return current;
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribeTheme, getTheme);
}

function showTheme(state: ThemeState): void {
  current = state;
  if (state.theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  for (const listener of listeners) listener();
}

// Sends the pick to main and changes nothing here: main answers every
// window, this one included, through emerald:theme-changed.
export function setThemePick(pick: ThemePick): void {
  window.emerald.setThemePick(pick);
}

// Called before React renders, so a light window never paints a dark frame.
export function startTheme(): void {
  let state = START;
  try {
    state = window.emerald.mainTheme();
  } catch {
    // A main from before the channel: the starting state.
  }
  showTheme(state);
  try {
    window.emerald.onThemeChanged(showTheme);
  } catch {
    // Nothing to follow.
  }
}
