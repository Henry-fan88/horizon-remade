// Small math helpers + deterministic noise (shared by the main thread and the world-gen worker).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a, b, v) {
  const t = saturate((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}
export const TAU = Math.PI * 2;

// Seeded PRNG (mulberry32)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash -> [0,1)
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// 2D simplex noise (Gustavson), seeded permutation. Output roughly [-1, 1].
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

export class SimplexNoise {
  constructor(rand = Math.random) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise2(xin, yin) {
    const perm = this.perm;
    const pm = this.permMod12;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n0 = 0,
      n1 = 0,
      n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = pm[ii + perm[jj]];
      t0 *= t0;
      n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = pm[ii + i1 + perm[jj + j1]];
      t1 *= t1;
      n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = pm[ii + 1 + perm[jj + 1]];
      t2 *= t2;
      n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  // Fractal Brownian motion, rotated octaves to hide lattice artefacts. ~[-1,1]
  fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let sum = 0,
      amp = 1,
      norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x, y);
      norm += amp;
      amp *= gain;
      const nx = x * 0.8 - y * 0.6;
      const ny = x * 0.6 + y * 0.8;
      x = nx * lacunarity + 17.13;
      y = ny * lacunarity - 9.71;
    }
    return sum / norm;
  }

  // Ridged multifractal, output [0,1]
  ridged(x, y, octaves = 5, lacunarity = 2.0, gain = 0.5) {
    let sum = 0,
      amp = 0.5,
      weight = 1,
      norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise2(x, y));
      n *= n;
      n *= weight;
      weight = saturate(n * 2);
      sum += n * amp;
      norm += amp;
      amp *= gain;
      const nx = x * 0.8 - y * 0.6;
      const ny = x * 0.6 + y * 0.8;
      x = nx * lacunarity + 5.3;
      y = ny * lacunarity + 11.9;
    }
    return sum / norm;
  }
}

// Minimal binary heap keyed by float priority, storing int ids.
export class MinHeap {
  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
    this.size = 0;
  }
  push(id, key) {
    if (this.size >= this.ids.length) {
      const ni = new Int32Array(this.ids.length * 2);
      const nk = new Float64Array(this.ids.length * 2);
      ni.set(this.ids);
      nk.set(this.keys);
      this.ids = ni;
      this.keys = nk;
    }
    let i = this.size++;
    const ids = this.ids,
      keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop() {
    const ids = this.ids,
      keys = this.keys;
    const top = ids[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n],
        key = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

export function formatNumber(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function formatTime(t) {
  if (!isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
