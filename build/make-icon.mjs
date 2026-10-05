// Draws the Toolbox icon at every size Windows asks for and packs them into a
// single .ico. No image library: every pixel is sampled 5x5, each sample is
// painted back to front (plate, then the four tiles), and the samples are
// averaged. Written as PNG with node's own zlib.
//
// Monochrome by request: near-black plate, grey tiles.
//
//   node build/make-icon.mjs build/icon.ico [preview-prefix]
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- palette ---------- */
const PLATE_TOP = hex('#2b2b30'), PLATE_BOT = hex('#111113'), RIM = hex('#4a4a52');

/* ---------- the mark: four tiles, one per tool, lit from the top left ----------
   Chosen by Davide on 29 September 2026 from four options (grid, hex nut,
   stacked cards, cut-corner frame); he did not want a toolbox drawing. */
const TILE = 0.245, RADIUS = 0.06;
const TILES = [
  [-1, -1, '#f4f4f6', '#d6d6dc'],
  [ 1, -1, '#a4a4ad', '#86868f'],
  [-1,  1, '#a4a4ad', '#86868f'],
  [ 1,  1, '#5f5f68', '#4a4a52']
];

/* signed distance to a rounded box centred on cx, cy; negative inside */
function sdRound(px, py, cx, cy, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const qx = Math.abs(px - cx) - w / 2 + r, qy = Math.abs(py - cy) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function shade(u, v, size) {
  const dp = sdRound(u, v, 0.5, 0.5, 1, 1, 0.225);
  if (dp > 0) return null;
  let c = mix(PLATE_TOP, PLATE_BOT, v);
  /* a thin light rim along the top, only where there are pixels for it */
  if (size >= 48 && dp > -0.012) c = mix(c, RIM, clamp(1 - v * 1.8, 0, 1) * 0.9);
  /* wider gaps at small sizes, or the four tiles merge into one blob */
  const gap = size < 32 ? 0.07 : 0.055, o = (TILE + gap) / 2;
  for (const [sx, sy, top, bot] of TILES) {
    const cx = 0.5 + sx * o, cy = 0.5 + sy * o;
    if (sdRound(u, v, cx, cy, TILE, TILE, RADIUS) <= 0)
      return mix(hex(top), hex(bot), clamp((v - (cy - TILE / 2)) / TILE, 0, 1));
  }
  return c;
}

function render(size) {
  const ss = 5, px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, size);
      if (!c) continue;
      r += c[0]; g += c[1]; b += c[2]; a++;
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = Math.round(a / (ss * ss) * 255);
  }
  return px;
}

/* ---------- PNG ---------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- ICO ---------- */
const sizes = [256, 128, 64, 48, 32, 24, 16];
const images = sizes.map(s => ({ s, png: png(s, render(s)) }));
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
const dir = Buffer.alloc(16 * images.length);
let offset = 6 + dir.length;
images.forEach((img, i) => {
  const o = i * 16;
  dir[o] = img.s === 256 ? 0 : img.s; dir[o + 1] = img.s === 256 ? 0 : img.s;
  dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(img.png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
  offset += img.png.length;
});
writeFileSync(process.argv[2], Buffer.concat([header, dir, ...images.map(i => i.png)]));
if (process.argv[3]) for (const img of images) writeFileSync(process.argv[3] + '-' + img.s + '.png', img.png);
console.log('wrote ' + process.argv[2] + '  ' + sizes.join('/'));
