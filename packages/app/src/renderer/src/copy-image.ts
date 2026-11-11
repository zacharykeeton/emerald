import { copyImageRoute, pickCopySize } from './copy-image-model.ts';

// Copy image (M9 fix 1111). PNG and JPEG go to main, which decodes them
// itself (fix 1007). The other kinds are drawn here from a data: URL main
// reads (the page's CSP allows data:, not blob:, and a data: picture never
// taints the canvas), or, for a paused GIF or WebP, from the frame shown.
export interface CopyShown {
  frame: HTMLCanvasElement | null;
  box: { w: number; h: number } | null;
}

export async function copyImage(path: string, shown: CopyShown | null): Promise<boolean> {
  if (copyImageRoute(path) === 'main') return window.emerald.clipboard.writeImageFile(path);

  const frame = shown?.frame ?? null;
  if (frame !== null && frame.width > 0) {
    try {
      const url = frame.toDataURL('image/png');
      await window.emerald.clipboard.writeImage(url);
      return true;
    } catch (err) {
      // The dev server's http page: the file: picture taints the canvas.
      console.warn('[emerald] copy image: the paused frame cannot be read here, copying the first frame', err);
    }
  }

  const read = await window.emerald.clipboard.imageData(path);
  if (read === null) return false;
  const img = new Image();
  img.src = read.dataUrl;
  try {
    await img.decode();
  } catch {
    return false;
  }
  const size = pickCopySize(read.size, /\.svg$/i.test(path) ? (shown?.box ?? null) : null, { w: img.naturalWidth, h: img.naturalHeight });
  if (size === null) return false;
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return false;
  ctx.drawImage(img, 0, 0, size.w, size.h);
  let url: string;
  try {
    url = canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[emerald] copy image: the canvas would not give its picture', err);
    return false;
  }
  await window.emerald.clipboard.writeImage(url);
  return true;
}
