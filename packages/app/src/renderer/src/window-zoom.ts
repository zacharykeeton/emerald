import { parseZoomLevel, stepZoomLevel, zoomPercent } from '@emerald/shared';
import { flashCornerNote } from './ui.ts';

// M9 fix 900: the whole window's zoom, VS Code's Ctrl+= and Ctrl+-, one
// page zoom set through the preload's webFrame. The level is kept in the
// profile under one key, absent at 100 percent.
const ZOOM_KEY = 'emerald.zoom';

function readLevel(): number {
  try {
    return parseZoomLevel(localStorage.getItem(ZOOM_KEY));
  } catch {
    return 0;
  }
}

function writeLevel(level: number): void {
  try {
    if (level === 0) localStorage.removeItem(ZOOM_KEY);
    else localStorage.setItem(ZOOM_KEY, String(level));
  } catch {}
}

// Set whatever the key reads, 0 included, so a zoom Chromium kept from
// before is overruled by the key, and a harness on a fresh profile starts
// at 100 percent, which every verify script's pixel reads assume. A change
// made in another window of the profile (fix 867) is applied here too,
// with no note.
export function startWindowZoom(): void {
  window.emerald.zoom.set(readLevel());
  window.addEventListener('storage', (ev) => {
    if (ev.key !== ZOOM_KEY) return;
    window.emerald.zoom.set(parseZoomLevel(ev.newValue));
  });
}

function applyLevel(level: number): void {
  writeLevel(level);
  window.emerald.zoom.set(level);
  // At a bound the level stays and the note still shows, so `Zoom 249%`
  // says why nothing moved.
  flashCornerNote(`Zoom ${zoomPercent(level)}%`);
}

export function stepWindowZoom(dir: 1 | -1): void {
  applyLevel(stepZoomLevel(Math.round(window.emerald.zoom.level()), dir));
}

export function resetWindowZoom(): void {
  applyLevel(0);
}
