// make-icons.mjs - draws the menu bar icon frames as black-on-transparent PNGs (macOS
// "template" images, so they turn white in a dark menu bar). Run once; the PNGs are committed.
//   idle: speech bubble outline         working-0..3: three dots lighting up in turn
//   waiting-0..1: filled / outline (slow blink)   alert: bubble with "!"
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'app', 'icons');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, alphaAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = raw[i + 1] = raw[i + 2] = 0; raw[i + 3] = Math.round(255 * alphaAt(x, y));
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shapes in a 0..1 unit box. Each returns true if the point is "ink".
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const bubble = (x, y) => roundRect(x, y, 0.08, 0.14, 0.92, 0.72, 0.16)
  || (y >= 0.70 && y <= 0.90 && x >= 0.24 && x <= 0.42 && x - 0.24 <= (0.90 - y) * 0.9); // tail
const bubbleInner = (x, y) => roundRect(x, y, 0.16, 0.22, 0.84, 0.64, 0.09);
const outline = (x, y) => bubble(x, y) && !bubbleInner(x, y);
const dot = (x, y, cx) => (x - cx) ** 2 + (y - 0.43) ** 2 <= 0.075 ** 2;
const DOTS = [0.32, 0.5, 0.68];
const bang = (x, y) => (x >= 0.45 && x <= 0.55 && y >= 0.28 && y <= 0.48) || (x - 0.5) ** 2 + (y - 0.56) ** 2 <= 0.05 ** 2;

const FRAMES = {
  idle: (x, y) => outline(x, y),
  'working-0': (x, y) => outline(x, y) || dot(x, y, DOTS[0]),
  'working-1': (x, y) => outline(x, y) || dot(x, y, DOTS[1]),
  'working-2': (x, y) => outline(x, y) || dot(x, y, DOTS[2]),
  'working-3': (x, y) => outline(x, y) || DOTS.some((c) => dot(x, y, c)),
  'waiting-0': (x, y) => bubble(x, y) && !bang(x, y),
  'waiting-1': (x, y) => outline(x, y) || bang(x, y),
  alert: (x, y) => outline(x, y) || bang(x, y),
};

function render(fn, size, ss = 4) {
  return png(size, (px, py) => {
    let hit = 0;
    for (let i = 0; i < ss; i++) for (let j = 0; j < ss; j++) if (fn((px + (i + 0.5) / ss) / size, (py + (j + 0.5) / ss) / size)) hit++;
    return hit / (ss * ss);
  });
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, fn] of Object.entries(FRAMES)) {
  fs.writeFileSync(path.join(OUT, `${name}Template.png`), render(fn, 18));
  fs.writeFileSync(path.join(OUT, `${name}Template@2x.png`), render(fn, 36));
}
console.log(`Wrote ${Object.keys(FRAMES).length * 2} icon files to ${OUT}`);
