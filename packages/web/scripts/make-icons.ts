/**
 * Writes the PWA icons to public/: a Highlight-gold (#ffd166) five-point star on Midnight (#1b1b25).
 * Pure Node (zlib PNG encoder, 4×4 supersampled), so no image tooling is needed.
 * Run: npm run gen:icons -w packages/web
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x1b, 0x1b, 0x25];
const FG = [0xff, 0xd1, 0x66];

/** Star polygon centred in a unit square; `r` = outer radius as a fraction of the side. */
function star(r: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([0.5 + rad * Math.cos(a), 0.53 + rad * Math.sin(a)]);
  }
  return pts;
}

function inside(x: number, y: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size: number, starRadius: number): Buffer {
  const poly = star(starRadius);
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (inside((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, poly)) cover++;
        }
      }
      const t = cover / (SS * SS);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c]! + (FG[c]! - BG[c]!) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/', import.meta.url);
// "any" icons: star fills most of the tile. Maskable: star inside the 80% safe zone.
writeFileSync(new URL('icon-192.png', out), png(192, 0.4));
writeFileSync(new URL('icon-512.png', out), png(512, 0.4));
writeFileSync(new URL('icon-maskable-512.png', out), png(512, 0.3));
writeFileSync(new URL('apple-touch-icon.png', out), png(180, 0.34));

const pts = star(0.4).map(([x, y]) => `${(x * 64).toFixed(2)},${(y * 64).toFixed(2)}`).join(' ');
writeFileSync(new URL('favicon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1b25"/><polygon points="${pts}" fill="#ffd166"/></svg>\n`);
console.log('icons written to public/');
