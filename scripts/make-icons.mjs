// Generates the PWA icons with no dependencies and no network access.
// A ledger slip on a deep green ground, with greenbar bands.
//
//   npm run icons
//
// Rendered at 2x and box-downsampled, which is enough antialiasing for a
// shape this simple.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const GROUND = [0x1b, 0x4d, 0x33];
const PAPER = [0xfb, 0xfc, 0xf9];
const BAND = [0xd3, 0xe6, 0xda];

// ---------------------------------------------------------------- png

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10..12 stay zero: deflate, adaptive filtering, no interlace

  // Each scanline is prefixed with its filter type (0 = none).
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- drawing

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour of the icon at a point, in a 0..1 unit square. */
function sample(u, v) {
  // The slip.
  const [sx0, sy0, sx1, sy1] = [0.24, 0.17, 0.76, 0.83];
  if (!inRoundedRect(u, v, sx0, sy0, sx1, sy1, 0.05)) return GROUND;

  // Four bands down the slip, inset from its edges.
  const [bx0, bx1] = [sx0 + 0.07, sx1 - 0.07];
  if (u < bx0 || u > bx1) return PAPER;

  const top = sy0 + 0.1;
  const pitch = 0.115;
  const thickness = 0.058;
  for (let i = 0; i < 4; i++) {
    const y = top + i * pitch;
    // The last band is short, the way a total sits under a column of items.
    const right = i === 3 ? bx0 + (bx1 - bx0) * 0.55 : bx1;
    if (v >= y && v <= y + thickness && u <= right) return BAND;
  }
  return PAPER;
}

function render(size) {
  const ss = 2; // supersample factor
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 3;
      buf[i] = Math.round(acc[0] / n);
      buf[i + 1] = Math.round(acc[1] / n);
      buf[i + 2] = Math.round(acc[2] / n);
    }
  }
  return encodePng(size, buf);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT, name), render(size));
  console.log(`public/${name}  ${size}x${size}`);
}
