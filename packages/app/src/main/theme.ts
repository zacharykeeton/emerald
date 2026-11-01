import fs from 'node:fs';
import type { Theme, ThemePick, ThemeState } from '../preload/api.ts';

export type { Theme, ThemePick, ThemeState };

// The theme as main keeps it (M9 fix 1032): the pick the renderer last sent,
// in <EMERALD_HOME>/theme.json, and what it resolves to now. Only main can
// resolve Follow Windows, since only main can read the OS's answer
// (Electron's nativeTheme), so every window learns the theme from here. No
// runtime import of electron, so the test runs under Node.

// Electron's nativeTheme satisfies this; the test and the harness's stub
// (fileNativeTheme below) implement it.
export interface NativeThemeLike {
  themeSource: ThemePick;
  readonly shouldUseDarkColors: boolean;
  on(event: 'updated', listener: () => void): unknown;
}

// The pick a launch takes when nothing names one: Follow Windows, except
// under the harness, whose launch sets EMERALD_THEME=dark so every computed
// colour read of every verify script holds on a box whose Windows is light.
// Like defaultSkin it replaces only the fallback: a theme.json that names a
// pick wins over it, which is what lets verify:skin pick on the menu with
// the pin in place.
export function defaultThemePick(env: NodeJS.ProcessEnv = process.env): ThemePick {
  if (env['EMERALD_THEME'] === 'dark') return 'dark';
  if (env['EMERALD_THEME'] === 'light') return 'light';
  return 'system';
}

export function parseThemePick(raw: unknown): ThemePick {
  if (raw === 'system' || raw === 'light' || raw === 'dark') return raw;
  return defaultThemePick();
}

// A missing file, bad JSON or any other value is the default pick; only a
// failure other than a missing file is worth a log line.
export function readThemeFile(file: string, logFn: (msg: string) => void = () => {}): ThemePick {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logFn(`could not read ${file}: ${String(err)}`);
    return defaultThemePick();
  }
  try {
    return parseThemePick((JSON.parse(text) as { pick?: unknown } | null)?.pick);
  } catch {
    return defaultThemePick();
  }
}

let file: string | null = null;
let pick: ThemePick = defaultThemePick();
let native: NativeThemeLike | null = null;
let theme: Theme = 'dark';
let log: (msg: string) => void = () => {};

// Light is light and dark is dark; Follow Windows asks the OS, and is dark
// until a native theme is attached (before the app is ready).
function resolve(): Theme {
  if (pick === 'light') return 'light';
  if (pick === 'dark') return 'dark';
  if (native === null) return 'dark';
  return native.shouldUseDarkColors ? 'dark' : 'light';
}

export function initTheme(path: string, logFn: (msg: string) => void): ThemeState {
  file = path;
  log = logFn;
  pick = readThemeFile(path, logFn);
  if (native !== null) native.themeSource = pick;
  theme = resolve();
  return currentTheme();
}

// Called in whenReady, before the first window: setting themeSource also
// flips prefers-color-scheme for every page, the browser pane's guests too.
export function attachNativeTheme(n: NativeThemeLike): ThemeState {
  native = n;
  n.themeSource = pick;
  theme = resolve();
  return currentTheme();
}

export function currentTheme(): ThemeState {
  return { pick, theme };
}

// The emerald:theme-set handler's work: keep the pick, write it down when it
// changed, tell the OS layer, resolve.
export function applyThemePick(raw: unknown): ThemeState {
  const next = parseThemePick(raw);
  if (next !== pick && file !== null) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pick: next }) + '\n');
    } catch (err) {
      log(`could not write ${file}: ${String(err)}`);
    }
  }
  pick = next;
  if (native !== null) native.themeSource = pick;
  theme = resolve();
  return currentTheme();
}

// The nativeTheme 'updated' and window-focus handler: re-resolve, and the
// new state only when the resolved theme moved. Idempotent, since setting
// themeSource fires 'updated' too (the probe of fix 1032 measured two
// events for three sets), and a pick has already repainted by then.
export function themeUpdated(): ThemeState | null {
  const next = resolve();
  if (next === theme) return null;
  theme = next;
  return currentTheme();
}

// The harness's stand-in for Windows' answer (EMERALD_SYSTEM_THEME_FILE): a
// verify run must never flip the person's own Windows theme, and this
// drives the same handler a real flip does. The file reading `light` after
// a trim is a light OS, anything else (a missing file too) dark; under a
// forced themeSource the flag is what the source says, as Electron's is.
export function fileNativeTheme(path: string, intervalMs = 100): NativeThemeLike & { close(): void } {
  const listeners: Array<() => void> = [];
  const osDark = (): boolean => {
    try {
      return fs.readFileSync(path, 'utf8').trim() !== 'light';
    } catch {
      return true;
    }
  };
  fs.watchFile(path, { interval: intervalMs }, () => {
    for (const l of listeners) l();
  });
  return {
    themeSource: 'system',
    get shouldUseDarkColors() {
      if (this.themeSource === 'light') return false;
      if (this.themeSource === 'dark') return true;
      return osDark();
    },
    on(_event: 'updated', listener: () => void) {
      listeners.push(listener);
      return this;
    },
    close() {
      fs.unwatchFile(path);
    },
  };
}
