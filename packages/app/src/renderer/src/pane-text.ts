// M9 fix 899: a pane's text size beyond the terminal. A pane off 14 px carries --pane-text (its size) and --pane-text-scale (the size over 14) on its root, and every face that is not a terminal or an editor zooms its content by the scale, so headings, chips and gaps keep their proportions.
import { PANES, commitsFolder, isDocument, isWhatsNew, statsFolder } from './tabs-model.ts';
import { reviewFolder, reviewSessionId } from './review-model.ts';

const PANE_TEXT_BASE = 14; // ui.ts's FONT_SIZE_DEFAULT, kept here so this module loads without ui.ts

export function paneTextVars(px: number): Record<string, string> | null {
  if (px === PANE_TEXT_BASE) return null;
  return { '--pane-text': `${px}px`, '--pane-text-scale': String(Math.round((px / PANE_TEXT_BASE) * 10000) / 10000) };
}

// A size given in px at the 14 px base, at the pane's size: Monaco's 13
// reads 14 at 15 px and 15 at 16 px.
export function paneScaled(base: number, px: number): number {
  return Math.round((base * px) / PANE_TEXT_BASE);
}

// The size key of a file tab on the strip, which has no pane: its path,
// so the size follows the file in every tab and window that shows it.
export const FILE_TEXT_PREFIX = 'file:';

export function fileTextKey(path: string): string {
  return FILE_TEXT_PREFIX + path;
}

// The key when the active tab is one App.tsx renders as a plain FileView;
// null for the panes and every document of the app's own.
export function fileTabTextKey(active: string): string | null {
  if (active === PANES) return null;
  if (reviewSessionId(active) !== null || reviewFolder(active) !== null) return null;
  if (commitsFolder(active) !== null || statsFolder(active) !== null) return null;
  if (isWhatsNew(active) || isDocument(active)) return null;
  return fileTextKey(active);
}
