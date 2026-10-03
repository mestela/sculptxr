// Writes public/icons/icon-{192,512}.png (+ maskable) with no image deps: a shaded clay sphere on dark.
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };

function png(size, maskable) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const R = size * (maskable ? 0.3 : 0.36);          // maskable keeps the sphere inside the 80% safe zone
  const cx = size / 2, cy = size / 2, corner = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      let r = 30, g = 30, b = 46, a = 255;           // #1e1e2e
      const dx = Math.max(Math.abs(x + .5 - cx) - (cx - corner), 0), dy = Math.max(Math.abs(y + .5 - cy) - (cy - corner), 0);
      if (corner && Math.hypot(dx, dy) > corner) a = 0;
      const px = (x + .5 - cx) / R, py = (y + .5 - cy) / R, d2 = px * px + py * py;
      if (d2 < 1) {                                  // lambert sphere, light from upper-left
        const nz = Math.sqrt(1 - d2), l = Math.max(0, (-px * .5 - py * .5 + nz * .7)) * .85 + .15;
        r = 137 * l | 0; g = 180 * l | 0; b = 250 * l | 0;   // #89b4fa
      }
      raw.set([r, g, b, a], i);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s, false));
writeFileSync('public/icons/icon-maskable-512.png', png(512, true));
