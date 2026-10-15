// Which of the sheet's keyframes are pulses (M9 fix 729). The pulse sync in
// attention.ts walks the document's animations once and puts a pulse on
// the document's time zero, so every pulse shares one clock. It works by
// allowlist: anything it does not name (the sheet's one-shots, its two
// endless non-pulses, Monaco's own fades, xterm's DOM-renderer cursor
// blink) keeps its own clock, since the pass reaches the whole document
// and a one-shot on time zero would be over before it was seen.
// pulse-sync-model.test.ts reads style.css and fails when a keyframe is in
// none of the three sets, so a new one is filed here by someone.

// The endless pulses: the working marks' frames, the shell caret, the
// needs-input breathing, the turn band, the live dot and the attention
// row, ring and wash.
export const PULSE_ANIMATIONS: ReadonlySet<string> = new Set([
  'session-mark-frame',
  'shell-caret',
  'needs-pulse',
  'turn-band',
  'live-dot',
  'attention-pulse',
  'attention-ring',
  'attention-wash',
]);

// The one-shots: the focus flash, the Files rail's row flash (two names,
// so a repeat restarts it), the stalled flash, the commit graph's fresh
// node and the odometer roll of a figure.
export const ONE_OFF_ANIMATIONS: ReadonlySet<string> = new Set([
  'focus-flash',
  'files-row-flash-a',
  'files-row-flash-b',
  'stalled-flash',
  'commits-fresh',
  'figure-roll-out',
  'figure-roll-in',
  'figure-fade-out',
  'figure-fade-in',
]);

// Endless, but never under a pulsing element: the usage refresh spinner and
// the title bar mark's glint. Left on their own clocks.
export const ENDLESS_LEFT_ALONE: ReadonlySet<string> = new Set(['usage-spin', 'title-gem-glint']);

export function isPulse(name: string): boolean {
  return PULSE_ANIMATIONS.has(name);
}
