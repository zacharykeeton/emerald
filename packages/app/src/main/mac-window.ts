import type { MenuItemConstructorOptions } from 'electron';
import { TITLE_BAR_HEIGHT } from './skin.ts';
import type { Chrome } from './skin.ts';

// The window's title row on a Mac (M9 fix 1023). Windows and Linux draw
// the caption buttons over the right end of the renderer's own row through
// titleBarOverlay; a Mac draws its three buttons (the traffic lights) at
// the left, placed by trafficLightPosition, and gets no overlay at all: an
// overlay there would turn on the Window Controls Overlay and start the
// row after the buttons with nothing drawn under them. Type-only electron
// imports, so node --test runs this file.

// The y centres the 14 px buttons on the 26 px row, (26 - 14) / 2.
export const TRAFFIC_LIGHTS = { x: 12, y: (TITLE_BAR_HEIGHT - 14) / 2 } as const;

export type TitleBarOptions =
  | { titleBarOverlay: { color: string; symbolColor: string; height: number } }
  | { trafficLightPosition: { x: number; y: number } };

export function titleBarOptions(chrome: Chrome, platform: NodeJS.Platform = process.platform): TitleBarOptions {
  if (platform === 'darwin') return { trafficLightPosition: { ...TRAFFIC_LIGHTS } };
  return { titleBarOverlay: { color: chrome.overlay, symbolColor: chrome.symbol, height: TITLE_BAR_HEIGHT } };
}

// On a Mac the first menu of the template becomes the app menu, so without
// appMenu first the File menu would take its place and the app would have
// no Quit and no Cmd+Q.
export function menuHead(platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  return platform === 'darwin' ? [{ role: 'appMenu' }] : [];
}
