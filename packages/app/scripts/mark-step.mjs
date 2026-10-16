// M9 fix 767: whether a session mark is stepping, read in the page. The
// working marks run no animation since this fix; the root's
// data-mark-frame (mark-clock.ts) names the frame every working mark
// shows. Embed it as `(${MARK_STEPPING})(<element>)` in a page expression.
// It returns null for no element, and true only when the mark is working,
// its still is hidden, exactly one frame is at opacity 1 and that frame is
// the one the root names; so it reads false under reduced motion, at rest
// and on a needs-input mark.
export const MARK_STEPPING = `((m) => {
  if (!m) return null;
  if (m.dataset.working !== 'true') return false;
  const still = m.querySelector('.session-mark-still');
  if (!still || getComputedStyle(still).visibility !== 'hidden') return false;
  const frames = [...(m.querySelector('.session-mark-frames')?.children ?? [])];
  const shown = frames.map((f, i) => (getComputedStyle(f).opacity === '1' ? i : -1)).filter((i) => i >= 0);
  if (shown.length !== 1) return false;
  return shown[0] === Number(document.documentElement.dataset.markFrame);
})`;
