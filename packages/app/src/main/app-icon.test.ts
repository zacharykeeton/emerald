import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ICON_SIZES, drawIcon, readIco } from '../../scripts/make-icon.mjs';

// The app's icon (M9 fix 571, handoff 8.2): the committed build/icon.ico
// holds the five gem images, each the drawing of the committed script byte
// for byte, so the file was regenerated from the script that is checked in.
// Redrawn as 5f, the gem at full size with no sparkle, by M9 fix 596; the
// dark rounded square under it went on 2026-10-14, so the ground is clear.
const icoPath = path.resolve(import.meta.dirname, '..', '..', 'build', 'icon.ico');
const ico = fs.readFileSync(icoPath);

// The RGBA rows of one PNG as make-icon.mjs writes it: the IDAT chunks
// joined and inflated, every row's filter byte 0.
function decodePng(png: Buffer, size: number): Buffer {
  const idat: Buffer[] = [];
  let at = 8;
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('ascii');
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = size * 4 + 1;
  assert.equal(raw.length, size * stride, `the ${size} image's rows`);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    assert.equal(raw[y * stride], 0, `the ${size} image's row ${y} filter`);
    raw.copy(out, y * size * 4, y * stride + 1, (y + 1) * stride);
  }
  return out;
}

// Each size drawn once for the whole file: a drawing is most of the suite's time.
const drawn = new Map<number, Buffer>();

function pixel(size: number, x: number, y: number): string {
  let px = drawn.get(size);
  if (px === undefined) {
    px = drawIcon(size);
    drawn.set(size, px);
  }
  const o = (y * size + x) * 4;
  return [...px.subarray(o, o + 4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

test('icon.ico holds five PNG images, 16, 24, 32, 48 and 256, contiguous from 86', () => {
  const entries = readIco(ico);
  assert.deepEqual(
    entries.map((e) => e.width),
    [16, 24, 32, 48, 256],
  );
  assert.deepEqual(ICON_SIZES, [16, 24, 32, 48, 256]);
  let offset = 6 + 16 * 5;
  for (const e of entries) {
    assert.equal(e.height, e.width);
    assert.equal(e.planes, 1);
    assert.equal(e.bpp, 32);
    assert.equal(e.offset, offset, `the ${e.width} image's offset`);
    assert.equal(e.pngWidth, e.width, `the ${e.width} image is a PNG of its size`);
    assert.equal(e.pngHeight, e.height);
    offset += e.bytes;
  }
  assert.equal(offset, ico.length, 'the last image ends at the end of the file');
});

test('each committed image is drawIcon of its size, byte for byte', () => {
  for (const e of readIco(ico)) {
    const png = ico.subarray(e.offset, e.offset + e.bytes);
    assert.ok(decodePng(png, e.width).equals(drawIcon(e.width)), `the ${e.width} image matches the script`);
  }
});

test('drawIcon at 16 is the 256 drawing point-sampled, on a clear ground', () => {
  assert.equal(pixel(16, 7, 7), '2fb67aff', 'the table');
  assert.equal(pixel(16, 7, 2), '57d99cff', 'facet 0');
  assert.equal(pixel(16, 3, 7), '45c98cff', 'facet 6');
  assert.equal(pixel(16, 7, 13), '1c7f51ff', 'facet 4');
  assert.equal(pixel(16, 0, 8).slice(6), '00', 'clear beside the stone');
  assert.equal(pixel(16, 13, 1).slice(6), '00', 'clear above the shoulder');
  assert.equal(pixel(16, 0, 0).slice(6), '00', 'clear at the corner');
  const edge = drawIcon(16)[(0 * 16 + 7) * 4 + 3]!;
  assert.ok(edge > 0 && edge < 255, `the soft outline at the top, alpha ${edge}`);
  assert.equal(pixel(16, 7, 0).slice(0, 6), '57d99c', 'the outline pixel takes the facet beside it');
});

test('drawIcon at 256 is the flush gem, full size, on a clear ground', () => {
  assert.equal(pixel(256, 128, 128), '2fb67aff', "the table at the gem's centre");
  assert.equal(pixel(256, 128, 41), '57d99cff', 'facet 0 near the top');
  assert.equal(pixel(256, 128, 6).slice(6), '00', 'clear above the gem');
  assert.equal(pixel(256, 128, 250).slice(6), '00', 'clear below the gem');
  assert.equal(pixel(256, 0, 0).slice(6), '00', 'clear at the corner');
  assert.equal(pixel(256, 8, 128).slice(6), '00', 'clear beside the gem');
});
