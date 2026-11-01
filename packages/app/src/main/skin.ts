import fs from 'node:fs';
import type { Skin, Theme } from '../preload/api.ts';
import { currentTheme } from './theme.ts';

export type { Skin };

// The skin as main keeps it (M9 fix 569): the one the renderer last sent,
// in <EMERALD_HOME>/skin.json, so the next window opens in it (Emerald when
// the file names none, M9 fix 628), and the
// three colours main paints itself because the renderer cannot: the window
// ground before the first frame and the caption buttons' overlay. No
// runtime import of electron, so the test runs under Node.

// The TitleBar row's height (style.css .title-bar).
export const TITLE_BAR_HEIGHT = 26;

export interface Chrome {
  bg: string;
  overlay: string;
  symbol: string;
}

// The --chrome-bg, --chrome-overlay and --chrome-symbol tokens of the four
// blocks in style.css (each skin dark and light, M9 fix 1032), kept here
// since main paints before the renderer can speak; skin.test.ts holds them
// equal to the CSS.
export const CHROME: Record<Skin, Record<Theme, Chrome>> = {
  classic: {
    dark: { bg: '#1e1e1e', overlay: '#202020', symbol: '#9a9a9a' },
    light: { bg: '#f8f8f8', overlay: '#f2f2f2', symbol: '#404040' },
  },
  emerald: {
    dark: { bg: '#1a1f1d', overlay: '#1c211f', symbol: '#9a9a9a' },
    light: { bg: '#f7f9f8', overlay: '#f1f4f2', symbol: '#3d4542' },
  },
};

// The skin a launch takes when nothing names one (M9 fix 628): Emerald,
// except under the harness, whose launch sets EMERALD_SKIN=classic so the
// Classic colour reads of every verify script hold (verify:skin reads the
// Emerald twins). It replaces only the fallback: a skin.json that names a
// skin wins over it.
export function defaultSkin(env: NodeJS.ProcessEnv = process.env): Skin {
  return env['EMERALD_SKIN'] === 'classic' ? 'classic' : 'emerald';
}

export function parseSkin(raw: unknown): Skin {
  if (raw === 'emerald') return 'emerald';
  if (raw === 'classic') return 'classic';
  return defaultSkin();
}

// A missing file, bad JSON or any other value is the default skin; only a
// failure other than a missing file is worth a log line.
export function readSkinFile(file: string, logFn: (msg: string) => void = () => {}): Skin {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logFn(`could not read ${file}: ${String(err)}`);
    return defaultSkin();
  }
  try {
    return parseSkin((JSON.parse(text) as { skin?: unknown } | null)?.skin);
  } catch {
    return defaultSkin();
  }
}

let file: string | null = null;
let current: Skin = defaultSkin();
let log: (msg: string) => void = () => {};

export function initSkin(path: string, logFn: (msg: string) => void): Skin {
  file = path;
  log = logFn;
  current = readSkinFile(path, logFn);
  return current;
}

export function currentSkin(): Skin {
  return current;
}

export function chromeOf(skin: Skin, theme: Theme): Chrome {
  return CHROME[skin][theme];
}

// The window as applySkin needs it, so the test can hand it a fake.
export interface SkinWindow {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void;
}

// The emerald:skin-set handler's work: keep the skin, write it down when it
// changed, repaint the window's chrome, and say so in the log, which is
// what verify:skin reads. A Mac has no title bar overlay to repaint
// (M9 fix 1023: Electron has no setTitleBarOverlay on darwin), so only the
// ground is set there; the log line is the same on every platform.
export function applySkin(win: SkinWindow | null, raw: unknown, platform: NodeJS.Platform = process.platform): void {
  const skin = parseSkin(raw);
  if (skin !== current && file !== null) {
    try {
      fs.writeFileSync(file, JSON.stringify({ skin }) + '\n');
    } catch (err) {
      log(`could not write ${file}: ${String(err)}`);
    }
  }
  current = skin;
  const c = chromeOf(skin, currentTheme().theme);
  paint(win, c, platform);
  log(`skin ${skin}: ground ${c.bg}, title bar overlay ${c.overlay}, symbols ${c.symbol}`);
}

function paint(win: SkinWindow | null, c: Chrome, platform: NodeJS.Platform): void {
  if (win === null || win.isDestroyed()) return;
  win.setBackgroundColor(c.bg);
  if (platform !== 'darwin') win.setTitleBarOverlay({ color: c.overlay, symbolColor: c.symbol, height: TITLE_BAR_HEIGHT });
}

// A theme pick or flip (M9 fix 1032): the same repaint for the skin held,
// and a line verify:skin reads, the same on every platform.
export function applyTheme(win: SkinWindow | null, platform: NodeJS.Platform = process.platform): void {
  const t = currentTheme();
  const c = chromeOf(current, t.theme);
  paint(win, c, platform);
  log(`theme ${t.theme} (pick ${t.pick}), skin ${current}: ground ${c.bg}, title bar overlay ${c.overlay}, symbols ${c.symbol}`);
}
