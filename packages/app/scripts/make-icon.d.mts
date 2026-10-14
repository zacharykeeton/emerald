// Typings for make-icon.mjs's exports (M9 fix 571), so app-icon.test.ts
// under src/main can import the script under tsconfig.node.json.
export const ICON_SIZES: number[];
export function drawIcon(size: number): Buffer;
export function pngOf(rgba: Buffer, size: number): Buffer;
export function icoOf(images: { size: number; png: Buffer }[]): Buffer;
export interface IcoEntry {
  width: number;
  height: number;
  planes: number;
  bpp: number;
  bytes: number;
  offset: number;
  pngWidth: number | null;
  pngHeight: number | null;
}
export function readIco(buf: Buffer): IcoEntry[];
