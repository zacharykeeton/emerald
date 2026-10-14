// Writes build/icon.ico: the flush gem, full size, on a dark rounded square
// (5f, M9 fix 596, in place of fix 571's 5g), as a PNG-compressed ICO of
// five images, 16, 24, 32, 48 and 256 (Vista and later read those). 24 and
// up are the 256 drawing scaled with 4 by 4 samples a pixel; 16 is the 256
// drawing point-sampled at each pixel centre, hard edges but for the
// square's corners. Hand-rolled so the repo needs no image tooling; the
// output is committed and this only reruns when the look changes. Importing
// it writes nothing (app-icon.test.ts reads the drawing against the
// committed file). Run: node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const ICON_SIZES = [16, 24, 32, 48, 256];

const GROUND = [0x1a, 0x1f, 0x1d];

// The flush gem of the handoff's 8.1, in 256-space: facet i is the quad
// IO[i], IO[i+1], IT[i+1], IT[i], in paint order, then the table.
const IO = [[104, 40], [152, 40], [196, 84], [196, 172], [152, 216], [104, 216], [60, 172], [60, 84]];
const IT = [[116, 84], [140, 84], [158, 102], [158, 154], [140, 172], [116, 172], [98, 154], [98, 102]];
const FACET_FILLS = ['57d99c', '3cc184', '22905c', '176a44', '1c7f51', '259a63', '45c98c', '9ff2c8'];
const GEM_SHAPES = [
  ...FACET_FILLS.map((fill, i) => ({
    points: [IO[i], IO[(i + 1) % 8], IT[(i + 1) % 8], IT[i]],
    colour: hex(fill),
  })),
  { points: IT, colour: hex('2fb67a') },
];

function hex(s) {
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Rounded square of side `side`: inside when within the inner rectangle or a
// corner circle.
function inSquare(x, y, side, radius) {
  const cx = Math.min(Math.max(x, radius), side - radius);
  const cy = Math.min(Math.max(y, radius), side - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function segDist2(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - px;
  const ey = a[1] + t * dy - py;
  return ex * ex + ey * ey;
}

function outlineDist2(px, py, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = segDist2(px, py, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

// Even-odd ray cast; a point on an edge counts as inside.
function inPolygon(px, py, poly) {
  if (outlineDist2(px, py, poly) <= 1e-12) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// One sample of the 256 drawing, in canvas space: the topmost layer's colour,
// or null outside the rounded square.
function sample256(x, y) {
  if (!inSquare(x, y, 256, 48)) return null;
  // The gem in its own space, through the inverse of translate(128 128)
  // scale(1.32) translate(-128 -128): 5f, full size, so the stone fills about
  // 232 of 256; the width-3 round stroke that makes it flush is the 1.5-unit
  // distance test, which scales with the gem.
  const S = 1.32;
  const gx = (x - 128) / S + 128;
  const gy = (y - 128) / S + 128;
  for (let k = GEM_SHAPES.length - 1; k >= 0; k--) {
    const s = GEM_SHAPES[k];
    if (inPolygon(gx, gy, s.points) || outlineDist2(gx, gy, s.points) <= 2.25) return s.colour;
  }
  return GROUND;
}

function draw16() {
  const size = 16;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          if (inSquare(x + (i + 0.5) / 4, y + (j + 0.5) / 4, 16, 3)) covered++;
        }
      }
      if (covered === 0) continue;
      // The 256 drawing point-sampled at the pixel's centre, no averaging, so
      // the facets keep their shades with hard edges (5f; a flat two-tone
      // octagon read as a pill). A centre outside the 256 square's corner is
      // ground; the alpha above already makes that pixel clear.
      const c = sample256((x + 0.5) * 16, (y + 0.5) * 16) ?? GROUND;
      const o = (y * size + x) * 4;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = Math.round((covered * 255) / 16);
    }
  }
  return px;
}

function drawScaled(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = 256 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let covered = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const c = sample256((x + (i + 0.5) / 4) * k, (y + (j + 0.5) / 4) * k);
          if (c === null) continue;
          covered++;
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      if (covered === 0) continue;
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / covered);
      px[o + 1] = Math.round(g / covered);
      px[o + 2] = Math.round(b / covered);
      px[o + 3] = Math.round((covered * 255) / 16);
    }
  }
  return px;
}

export function drawIcon(size) {
  return size === 16 ? draw16() : drawScaled(size);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngOf(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function icoOf(images) {
  const ordered = [...images].sort((a, b) => ICON_SIZES.indexOf(a.size) - ICON_SIZES.indexOf(b.size));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(ordered.length, 4);
  const entries = [];
  let offset = 6 + 16 * ordered.length;
  for (const { size, png } of ordered) {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size; // 256 px is written as 0
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0; // no palette
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...ordered.map((i) => i.png)]);
}

export function readIco(buf) {
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let n = 0; n < count; n++) {
    const e = 6 + 16 * n;
    const bytes = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    const img = buf.subarray(offset, offset + bytes);
    const isPng = img.length >= 24 && img.subarray(0, 8).equals(PNG_SIGNATURE);
    out.push({
      width: buf[e] === 0 ? 256 : buf[e],
      height: buf[e + 1] === 0 ? 256 : buf[e + 1],
      planes: buf.readUInt16LE(e + 4),
      bpp: buf.readUInt16LE(e + 6),
      bytes,
      offset,
      pngWidth: isPng ? img.readUInt32BE(16) : null,
      pngHeight: isPng ? img.readUInt32BE(20) : null,
    });
  }
  return out;
}

function main() {
  const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.ico');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, icoOf(ICON_SIZES.map((size) => ({ size, png: pngOf(drawIcon(size), size) }))));
  console.log(`wrote ${out}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
