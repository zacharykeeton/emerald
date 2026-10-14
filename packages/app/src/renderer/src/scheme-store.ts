import { useSyncExternalStore } from 'react';
import emeraldScheme from '../../../resources/schemes/emerald.json';
import emeraldGemScheme from '../../../resources/schemes/emerald-gem.json';
import { SCHEME_KEY, orderSchemes, pickScheme, schemeFromWindowsTerminal, storedPick, themeOf } from './scheme-model.ts';
import type { SchemeSkin, TerminalScheme, XtermTheme } from './scheme-model.ts';
import { getSkin, subscribeSkin } from './skin.ts';

// The terminal's colour scheme for this window (M9 fix 225): the list
// the main process read (the shipped ones, then the person's Windows
// Terminal ones) and the pick, kept in localStorage under emerald.scheme
// the way the text size is, one scheme per window. Every terminal reads
// the theme through useScheme and sets term.options.theme when it
// changes, and the pane's ground follows through --pane-bg on the root
// (style.css, the .term-host rules), so a light scheme does not sit in a
// dark box with a hard edge. Apart from ui.ts, since that file mirrors
// what the panes and the sidebar do and this is one setting with a list
// behind it. M9 fix 244: a session can wear a scheme of its own, kept
// on its record by the daemon (session.set's scheme), and each terminal
// resolves the session's over the window's (resolveScheme in
// scheme-model.ts) and puts the ground on its own host; the root keeps
// the window's for the empty pane and the views. The pane menu has a
// list for each (M9 fix 648), so the store keeps no scope.

interface SchemeState {
  // The skin the state was resolved under, so a flip hands every reader a
  // new state.
  skin: SchemeSkin;
  schemes: readonly TerminalScheme[];
  // The name picked, or null for the default; kept even when the list
  // does not hold it (the person's Windows Terminal scheme went away),
  // so it comes back when the list does.
  picked: string | null;
  // The scheme in force and its xterm theme, resolved from the two above.
  current: TerminalScheme;
  theme: XtermTheme;
}

// The two shipped palettes the skins default to, from their files, so a
// terminal built before the handler answers already wears the skin's
// default and the hex lives in one place (the JSON) rather than here and
// there.
function builtIn(json: unknown, file: string): TerminalScheme {
  const scheme = schemeFromWindowsTerminal(json, 'shipped');
  if (scheme === null) throw new Error(`resources/schemes/${file} is not a colour scheme`);
  return scheme;
}
export const BUILT_IN_SCHEMES: readonly TerminalScheme[] = [builtIn(emeraldScheme, 'emerald.json'), builtIn(emeraldGemScheme, 'emerald-gem.json')];

function resolve(schemes: readonly TerminalScheme[], picked: string | null, skin: SchemeSkin): Pick<SchemeState, 'current' | 'theme'> {
  // The ?? only types it; the built-in list is never empty.
  const current = pickScheme(schemes, picked, skin) ?? BUILT_IN_SCHEMES[0]!;
  return { current, theme: themeOf(current) };
}

function loadPicked(): string | null {
  try {
    const raw = localStorage.getItem(SCHEME_KEY);
    return raw === null || raw === '' ? null : raw;
  } catch {
    return null;
  }
}

let state: SchemeState = (() => {
  const picked = loadPicked();
  const skin = getSkin();
  const schemes = orderSchemes(BUILT_IN_SCHEMES, skin);
  return { skin, schemes, picked, ...resolve(schemes, picked, skin) };
})();
const listeners = new Set<() => void>();
let asked = false;

function setState(next: SchemeState): void {
  state = next;
  applyGround(state.current);
  for (const l of listeners) l();
}

// The window's ground and a hook for the verify scripts: the scheme's
// name on the root, its background as --pane-bg. A terminal whose
// session wears its own scheme sets the same property on its host (M9
// fix 244, TerminalView), over this one.
function applyGround(s: TerminalScheme): void {
  const root = document.documentElement;
  root.style.setProperty('--pane-bg', s.background);
  root.dataset['scheme'] = s.name;
}

// Asks the main process once per renderer life; a second call is a
// refresh (the menu opening asks again, so a scheme added to Windows
// Terminal while the app runs shows on the next right click). Resolves
// with the list read, or the list held when the read failed, for a
// caller that wants to check a name against it (M9 fix 375).
export function loadSchemes(): Promise<readonly TerminalScheme[]> {
  asked = true;
  return window.emerald.schemes
    .list()
    .then((schemes) => {
      // Ordered again here, so a list main sorted before a flip landed is
      // put right and no IPC ordering is relied on.
      const list = orderSchemes(schemes.length === 0 ? BUILT_IN_SCHEMES : schemes, state.skin);
      setState({ ...state, schemes: list, ...resolve(list, state.picked, state.skin) });
      return list;
    })
    .catch((err: unknown) => {
      console.warn('[emerald] could not read the colour schemes', err);
      return state.schemes;
    });
}

export function getSchemeState(): SchemeState {
  return state;
}

export function subscribeScheme(listener: () => void): () => void {
  listeners.add(listener);
  if (!asked) void loadSchemes();
  return () => {
    listeners.delete(listener);
  };
}

export function useScheme(): SchemeState {
  return useSyncExternalStore(subscribeScheme, getSchemeState);
}

// The pick, by name; the skin's default clears the key so a fresh
// profile and one that chose it read the same (M9 fix 572).
export function setScheme(name: string): void {
  const picked = storedPick(name, state.skin);
  setState({ ...state, picked, ...resolve(state.schemes, picked, state.skin) });
  try {
    if (picked === null) localStorage.removeItem(SCHEME_KEY);
    else localStorage.setItem(SCHEME_KEY, picked);
  } catch {
    // The pick just will not survive the restart.
  }
}

// The ground is applied once at load too, so a pane's box is the right
// colour before the first terminal opens.
applyGround(state.current);

// On a flip (M9 fix 572) the window's scheme re-resolves under the new
// skin's default; a pick and a session's own scheme are names, so they
// hold.
subscribeSkin(() => {
  const skin = getSkin();
  if (skin === state.skin) return;
  const schemes = orderSchemes(state.schemes, skin);
  setState({ ...state, skin, schemes, ...resolve(schemes, state.picked, skin) });
});
