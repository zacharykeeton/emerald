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
// taskbar (fix 47, fix 49's shape).

export type TaskbarLog = (msg: string) => void;

// The sidebar's needs-pulse is 1.6s; the badge swaps frames twice a beat.
export const PULSE_MS = 1600;

// The window as the policy sees it: the flash, and the overlay as a count
// and a frame (null takes the badge off).
export interface TaskbarWindow {
  flashFrame(on: boolean): void;
  setOverlay(count: number | null, bright: boolean): void;
}

export function createTaskbarPolicy(
  getWindow: () => TaskbarWindow | null,
  opts: { held: boolean; windows: boolean; log: TaskbarLog; every: (ms: number, fn: () => void) => () => void },
): { set(req: AttentionRequest): void; dispose(): void; pulsing(): boolean } {
  let wanting = 0;
  let bright = true;
  let stopPulse: (() => void) | null = null;

  const paint = () => {
    const win = getWindow();
    if (win === null) return;
    win.setOverlay(wanting === 0 ? null : wanting, bright);
  };
  const stop = () => {
    if (stopPulse !== null) stopPulse();
    stopPulse = null;
  };

  return {
    set(req) {
      if (typeof req.wanting !== 'number' || !Number.isFinite(req.wanting) || req.wanting < 0) return;
      const count = Math.floor(req.wanting);
      const flash = req.flash === true && count > 0;
      const changed = count !== wanting;
      wanting = count;
      if (opts.held) {
        // One line per change, so a script reads the rise, the count and
        // the clear, and a repeated push says nothing.
        if (count === 0 && changed) opts.log('taskbar held under a private EMERALD_HOME: cleared');
        else if (count > 0 && (changed || flash)) opts.log(`taskbar held under a private EMERALD_HOME: ${count} wanting, ${flash ? 'flash' : 'no flash'}`);
        return;
      }
      const win = getWindow();
      if (win === null) return;
      if (count === 0) {
        if (!changed) return;
        stop();
        win.flashFrame(false);
        if (opts.windows) paint();
        return;
      }
      if (flash) win.flashFrame(true);
      if (!opts.windows) return;
      if (changed) paint();
      if (stopPulse === null) {
        stopPulse = opts.every(PULSE_MS / 2, () => {
          bright = !bright;
          paint();
        });
      }
    },
    dispose() {
      stop();
      wanting = 0;
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
