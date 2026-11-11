// Copy image for the kinds main cannot decode (M9 fix 1111). Fix 1007's
// probe found that nativeImage.createFromPath returns an empty image for
// GIF, WebP, BMP and SVG, and decodes an ICO at 256 by 256 whatever its
// entries. Main reads such a file as a data: URL for the renderer to draw
// on a canvas, and works out the size the file itself declares. Pure, so a
// test needs no electron.

export const CANVAS_COPY_IMAGE = /\.(gif|webp|bmp|ico|svg)$/i;

export interface ImageSize {
  w: number;
  h: number;
}

export function imageMime(file: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  switch (ext) {
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

const LENGTH = /^\s*(\d*\.?\d+)\s*(px)?\s*$/i;

// A width or height attribute counts only when it is a plain positive
// number (unitless or px); a percentage or another unit counts as absent.
function lengthAttr(tag: string, name: string): number | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const raw = m?.[1] ?? m?.[2];
  if (raw === undefined) return null;
  const n = LENGTH.exec(raw);
  if (n === null) return null;
  const v = Number(n[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function viewBoxOf(tag: string): ImageSize | null {
  const m = /\sviewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  const raw = m?.[1] ?? m?.[2];
  if (raw === undefined) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !parts.every((p) => Number.isFinite(p))) return null;
  const w = parts[2]!;
  const h = parts[3]!;
  return w > 0 && h > 0 ? { w, h } : null;
}

export function svgSize(text: string): ImageSize | null {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const tag = /<svg\b[^>]*>/i.exec(body)?.[0];
  if (tag === undefined) return null;
  const w = lengthAttr(tag, 'width');
  const h = lengthAttr(tag, 'height');
  const vb = viewBoxOf(tag);
  if (w !== null && h !== null) return { w, h };
  if (vb === null) return null;
  if (w !== null) return { w, h: (w * vb.h) / vb.w };
  if (h !== null) return { w: (h * vb.w) / vb.h, h };
  return vb;
}

export function icoSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 6) return null;
  const word = (at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
  if (word(0) !== 0 || word(2) !== 1) return null;
  const count = word(4);
  if (count < 1 || bytes.length < 6 + 16 * count) return null;
  let best: ImageSize | null = null;
  for (let i = 0; i < count; i++) {
    const w = bytes[6 + 16 * i]! || 256;
    const h = bytes[7 + 16 * i]! || 256;
    if (best === null || w * h > best.w * best.h) best = { w, h };
  }
  return best;
}

export function declaredImageSize(file: string, bytes: Uint8Array): ImageSize | null {
  if (/\.svg$/i.test(file)) return svgSize(new TextDecoder().decode(bytes));
  if (/\.ico$/i.test(file)) return icoSize(bytes);
  return null;
}
