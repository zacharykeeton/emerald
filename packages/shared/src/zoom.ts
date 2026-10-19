// M9 fix 900: VS Code's zoom: a level, each step 20 percent of the one before (the factor is 1.2 to the level, Chromium's own zoom level), from 58 to 249 percent.
// Fix 899 adds the file for a browser page's Ctrl+wheel, which steps in the same levels.
export const ZOOM_LEVEL_MIN = -3;
export const ZOOM_LEVEL_MAX = 5;

export function stepZoomLevel(level: number, dir: 1 | -1): number {
  return Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, level + dir));
}

// The level as the corner note says it: 58, 69, 83, 100, 120, 144, 173, 207, 249.
export function zoomPercent(level: number): number {
  return Math.round(100 * 1.2 ** level);
}

// A stored level: an integer string within the bounds, else 0.
export function parseZoomLevel(raw: string | null): number {
  if (raw === null || !/^-?\d+$/.test(raw)) return 0;
  const level = Number(raw);
  return level >= ZOOM_LEVEL_MIN && level <= ZOOM_LEVEL_MAX ? level : 0;
}
