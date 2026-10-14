import type { LoadSample } from './session.ts';

// The per-session load mark (M9 fix 301, docs/design/per-agent-load.md
// section 6): the arithmetic that turns a session's sample ring into a
// sparkline's points, a ceiling shared by every sparkline in the window,
// an ink and a figure. Pure, so the row and the title bar draw the same
// line and the test can read the numbers off.

// At or above this the line and its figure go amber, ink only.
export const LOAD_HOT_AT = 200;
// The row and the title bar read the last five minutes of the ring.
export const LOAD_SPAN_MS = 300_000;
// Under this many samples in the span a session has no load at all, a
// dash and no figure, never a zero line: idle and unmeasured are not
// the same claim.
export const LOAD_MIN_SAMPLES = 3;
// The ceiling never drops under this, so a quiet window keeps one core's
// worth of headroom above every line.
export const LOAD_CEILING_FLOOR = 200;
// Half a pixel of padding inside the box top and bottom, so a flat line
// sits just above the baseline instead of on it and a clipped line does
// not merge with the row above.
export const LOAD_PAD = 0.5;

export interface SparkBox {
  width: number;
  height: number;
  ceiling: number;
  now: number;
  span?: number;
}

// The samples inside the span, oldest first. No upper bound: the
// renderer's clock ticks once a second, so a sample the daemon stamped
// a moment ago can sit past `now` and must still count, else it lands a
// tick late and two appear at once.
export function loadWindow(samples: readonly LoadSample[] | null | undefined, now: number, span: number = LOAD_SPAN_MS): LoadSample[] {
  if (samples == null) return [];
  const from = now - span;
  return samples.filter((s) => s.at >= from).sort((a, b) => a.at - b.at);
}

export function hasLoad(samples: readonly LoadSample[] | null | undefined, now: number, span: number = LOAD_SPAN_MS): boolean {
  return loadWindow(samples, now, span).length >= LOAD_MIN_SAMPLES;
}

// The polyline's points, one per sample in the span, x by the sample's
// age across the box (now at the right edge), y by its cpu against the
// ceiling with the padding, a sample above the ceiling clipped to the
// top. Empty with no sample in the span.
export function sparkPath(samples: readonly LoadSample[] | null | undefined, box: SparkBox): string {
  const span = box.span ?? LOAD_SPAN_MS;
  const inSpan = loadWindow(samples, box.now, span);
  if (inSpan.length === 0 || box.ceiling <= 0) return '';
  const usable = Math.max(0, box.height - 2 * LOAD_PAD);
  return inSpan
    .map((s) => {
      const x = box.width * Math.min(1, Math.max(0, 1 - (box.now - s.at) / span));
      const share = Math.min(1, Math.max(0, s.cpu) / box.ceiling);
      const y = LOAD_PAD + usable * (1 - share);
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// The highest cpu inside the span, 0 with no sample there.
export function loadPeak(samples: readonly LoadSample[] | null | undefined, span: number, now: number): number {
  let peak = 0;
  for (const s of loadWindow(samples, now, span)) if (s.cpu > peak) peak = s.cpu;
  return peak;
}

// The next hundred at or above n; 0 stays 0.
export function next100(n: number): number {
  return Math.ceil(Math.max(0, n) / 100) * 100;
}

// The ceiling every sparkline in the window shares, off each listed
// session's five-minute peak: the next hundred above the loudest, never
// under the floor, and capped at the next hundred above four times the
// second-loudest so one session that dwarfs the rest clips at a rule
// and prints its peak while everyone else keeps usable travel. A single
// session's second-highest reads as 0, which is no cap, so one session
// alone reads the floor or its own next hundred. Peaks, not current
// values, so the ceiling does not move every tick.
export function loadCeiling(peaks: readonly number[]): number {
  const sorted = [...peaks].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => b - a);
  const max = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const cap = second > 0 ? next100(4 * second) : Infinity;
  return Math.max(LOAD_CEILING_FLOOR, Math.min(next100(max), cap));
}

export type LoadInk = 'load-ink' | 'load-hot';

export function loadInk(cpu: number): LoadInk {
  return cpu >= LOAD_HOT_AT ? 'load-hot' : 'load-ink';
}

// Whole percent with the sign: 38%, 319%.
export function loadFigure(cpu: number): string {
  return `${Math.round(Math.max(0, cpu))}%`;
}

// 640 MB under a thousand, 1.2 GB from there.
export function memText(mb: number): string {
  const n = Math.max(0, mb);
  return n < 1000 ? `${Math.round(n)} MB` : `${(n / 1024).toFixed(1)} GB`;
}
