// The stall threshold (M9 fix 232): how long a working session may go
// without a hook before it is flagged stale. Relative to the session's
// own pace this turn, three times the median gap between its PostToolUse
// lines, so a turn of quick edits is caught in minutes and a turn that
// runs a long build is not flagged while the build's own silence is the
// norm; floored at Limits.staleAfterMs (EMERALD_STALE_AFTER_MS overrides
// the floor for a script), so a session with one or no tool call yet, or
// a quick one, is judged by the floor alone.

export const STALE_GAP_FACTOR = 3;

// The PostToolUse times of the current turn, oldest first, as the daemon
// keeps them on the record; the gaps are between consecutive ones.
export function staleThresholdMs(toolAt: readonly number[], floorMs: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < toolAt.length; i += 1) gaps.push(Math.max(0, toolAt[i]! - toolAt[i - 1]!));
  if (gaps.length === 0) return floorMs;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.max(floorMs, Math.round(median * STALE_GAP_FACTOR));
}
