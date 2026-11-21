import type { AttentionRequest, Skin } from '../preload/api.ts';

// The taskbar's attention policy (M9 fix 104), moved out of taskbar.ts so
// it can be tested without electron (M9 fix 560): taskbar.ts adapts a
// BrowserWindow and a timer to it. The renderer sends the size of its
// attention set on every change, with `flash` when it would chime for the
// arrival, and this does two things on Windows: the button's orange flash
// whenever a chime went out, and an overlay badge with the count, swapped
// between a bright and a dim frame at the sidebar's needs-pulse rate
// while anything is wanting. Both go when the count is zero. Under a
// private EMERALD_HOME both are held to the main log and nothing touches the
// taskbar (fix 47, fix 49's shape). M9 fix 870: and two more, on every
// change: the button's progress bar filled to the share of sessions working
// (cleared at none), and the thumbnail's tooltip naming the working and
// wanting counts; the badge keeps the corner. Both are held to the log under
// a private home with the rest. M9 fix 1200: and the glint, a sparkle in the
// overlay corner once every 10 s while something works and nobody wants you
// (the bar alone was not seen), which gives the corner to the badge at a
// want, rests under reduced motion and is held to the log under a private
// home.

export type TaskbarLog = (msg: string) => void;

// The sidebar's needs-pulse is 1.8s; the badge swaps frames twice a beat.
export const PULSE_MS = 1800;

// The glint's rhythm (M9 fix 1200): a sweep is frames 1 to 5 a step apart,
// then the rest frame, one sweep every period from the moment it turns on.
export const GLINT_STEP_MS = 125;
export const GLINT_PERIOD_MS = 10_000;

export type GlintFrame = 0 | 1 | 2 | 3 | 4 | 5;

// The window as the policy sees it: the flash, and the overlay as a count
// and a frame (null takes the badge off).
export interface TaskbarWindow {
  flashFrame(on: boolean): void;
  setOverlay(count: number | null, bright: boolean): void;
  setProgress(fraction: number | null): void;
  setTooltip(text: string): void;
  // M9 fix 1200: a glint frame on the overlay, or none (null).
  setGlint(frame: Buffer | null, description: string): void;
}

// The frame a glint shows at a time since it turned on (M9 fix 1200), read
// off the clock as markFrameAt is, so a late tick lands on the right frame.
export function glintFrameAt(elapsedMs: number): GlintFrame {
  const c = elapsedMs % GLINT_PERIOD_MS;
  return c < 5 * GLINT_STEP_MS ? ((Math.floor(c / GLINT_STEP_MS) + 1) as GlintFrame) : 0;
}

// The time to the glint's next step inside a sweep, or to the next sweep's
// start once past its last frame.
export function msToNextGlintFrame(elapsedMs: number): number {
  const c = elapsedMs % GLINT_PERIOD_MS;
  return c < 5 * GLINT_STEP_MS ? GLINT_STEP_MS - (c % GLINT_STEP_MS) : GLINT_PERIOD_MS - c;
}

const glintDescription = (working: number): string => (working === 1 ? '1 session working' : `${working} sessions working`);

// The bar's fill (M9 fix 870): the share of live sessions working, none
// at no working session.
export function taskbarProgress(working: number, live: number): number | null {
  return working === 0 || live === 0 ? null : working / live;
}

// The thumbnail's tooltip (M9 fix 870): both counts, the parts that are
// there, or that nothing is.
export function taskbarTooltip(working: number, wanting: number): string {
  const parts: string[] = [];
  if (working > 0) parts.push(`${working} working`);
  if (wanting > 0) parts.push(`${wanting} ${wanting === 1 ? 'wants' : 'want'} you`);
  return parts.length === 0 ? 'Nothing running' : parts.join(', ');
}

const countOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function createTaskbarPolicy(
  getWindow: () => TaskbarWindow | null,
  // dock (M9 fix 1024): a Mac's dock, which shows the count on every change
  // and the flash, and has no pulse, bar or tooltip.
  // timeout, now and reducedMotion (M9 fix 1200): the glint's one timer at a
  // time, its clock and the system's reduced motion; the held and dock
  // paths never call them.
  opts: {
    held: boolean;
    windows: boolean;
    dock?: boolean;
    log: TaskbarLog;
    every: (ms: number, fn: () => void) => () => void;
    timeout: (ms: number, fn: () => void) => () => void;
    now: () => number;
    reducedMotion: () => boolean;
  },
): { set(req: AttentionRequest): void; dispose(): void; pulsing(): boolean } {
  let wanting = 0;
  let bright = true;
  let stopPulse: (() => void) | null = null;
  // What the bar and the tooltip last showed (M9 fix 870); undefined is
  // never set, so the first request sets the tooltip.
  let lastBar: number | null = null;
  let lastTooltip: string | undefined;
  let lastProgressLine: string | undefined;
  // The glint (M9 fix 1200): whether it is on, when its sweeps started, the
  // frame last handed the window, the working count its description names,
  // its pending timeout, and its five frames, drawn once and handed over as
  // the same buffers every sweep so the adapter's image cache holds.
  let glintOn = false;
  let glintStart = 0;
  let glintShown: GlintFrame = 0;
  let glintWorking = 0;
  let stopGlintTimer: (() => void) | null = null;
  let glintFrames: (Buffer | null)[] | null = null;

  const paint = () => {
    const win = getWindow();
    if (win === null) return;
    win.setOverlay(wanting === 0 ? null : wanting, bright);
  };
  const stop = () => {
    if (stopPulse !== null) stopPulse();
    stopPulse = null;
  };
  const stopGlint = () => {
    if (stopGlintTimer !== null) stopGlintTimer();
    stopGlintTimer = null;
  };
  // Show the frame the clock names, only when it differs from the last one,
  // then schedule the next step two ms past its boundary (mark-clock's 2 ms,
  // so a timer that fires a hair early reads the new frame).
  const glintTick = () => {
    stopGlintTimer = null;
    const elapsed = opts.now() - glintStart;
    const frame = glintFrameAt(elapsed);
    if (frame !== glintShown) {
      const win = getWindow();
      if (win !== null) {
        glintFrames ??= ([0, 1, 2, 3, 4, 5] as const).map((f) => drawGlint(f));
        win.setGlint(glintFrames[frame]!, frame === 0 ? '' : glintDescription(glintWorking));
      }
      glintShown = frame;
    }
    stopGlintTimer = opts.timeout(msToNextGlintFrame(elapsed) + 2, glintTick);
  };
  // The flash, the badge and its pulse for one request.
  const badge = (win: TaskbarWindow, count: number, changed: boolean, flash: boolean) => {
    if (count === 0) {
      if (!changed) return;
      stop();
      win.flashFrame(false);
      if (opts.windows || opts.dock === true) paint();
      return;
    }
    if (flash) win.flashFrame(true);
    if (opts.dock === true && changed) paint();
    if (!opts.windows) return;
    if (changed) paint();
    if (stopPulse === null) {
      stopPulse = opts.every(PULSE_MS / 2, () => {
        bright = !bright;
        paint();
      });
    }
  };
  // The glint's state on every request, after the badge's work: on while
  // something works and nobody wants you, by the same capped count as the
  // bar, off otherwise.
  const glint = (working: number, count: number) => {
    glintWorking = working;
    const on = working > 0 && count === 0;
    if (on === glintOn) return;
    glintOn = on;
    if (on) {
      if (opts.reducedMotion()) {
        opts.log('taskbar glint still: reduced motion');
        return;
      }
      glintStart = opts.now();
      glintShown = 0;
      glintTick();
      return;
    }
    stopGlint();
    // At a want the badge's paint has already replaced the overlay in this
    // same request; a clear here would take the badge off.
    if (count === 0 && glintShown !== 0) {
      getWindow()?.setGlint(null, '');
    }
    glintShown = 0;
  };

  return {
    set(req) {
      if (typeof req.wanting !== 'number' || !Number.isFinite(req.wanting) || req.wanting < 0) return;
      const count = Math.floor(req.wanting);
      const flash = req.flash === true && count > 0;
      const changed = count !== wanting;
      wanting = count;
      const live = countOf(req.live);
      const working = Math.min(countOf(req.working), live);
      const bar = taskbarProgress(working, live);
      const tooltip = taskbarTooltip(working, count);
      if (opts.held) {
        // The prefix is not the badge's, so a read of the badge's lines
        // never matches a progress line (M9 fix 870).
        const line = `taskbar progress held under a private EMERALD_HOME: ${working} of ${live} working, bar ${bar === null ? 'cleared' : `${Math.round(bar * 100)}%`}, tooltip ${JSON.stringify(tooltip)}`;
        if (line !== lastProgressLine) {
          lastProgressLine = line;
          opts.log(line);
        }
        // One line per change, so a script reads the rise, the count and
        // the clear, and a repeated push says nothing.
        if (count === 0 && changed) opts.log('taskbar held under a private EMERALD_HOME: cleared');
        else if (count > 0 && (changed || flash)) opts.log(`taskbar held under a private EMERALD_HOME: ${count} wanting, ${flash ? 'flash' : 'no flash'}`);
        // M9 fix 1200: the glint's on and off, a line per change under a
        // prefix of its own so the badge's and the bar's reads never match
        // it; no timer, no window, no reduced-motion read. A held Mac
        // writes none.
        if (opts.windows) {
          const on = working > 0 && count === 0;
          if (on !== glintOn) {
            glintOn = on;
            opts.log(`taskbar glint held under a private EMERALD_HOME: ${on ? 'on' : 'off'}`);
          }
        }
        return;
      }
      const win = getWindow();
      if (win === null) return;
      if (opts.windows) {
        if (bar !== lastBar) {
          lastBar = bar;
          win.setProgress(bar);
        }
        if (tooltip !== lastTooltip) {
          lastTooltip = tooltip;
          win.setTooltip(tooltip);
        }
      }
      badge(win, count, changed, flash);
      if (opts.windows) glint(working, count);
    },
    dispose() {
      stop();
      stopGlint();
      glintOn = false;
      glintShown = 0;
      glintWorking = 0;
      wanting = 0;
      lastBar = null;
      lastTooltip = undefined;
      lastProgressLine = undefined;
    },
    pulsing: () => stopPulse !== null,
  };
}

const SIZE = 16;
export type BadgeColour = { r: number; g: number; b: number };
// Classic's needs-you amber, the badge's disc by default.
export const BADGE_AMBER: BadgeColour = { r: 0xe8, g: 0xa3, b: 0x3d };
// Emerald's needs-you gold, its --blocked (M9 fix 569).
export const BADGE_GOLD: BadgeColour = { r: 0xe8, g: 0xb9, b: 0x49 };
// The ink the count is drawn in, on either disc.
const INK = { r: 0x20, g: 0x20, b: 0x20 };

export function badgeColour(skin: Skin): BadgeColour {
  return skin === 'emerald' ? BADGE_GOLD : BADGE_AMBER;
}

// A 16px disc in the skin's needs-you colour with the count in a 3x5 pixel digit or two, drawn
// straight into a BGRA buffer: the main process has no canvas, and a
// badge this small wants no anti-aliasing to read at the taskbar's size.
// The dim frame is the same disc at half alpha; Windows composes the
// overlay over the app icon, so the swap reads as breathing.
export const BADGE_SIZE = SIZE;
export function drawBadge(count: number, isBright: boolean, colour: BadgeColour = BADGE_AMBER): Buffer {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const alpha = isBright ? 255 : 128;
  const centre = (SIZE - 1) / 2;
  const radius = SIZE / 2 - 0.5;
  const put = (x: number, y: number, c: { r: number; g: number; b: number }) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const at = (y * SIZE + x) * 4;
    // Premultiplied BGRA, which is what createFromBitmap reads.
    buf[at] = Math.round((c.b * alpha) / 255);
    buf[at + 1] = Math.round((c.g * alpha) / 255);
    buf[at + 2] = Math.round((c.r * alpha) / 255);
    buf[at + 3] = alpha;
  };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = x - centre;
      const dy = y - centre;
      if (dx * dx + dy * dy <= radius * radius) put(x, y, colour);
    }
  }
  const text = count > 99 ? '99' : String(count);
  const width = text.length * 3 + (text.length - 1);
  let x0 = Math.round(centre - width / 2 + 0.5);
  const y0 = Math.round(centre - 2);
  for (const ch of text) {
    const rows = DIGITS[ch] ?? DIGITS['0']!;
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < 3; dx += 1) if (row[dx] === '#') put(x0 + dx, y0 + dy, INK);
    });
    x0 += 4;
  }
  return buf;
}

// The glint's frames (M9 fix 1200, board A1-sparkle): a plus-shaped
// sparkle on a clear ground, centred on overlay pixel (5,9), which Windows
// places over the icon's upper right facet. Each pixel is [dx, dy, alpha]
// from the centre; frames 4 and 5 are 2 and 1 again, and 0 is the rest,
// no overlay at all, so the button shows the shipped icon between sweeps.
const GLINT_CENTRE = { x: 5, y: 9 };
const GLINT_PIXELS: Record<1 | 2 | 3, readonly (readonly [number, number, number])[]> = {
  1: [[0, 0, 0.55]],
  2: [[0, 0, 1], [1, 0, 0.5], [-1, 0, 0.5], [0, 1, 0.5], [0, -1, 0.5]],
  3: [[0, 0, 1], [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [2, 0, 0.45], [-2, 0, 0.45], [0, 2, 0.45], [0, -2, 0.45]],
};
// The title gem's GLINT_FILL (title-gem-model.ts), written out here since
// that file reaches the renderer's skin and the DOM, which the main
// process's project refuses (TS6307); the unit test holds the two equal.
export const TASKBAR_GLINT_FILL = '#eafff4';
const glintFill = ((hex: string): BadgeColour => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
}))(TASKBAR_GLINT_FILL);

export function drawGlint(frame: GlintFrame): Buffer | null {
  if (frame === 0) return null;
  const pixels = GLINT_PIXELS[frame === 4 ? 2 : frame === 5 ? 1 : frame];
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (const [dx, dy, a] of pixels) {
    const alpha = Math.round(a * 255);
    const at = ((GLINT_CENTRE.y + dy) * SIZE + GLINT_CENTRE.x + dx) * 4;
    // Premultiplied BGRA, as drawBadge's put writes it.
    buf[at] = Math.round((glintFill.b * alpha) / 255);
    buf[at + 1] = Math.round((glintFill.g * alpha) / 255);
    buf[at + 2] = Math.round((glintFill.r * alpha) / 255);
    buf[at + 3] = alpha;
  }
  return buf;
}

const DIGITS: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
};
