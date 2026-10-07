// Renders top-down map images of the island from world data (for minimap + world map).
import { WORLD } from '../config.js';
import { SURF } from '../world/worldgen.js';
import { cityLayout } from '../world/city-layout.js';

export function renderMapImages(world, size = 1024) {
  const data = world.data;
  const S = WORLD.res + 1;
  const res = WORLD.res;
  const sat = document.createElement('canvas');
  sat.width = sat.height = size;
  const dark = document.createElement('canvas');
  dark.width = dark.height = size;
  const gs = sat.getContext('2d'),
    gd = dark.getContext('2d');
  const is = gs.createImageData(size, size),
    id = gd.createImageData(size, size);
  const h = data.heights,
    col = data.colors;
  const scale = res / size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = Math.min(res - 1, Math.floor(x * scale)),
        gz = Math.min(res - 1, Math.floor(y * scale));
      const i = gz * S + gx;
      const hh = h[i];
      const dx = h[i + 1] - h[i],
        dz = h[i + S] - h[i];
      const shade = Math.max(0.45, Math.min(1.35, 1 + (-dx * 0.9 - dz * 0.6) * 0.07));
      const o = (y * size + x) * 4;
      let r = col[i * 4],
        g = col[i * 4 + 1],
        b = col[i * 4 + 2];
      if (hh < 0) {
        const t = Math.min(1, -hh / 8);
        r = 40 * (1 - t) + 14 * t + 30;
        g = 150 * (1 - t) + 70 * t + 20;
        b = 160 * (1 - t) + 120 * t + 30;
        is.data[o] = r;
        is.data[o + 1] = g;
        is.data[o + 2] = b;
        id.data[o] = 16 + 10 * (1 - t);
        id.data[o + 1] = 40 + 30 * (1 - t);
        id.data[o + 2] = 62 + 30 * (1 - t);
      } else {
        is.data[o] = Math.min(255, r * shade);
        is.data[o + 1] = Math.min(255, g * shade);
        is.data[o + 2] = Math.min(255, b * shade);
        // dark, desaturated minimap style with hillshade
        const l = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
        const v = (40 + l * 40) * shade;
        id.data[o] = v * 0.92;
        id.data[o + 1] = v * 1.0;
        id.data[o + 2] = v * 0.96;
      }
      is.data[o + 3] = 255;
      id.data[o + 3] = 255;
    }
  gs.putImageData(is, 0, 0);
  gd.putImageData(id, 0, 0);
  const toPx = (v) => ((v + WORLD.size / 2) / WORLD.size) * size;
  // The downtown footprint is visible on the map and minimap, between the streets.
  for (const b of cityLayout(world.network, world.hf)) {
    gs.fillStyle = b.height > 80 ? '#798d97' : '#a4a49a';
    gd.fillStyle = '#66716f';
    for (const ctx of [gs, gd]) {
      ctx.save(); ctx.translate(toPx(b.x),toPx(b.z)); ctx.rotate(-(b.yaw||0));
      const w=b.w/WORLD.size*size,d=b.d/WORLD.size*size;
      ctx.fillRect(-w/2,-d/2,w,d); ctx.restore();
    }
  }
  // roads
  const drawRoads = (g, widthMul, color, outline) => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pass of outline ? [0, 1] : [1]) {
      for (const r of world.network.roads) {
        const w = Math.max(1.2, (r.width / (WORLD.size / size)) * widthMul) * (r.kind === 'highway' ? 1.3 : 1);
        g.lineWidth = pass === 0 ? w + 2.2 : w;
        g.strokeStyle = pass === 0 ? outline : typeof color === 'function' ? color(r) : color;
        g.beginPath();
        const p = r.pts;
        for (let i = 0; i < p.length; i += 3 * 2) {
          const X = toPx(p[i]),
            Y = toPx(p[i + 2]);
          if (i === 0) g.moveTo(X, Y);
          else g.lineTo(X, Y);
        }
        if (r.closed) g.closePath();
        g.stroke();
      }
    }
  };
  drawRoads(gs, 1.6, (r) => (r.kind === 'dirt' ? '#caa77a' : r.kind === 'highway' ? '#ffe7a8' : r.kind === 'track' ? '#ff5a7a' : '#f4f1ea'), 'rgba(40,30,20,0.55)');
  drawRoads(gd, 1.5, (r) => (r.kind === 'dirt' ? 'rgba(200,180,150,0.75)' : r.kind === 'highway' ? '#ffffff' : r.kind === 'track' ? '#ff6f8c' : 'rgba(235,235,240,0.92)'), 'rgba(0,0,0,0.5)');
  return { sat, dark, size, toPx };
}

export { SURF };
