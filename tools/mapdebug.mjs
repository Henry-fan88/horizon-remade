// Renders a top-down debug image of the generated world: node tools/mapdebug.mjs
import { generateWorld } from '../src/world/worldgen.js';
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const w = generateWorld({}, (p, msg) => {});
console.log('gen ms', w.genTime.toFixed(0), 'roads', w.roads.length, Object.fromEntries(Object.entries(w.veg).map(([k, v]) => [k, v.length / 5])));
const S = 1025, OUT = 1024;
const img = Buffer.alloc(OUT * OUT * 3);
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  const i = y * S + x;
  const h = w.heights[i];
  let r = w.colors[i * 4], g = w.colors[i * 4 + 1], b = w.colors[i * 4 + 2];
  // hillshade
  const hl = w.heights[i + (x < 1023 ? 1 : 0)] - h, hd = w.heights[i + (y < 1023 ? S : 0)] - h;
  const shade = Math.max(0.35, Math.min(1.3, 1 - (hl * 0.8 + hd * 0.5) * 0.08));
  r *= shade; g *= shade; b *= shade;
  if (h < 0) { const t = Math.min(1, -h / 6); r = r * (1 - t) * 0.5 + 20 * t; g = g * (1 - t) * 0.6 + 90 * t + 40; b = b * (1 - t) * 0.6 + 140 * t + 60; }
  const o = (y * OUT + x) * 3;
  img[o] = Math.min(255, r); img[o + 1] = Math.min(255, g); img[o + 2] = Math.min(255, b);
}
const plot = (x, z, c, rad = 1) => {
  const px = Math.round((x + 2048) / 4), py = Math.round((z + 2048) / 4);
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= OUT || Y >= OUT) continue;
    const o = (Y * OUT + X) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
  }
};
for (const k of ['broadleaf', 'pine', 'palm', 'birch']) { const v = w.veg[k]; for (let i = 0; i < v.length; i += 5) plot(v[i], v[i + 2], k === 'pine' ? [20, 60, 30] : k === 'palm' ? [60, 110, 40] : [30, 80, 25], 0); }
const cols = { road: [255, 255, 255], highway: [255, 220, 60], dirt: [200, 140, 80], street: [220, 220, 255], runway: [60, 60, 60] };
for (const r of w.roads) { const p = r.pts; for (let i = 0; i < p.length; i += 3) plot(p[i], p[i + 2], cols[r.kind], r.kind === 'highway' ? 1 : 0); }
const P = w.props;
for (let i = 0; i < P.turbines.length; i += 3) plot(P.turbines[i], P.turbines[i + 2], [255, 0, 255], 3);
for (let i = 0; i < P.boards.length; i += 4) plot(P.boards[i], P.boards[i + 2], [255, 140, 0], 2);
for (let i = 0; i < P.rails.length; i += 6) plot(P.rails[i], P.rails[i + 2], [255, 60, 60], 0);
// PNG encode
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const raw = Buffer.alloc(OUT * (OUT * 3 + 1));
for (let y = 0; y < OUT; y++) { raw[y * (OUT * 3 + 1)] = 0; img.copy(raw, y * (OUT * 3 + 1) + 1, y * OUT * 3, (y + 1) * OUT * 3); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(OUT, 0); ihdr.writeUInt32BE(OUT, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(process.argv[2] || '/tmp/horizon_map.png', png);
// height stats
let mn = 1e9, mx = -1e9; for (const h of w.heights) { if (h < mn) mn = h; if (h > mx) mx = h; }
console.log('height range', mn.toFixed(1), mx.toFixed(1));
for (const r of w.roads) { const p = r.pts; let len = 0, maxg = 0; for (let i = 3; i < p.length; i += 3) { const d = Math.hypot(p[i] - p[i - 3], p[i + 2] - p[i - 1]); len += d; maxg = Math.max(maxg, Math.abs(p[i + 1] - p[i - 2]) / d); }
  // tightest radius over a 12 m span
  const n = p.length / 3; let minR = 1e9, at = 0;
  for (let i = 6; i < n - 6; i++) { const a1 = Math.atan2(p[i*3+2]-p[(i-6)*3+2], p[i*3]-p[(i-6)*3]); const a2 = Math.atan2(p[(i+6)*3+2]-p[i*3+2], p[(i+6)*3]-p[i*3]); let da = Math.abs(a2 - a1); if (da > Math.PI) da = 2*Math.PI - da; const R = 24 / Math.max(da, 1e-4); if (R < minR) { minR = R; at = i * 2; } }
  console.log(r.name.padEnd(16), r.kind.padEnd(8), (len / 1000).toFixed(2) + 'km', 'maxGrade', (maxg * 100).toFixed(1) + '%', 'minRadius', minR.toFixed(0) + 'm@' + at, 'h', p[1].toFixed(1), '->', p[p.length - 2].toFixed(1)); }
console.log('props', Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.length])));
