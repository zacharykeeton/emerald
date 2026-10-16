// The working marks' one clock (M9 fix 767). Every working mark shows one
// of four frames a quarter second each; until this fix each frame span ran
// its own step-end animation, four a mark, about 180 session-mark-frame
// animations at twenty sessions, which fix 663 read at a fifth of the
// renderer. Now the root carries data-mark-frame 0 to 3 and the sheet
// shows that frame in every working mark, so a step is one attribute
// write. The frame is read off the wall clock, so a late tick still lands
// on the right frame and two windows agree, and each tick is scheduled to
// the next quarter rather than on a drifting setInterval. Reduced motion
// is the sheet's to honour: its frame rule sits inside the no-preference
// media query, and the attribute alone draws nothing.

export const MARK_STEP_MS = 250;

export function markFrameAt(nowMs: number): number {
  return Math.floor(nowMs / MARK_STEP_MS) % 4;
}

export function msToNextStep(nowMs: number): number {
  return MARK_STEP_MS - (nowMs % MARK_STEP_MS);
}

export function startMarkClock(): void {
  const tick = (): void => {
    const now = Date.now();
    const frame = String(markFrameAt(now));
    const root = document.documentElement;
    if (root.dataset['markFrame'] !== frame) root.dataset['markFrame'] = frame;
    // Two milliseconds past the quarter, so a timer that fires a hair early
    // still reads the new frame.
    setTimeout(tick, msToNextStep(Date.now()) + 2);
  };
  tick();
}
