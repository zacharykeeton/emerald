// The pure part of Copy image's canvas route (M9 fix 1111): which route a
// path takes, and the size its PNG is drawn at.

export interface Size {
  w: number;
  h: number;
}

// px, a canvas's long side; Chromium's canvas fails past about 32767, and an
// SVG can declare any width.
export const COPY_IMAGE_MAX_SIDE = 8192;

// Main decodes PNG and JPEG itself; every other picture kind is drawn by
// the renderer from a data: URL main reads for it.
export function copyImageRoute(path: string): 'main' | 'canvas' {
  return /\.(png|jpe?g)$/i.test(path) ? 'main' : 'canvas';
}

const usable = (s: Size | null): s is Size => s !== null && Number.isFinite(s.w) && Number.isFinite(s.h) && s.w > 0 && s.h > 0;

// The first of the declared size, the size the view shows and the decoded
// natural size that holds, capped at COPY_IMAGE_MAX_SIDE on its long side.
export function pickCopySize(declared: Size | null, box: Size | null, natural: Size): Size | null {
  const s = [declared, box, natural].find(usable);
  if (s === undefined) return null;
  const scale = Math.min(1, COPY_IMAGE_MAX_SIDE / Math.max(s.w, s.h));
  return { w: Math.max(1, Math.round(s.w * scale)), h: Math.max(1, Math.round(s.h * scale)) };
}
