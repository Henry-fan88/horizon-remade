// Procedural textures drawn on canvases / data arrays at load time (no image assets).
import * as THREE from 'three';
import { SimplexNoise, mulberry32, clamp } from '../core/math.js';

let maxAniso = 8;
export function setMaxAnisotropy(a) {
  maxAniso = a;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(tex, { srgb = true, repeat = true, aniso = true, mip = true } = {}) {
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (aniso) tex.anisotropy = maxAniso;
  tex.generateMipmaps = mip;
  tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Periodic gradient-free value noise: lattice wraps every `period` cells -> seamless tiles
function lattice(ix, iy, period, seed) {
  ix = ((ix % period) + period) % period;
  iy = ((iy % period) + period) % period;
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}
function periodicNoise(u, v, period, seed) {
  const x = u * period,
    y = v * period;
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10),
    sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = lattice(ix, iy, period, seed),
    b = lattice(ix + 1, iy, period, seed);
  const c = lattice(ix, iy + 1, period, seed),
    d = lattice(ix + 1, iy + 1, period, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// fBm of periodic noise; freq is the base period (integer)
function tileNoise(_n, u, v, freq, seed = 1) {
  let sum = 0,
    amp = 1,
    norm = 0,
    p = Math.max(1, Math.round(freq));
  for (let o = 0; o < 4; o++) {
    sum += periodicNoise(u, v, p, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

// RGBA detail noise for terrain (R: large, G: medium, B: fine, A: grass streaks)
export function makeDetailTexture(size = 256) {
  const n = new SimplexNoise(mulberry32(4242));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const i = (y * size + x) * 4;
      const r = tileNoise(n, u, v, 4, 3) * 0.7 + tileNoise(n, u, v, 9, 5) * 0.3;
      const g = tileNoise(n, u, v, 12, 7) * 0.6 + tileNoise(n, u, v, 24, 11) * 0.4;
      const b = tileNoise(n, u, v, 32, 13) * 0.5 + (hashf(x, y) - 0.5) * 0.9;
      const a = tileNoise(n, u, v, 40, 19) * 0.5 + tileNoise(n, u, v, 64, 23) * 0.5;
      data[i] = clamp(128 + r * 150, 0, 255);
      data[i + 1] = clamp(128 + g * 150, 0, 255);
      data[i + 2] = clamp(128 + b * 150, 0, 255);
      data[i + 3] = clamp(128 + a * 150, 0, 255);
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return finish(tex, { srgb: false });
}

function hashf(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Tileable normal map for water ripples
export function makeWaterNormals(size = 256) {
  const n = new SimplexNoise(mulberry32(777));
  const hts = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      hts[y * size + x] = tileNoise(n, u, v, 6, 31) * 0.5 + tileNoise(n, u, v, 13, 37) * 0.3 + tileNoise(n, u, v, 27, 41) * 0.2;
    }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const hl = hts[y * size + ((x - 1 + size) % size)],
        hr = hts[y * size + ((x + 1) % size)];
      const hd = hts[((y - 1 + size) % size) * size + x],
        hu = hts[((y + 1) % size) * size + x];
      let nx = (hl - hr) * 6,
        ny = (hd - hu) * 6,
        nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = (nx / l) * 127 + 128;
      data[i + 1] = (ny / l) * 127 + 128;
      data[i + 2] = (nz / l) * 127 + 128;
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return finish(tex, { srgb: false });
}

// Road surface textures: u across the road (0..1), v along (repeats every `len` metres)
export function makeRoadTexture(kind) {
  const W = 512,
    H = 1024;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(kind.length * 977 + 13);
  const n = new SimplexNoise(mulberry32(kind.length * 31 + 5));
  const img = g.createImageData(W, H);
  const d = img.data;
  const dirt = kind === 'dirt';
  const runway = kind === 'runway';
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W,
        v = y / H;
      const i = (y * W + x) * 4;
      let base, r, gg, b;
      if (dirt) {
        const big = tileNoise(n, u * 0.5, v, 6);
        const fine = hashf(x, y) - 0.5;
        // two wheel ruts
        const rut = Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2));
        const edge = Math.min(u, 1 - u);
        base = 0.52 + big * 0.12 + fine * 0.16 - rut * 0.07;
        r = base * 150;
        gg = base * 118;
        b = base * 86;
        const grassy = Math.max(0, 1 - edge / 0.12) * (0.6 + big * 0.5) + Math.max(0, Math.abs(u - 0.5) < 0.08 ? 0.5 + big : 0) * 0.6;
        r = r * (1 - grassy * 0.5) + 80 * grassy * 0.5;
        gg = gg * (1 - grassy * 0.5) + 104 * grassy * 0.5;
        b = b * (1 - grassy * 0.5) + 50 * grassy * 0.5;
      } else {
        const big = tileNoise(n, u * 0.5, v, 5);
        const med = tileNoise(n, u, v, 22);
        const fine = hashf(x, y) - 0.5;
        const agg = hashf(x * 3 + 1, y * 7 + 3) > 0.985 ? 0.12 : 0;
        base = (runway ? 0.46 : 0.3) + big * 0.03 + med * 0.03 + fine * 0.08 + agg;
        // worn tyre tracks in each lane
        if (!runway) {
          const lanes = kind === 'highway' ? 4 : 2;
          for (let l = 0; l < lanes; l++) {
            const lc = (l + 0.5) / lanes;
            const off = 0.23 / lanes;
            base -= 0.03 * (Math.exp(-Math.pow((u - lc + off) / (0.05 / lanes), 2)) + Math.exp(-Math.pow((u - lc - off) / (0.05 / lanes), 2)));
          }
        }
        r = gg = b = base * 255;
        b *= 1.03;
      }
      d[i] = clamp(r, 0, 255);
      d[i + 1] = clamp(gg, 0, 255);
      d[i + 2] = clamp(b, 0, 255);
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  if (!dirt) {
    // cracks
    g.strokeStyle = 'rgba(10,10,10,0.35)';
    g.lineWidth = 1.2;
    for (let k = 0; k < 14; k++) {
      let x = rnd() * W,
        y = rnd() * H;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += (rnd() - 0.5) * 30;
        y += (rnd() - 0.3) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // tar patches
    for (let k = 0; k < 5; k++) {
      g.fillStyle = `rgba(20,20,22,${0.15 + rnd() * 0.2})`;
      g.fillRect(rnd() * W, rnd() * H, 20 + rnd() * 90, 20 + rnd() * 140);
    }
    const line = (u, w, color, dash) => {
      g.fillStyle = color;
      const x = u * W - (w * W) / 2;
      if (!dash) g.fillRect(x, 0, w * W, H);
      else for (let y = 0; y < H; y += dash[0] + dash[1]) g.fillRect(x, y, w * W, dash[0]);
    };
    const white = 'rgba(236,236,230,0.92)';
    const yellow = 'rgba(240,196,40,0.92)';
    if (kind === 'road') {
      line(0.045, 0.018, white);
      line(0.955, 0.018, white);
      line(0.5, 0.016, white, [H * 0.25, H * 0.25]);
    } else if (kind === 'highway') {
      line(0.035, 0.014, white);
      line(0.965, 0.014, white);
      line(0.25, 0.012, white, [H * 0.25, H * 0.25]);
      line(0.75, 0.012, white, [H * 0.25, H * 0.25]);
      line(0.492, 0.009, yellow);
      line(0.508, 0.009, yellow);
    } else if (kind === 'street') {
      line(0.05, 0.02, white);
      line(0.95, 0.02, white);
      line(0.5, 0.014, yellow, [H * 0.3, H * 0.2]);
    } else if (kind === 'runway') {
      line(0.02, 0.012, white);
      line(0.98, 0.012, white);
      line(0.5, 0.012, white, [H * 0.45, H * 0.55]);
    }
    // grime on lines
    const gi = g.getImageData(0, 0, W, H);
    const dd = gi.data;
    for (let i = 0; i < dd.length; i += 4) {
      const f = 0.9 + (hashf(i, 7) - 0.5) * 0.18;
      dd[i] *= f;
      dd[i + 1] *= f;
      dd[i + 2] *= f;
    }
    g.putImageData(gi, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  return finish(tex);
}

// Spread colour of opaque texels into transparent ones so mip-mapping doesn't darken edges
function bleedToDataTexture(c) {
  const g = c.getContext('2d');
  const W = c.width,
    H = c.height;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const out = new Uint8Array(d.length);
  out.set(d);
  // average opaque colour as a fallback
  let ar = 0,
    ag = 0,
    ab = 0,
    an = 0;
  for (let i = 0; i < d.length; i += 4)
    if (d[i + 3] > 128) {
      ar += d[i];
      ag += d[i + 1];
      ab += d[i + 2];
      an++;
    }
  ar /= an || 1;
  ag /= an || 1;
  ab /= an || 1;
  const filled = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) filled[i] = d[i * 4 + 3] > 8 ? 1 : 0;
  for (let pass = 0; pass < 6; pass++) {
    const nf = filled.slice();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (filled[i]) continue;
        let r = 0,
          gg = 0,
          b = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (!filled[j]) continue;
            r += out[j * 4];
            gg += out[j * 4 + 1];
            b += out[j * 4 + 2];
            n++;
          }
        if (n) {
          out[i * 4] = r / n;
          out[i * 4 + 1] = gg / n;
          out[i * 4 + 2] = b / n;
          nf[i] = 1;
        }
      }
    filled.set(nf);
  }
  for (let i = 0; i < W * H; i++)
    if (!filled[i]) {
      out[i * 4] = ar;
      out[i * 4 + 1] = ag;
      out[i * 4 + 2] = ab;
    }
  // canvas is top-down, textures are bottom-up with flipY=false for DataTexture
  const flipped = new Uint8Array(out.length);
  for (let y = 0; y < H; y++) flipped.set(out.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
  const tex = new THREE.DataTexture(flipped, W, H, THREE.RGBAFormat);
  return tex;
}

// Leaf cluster card for trees (alpha-tested). Clumpy, with gaps, lighter on top.
export function makeLeafTexture(kind = 'broad') {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(kind === 'broad' ? 11 : kind === 'pine' ? 12 : kind === 'birch' ? 14 : 13);
  g.clearRect(0, 0, S, S);
  if (kind === 'pine') {
    // a fir branch: central twig with dense needles, drooping
    for (let b = 0; b < 5; b++) {
      const x0 = S * (0.12 + rnd() * 0.1),
        y0 = S * (0.2 + b * 0.15);
      const len = S * (0.6 + rnd() * 0.25);
      for (let k = 0; k < 160; k++) {
        const t = k / 160;
        const x = x0 + t * len,
          y = y0 + t * t * S * 0.12;
        const shade = 0.55 + rnd() * 0.5;
        g.strokeStyle = `rgb(${34 * shade},${72 * shade},${38 * shade})`;
        g.lineWidth = 1.6;
        const nl = (1 - t * 0.6) * S * 0.09;
        for (const sd of [-1, 1]) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + nl * 0.35, y + sd * nl * (0.7 + rnd() * 0.4) + nl * 0.3);
          g.stroke();
        }
      }
    }
  } else if (kind === 'palm') {
    g.strokeStyle = 'rgb(96,90,44)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(4, S / 2);
    g.quadraticCurveTo(S / 2, S / 2 - 6, S - 4, S / 2 + 6);
    g.stroke();
    for (let k = 0; k < 64; k++) {
      const t = k / 64;
      const x = 6 + t * (S - 12);
      const y = S / 2 - 6 * Math.sin(t * Math.PI) + t * 6;
      const len = (1 - Math.pow(Math.abs(t - 0.4) * 1.5, 2)) * 118 + 8;
      for (const sd of [-1, 1]) {
        const shade = 0.62 + rnd() * 0.45;
        g.strokeStyle = `rgb(${78 * shade},${128 * shade},${40 * shade})`;
        g.lineWidth = 2.6;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len * 0.3, y + sd * len * 0.4, x + len * 0.42, y + sd * len * 0.7);
        g.stroke();
      }
    }
  } else {
    const hue = kind === 'birch' ? [118, 158, 62] : [74, 118, 42];
    // several clumps with gaps
    const clumps = [];
    for (let k = 0; k < 9; k++) clumps.push([S * (0.2 + rnd() * 0.6), S * (0.2 + rnd() * 0.6), S * (0.1 + rnd() * 0.12)]);
    for (let k = 0; k < 2600; k++) {
      const cl = clumps[k % clumps.length];
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * cl[2];
      const x = cl[0] + Math.cos(a) * rr;
      const y = cl[1] + Math.sin(a) * rr;
      if (Math.hypot(x - S / 2, y - S / 2) > S * 0.48) continue;
      const top = 1 - y / S;
      const edge = rr / cl[2];
      const shade = (0.55 + rnd() * 0.45) * (0.75 + top * 0.45) * (1.08 - edge * 0.25);
      g.fillStyle = `rgb(${Math.min(255, hue[0] * shade)},${Math.min(255, hue[1] * shade)},${Math.min(255, hue[2] * shade)})`;
      g.save();
      g.translate(x, y);
      g.rotate(rnd() * Math.PI * 2);
      g.beginPath();
      g.ellipse(0, 0, 4.5 + rnd() * 2.5, 2.2 + rnd() * 1.2, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  const tex = bleedToDataTexture(c);
  finish(tex, { repeat: false });
  return tex;
}

export function makeBarkTexture(kind = 'oak') {
  const W = 128,
    H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const n = new SimplexNoise(mulberry32(kind === 'birch' ? 91 : kind === 'palm' ? 92 : 93));
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W,
        v = y / H;
      const i = (y * W + x) * 4;
      let r, gg, b;
      if (kind === 'birch') {
        const band = tileNoise(n, u * 0.2, v * 3, 8) > 0.35 ? 0.25 : 1;
        const t = 0.85 + tileNoise(n, u, v, 16) * 0.1;
        r = 220 * t * band;
        gg = 216 * t * band;
        b = 205 * t * band;
      } else if (kind === 'palm') {
        const ring = 0.75 + 0.25 * Math.sin(v * Math.PI * 2 * 24 + tileNoise(n, u, v, 6) * 2);
        r = 120 * ring;
        gg = 100 * ring;
        b = 74 * ring;
      } else {
        const ridges = 0.7 + 0.3 * tileNoise(n, u * 4, v * 0.6, 10);
        r = 88 * ridges;
        gg = 70 * ridges;
        b = 52 * ridges;
      }
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(c));
}

// Windows grid for buildings: emissive at night via alpha channel variations
export function makeFacadeTexture(style = 0) {
  const W = 256,
    H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(style * 101 + 7);
  const wall = ['#e9dfcf', '#d9c9ae', '#f2efe8', '#c9d2d9', '#e7c9a9', '#f0d7d7'][style % 6];
  g.fillStyle = wall;
  g.fillRect(0, 0, W, H);
  // subtle grime
  for (let k = 0; k < 400; k++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.04})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 10, 2 + rnd() * 20);
  }
  const cols = 4,
    rows = 4;
  for (let r = 0; r < rows; r++)
    for (let cc = 0; cc < cols; cc++) {
      const x = cc * (W / cols) + 12,
        y = r * (H / rows) + 14;
      const w = W / cols - 24,
        h = H / rows - 26;
      g.fillStyle = '#2a3440';
      g.fillRect(x, y, w, h);
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, 'rgba(160,190,220,0.55)');
      grd.addColorStop(1, 'rgba(40,60,80,0.2)');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillRect(x - 3, y + h, w + 6, 4);
    }
  return finish(new THREE.CanvasTexture(c));
}

export function makeFacadeEmissive(style = 0) {
  const W = 256,
    H = 256;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(style * 131 + 3);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const cols = 4,
    rows = 4;
  for (let r = 0; r < rows; r++)
    for (let cc = 0; cc < cols; cc++) {
      if (rnd() < 0.45) continue;
      const x = cc * (W / cols) + 12,
        y = r * (H / rows) + 14;
      const w = W / cols - 24,
        h = H / rows - 26;
      const warm = rnd();
      g.fillStyle = warm > 0.3 ? `rgb(255,${200 + warm * 40},${130 + warm * 60})` : 'rgb(190,220,255)';
      g.globalAlpha = 0.5 + rnd() * 0.5;
      g.fillRect(x, y, w, h);
      g.globalAlpha = 1;
    }
  return finish(new THREE.CanvasTexture(c));
}

// Generic canvas-text texture (signs, banners)
export function makeTextTexture(text, opts = {}) {
  const { w = 1024, h = 256, bg = '#ff2d87', fg = '#ffffff', font = '800 italic 150px "Barlow Condensed", sans-serif', stroke = null, gradient = null } = opts;
  const c = canvas(w, h);
  const g = c.getContext('2d');
  if (gradient) {
    const grd = g.createLinearGradient(0, 0, w, 0);
    gradient.forEach((col, i) => grd.addColorStop(i / (gradient.length - 1), col));
    g.fillStyle = grd;
  } else g.fillStyle = bg;
  if (bg || gradient) g.fillRect(0, 0, w, h);
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 8;
    g.strokeText(text, w / 2, h / 2 + 6);
  }
  g.fillStyle = fg;
  g.fillText(text, w / 2, h / 2 + 6);
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}

export function makeSmokeTexture() {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(55);
  for (let k = 0; k < 40; k++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.4,
      y = S / 2 + (rnd() - 0.5) * S * 0.4;
    const r = S * (0.12 + rnd() * 0.22);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  return finish(new THREE.CanvasTexture(c), { repeat: false });
}
