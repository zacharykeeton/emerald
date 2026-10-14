// Which layers an activity picture draws (M9 fix 166): the load band
// above the lanes, the lanes alone, or both. One value per place, kept
// in localStorage under the place's own key (the tab's and the rail
// card's are looked at for different reasons, so each keeps its own),
// cycled by one button as the rail's unit pill cycles (M9 fix 121).
// The pure parts live here so a test can read them without React. The
// tab and the pane keep theirs as their own state since M9 fix 178 (the
// query, the view record), the type being the shared one the record
// declares; the rail card alone still reads its key.

import type { ActivityViewLayers } from '@emerald/shared';

export type ActivityLayers = ActivityViewLayers;

const ORDER: readonly ActivityLayers[] = ['both', 'band', 'lanes'];

export function readLayers(key: string): ActivityLayers {
  try {
    const raw = localStorage.getItem(key);
    return raw === 'band' || raw === 'lanes' ? raw : 'both';
  } catch {
    return 'both';
  }
}

export function writeLayers(key: string, value: ActivityLayers): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice just will not survive the restart.
  }
}

// The state after a click: both, the band alone, the lanes alone, both.
export function nextLayers(value: ActivityLayers): ActivityLayers {
  return ORDER[(ORDER.indexOf(value) + 1) % ORDER.length]!;
}

// The button's tooltip names what the click will show, as the direction
// button on the commits graph does (M9 fix 162).
export function layersTitle(value: ActivityLayers): string {
  const next = nextLayers(value);
  if (next === 'band') return 'Show the band alone';
  if (next === 'lanes') return 'Show the lanes alone';
  return 'Show the band and the lanes';
}

export function showsBand(value: ActivityLayers): boolean {
  return value !== 'lanes';
}

export function showsLanes(value: ActivityLayers): boolean {
  return value !== 'band';
}
