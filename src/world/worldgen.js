// Procedural island generator. Runs inside a Web Worker (see worldgen.worker.js) but has
// no DOM dependencies so it can also run on the main thread or in Node for debugging.
//
// Output:
//   heights   Float32Array((res+1)^2)   final terrain heights (roads carved in)
//   colors    Uint8Array((res+1)^2*4)   sRGB albedo + grass density in alpha
//   surface   Uint8Array((res+1)^2)     surface ids (see SURF)
//   roads     [{ id, name, kind, width, closed, pts: Float32Array(x,y,z...) }]
//   veg       { type: Float32Array(x,y,z,scale,rot,...) }
//   props     placements for lamps / rails / chevrons / turbines / boards / buildings

import { SimplexNoise, mulberry32, smoothstep, saturate, lerp, clamp, MinHeap, hash2 } from '../core/math.js';
import { HeightField } from './heightfield.js';
import { WORLD } from '../config.js';

export const SURF = {
  GRASS: 0,
  DRY: 1,
  DIRT: 2,
  SAND: 3,
  ROCK: 4,
  ASH: 5,
  FOREST: 6,
  FIELD: 7,
  ROAD: 8,
  DIRTROAD: 9,
  PAVE: 10,
  VERGE: 11,
};

export const LOCATIONS = {
  festival: { x: 250, z: 1110, r: 105, blend: 70 },
  town: { x: 1000, z: 170, r: 175, blend: 70 },
  lake: { x: -520, z: 560, r: 185 },
  airfield: { x: 800, z: 700, len: 860, w: 64, angle: -0.35 },
};

const RES = WORLD.res;
const SIZE = WORLD.size;
const HALF = SIZE / 2;
const CELL = SIZE / RES;
const S = RES + 1;

let nA, nB, nC, nD;

function islandRadius(x, z) {
  const ang = Math.atan2(z, x);
  const ca = Math.cos(ang),
    sa = Math.sin(ang);
  return (
    1600 +
    110 * Math.sin(2 * ang + 0.5) +
    80 * Math.sin(3 * ang + 2.1) +
    50 * Math.sin(5 * ang + 4.0) +
    25 * Math.sin(7 * ang + 1.3) +
    45 * nD.noise2(ca * 2.2 + 7, sa * 2.2 - 3) +
    12 * nD.noise2(ca * 9 + 1, sa * 9 + 5)
  );
}

// Smooth version (low harmonics only) used to lay out the ring road
function ringRadius(ang) {
  return 1600 + 110 * Math.sin(2 * ang + 0.5) + 80 * Math.sin(3 * ang + 2.1) + 50 * Math.sin(5 * ang + 4.0) + 25 * Math.sin(7 * ang + 1.3);
}

function baseHeight(x, z, out) {
  const R = islandRadius(x, z);
  const r = Math.sqrt(x * x + z * z);
  const d = r / R;
  const V = WORLD.volcano;

  // Rolling countryside
  let h = 14 + 15 * nA.fbm(x / 900, z / 900, 4) + 6.5 * nB.fbm(x / 280, z / 280, 3) + 1.1 * nC.fbm(x / 55, z / 55, 2);

  // Highlands in the north and a ridge in the north-east
  const north = smoothstep(-80, -950, z + 140 * nB.noise2(x / 700, 3.3));
  const east = smoothstep(450, 1250, x) * smoothstep(300, -700, z) * 0.75;
  const mMask = Math.max(north, east);
  if (mMask > 0.001) {
    const rg = nA.ridged(x / 760 + 3.7, z / 760 - 1.2, 5);
    h += mMask * (22 + 215 * rg * rg);
  }

  // The volcano
  const vx = x - V.x,
    vz = z - V.z;
  const vr = Math.sqrt(vx * vx + vz * vz);
  let volc = 0;
  if (vr < V.radius + 50) {
    let vh;
    const s = saturate((vr - V.crater) / (V.radius - V.crater));
    if (vr < V.crater) {
      const t = vr / V.crater;
      vh = V.height - V.craterDepth * (1 - t * t * t);
    } else {
      vh = V.height * Math.pow(1 - s, 1.85);
    }
    const inv = vr > 1e-3 ? 1 / vr : 0;
    const g = nC.ridged(vx * inv * 6.5 + vr / 260, vz * inv * 6.5 - vr / 310, 3);
    vh += (g - 0.35) * 16 * s * (1 - s) * 4;
    // lip of the crater
    vh += 10 * Math.exp(-Math.pow((vr - V.crater) / 22, 2));
    volc = vh;
    // the volcano replaces local hills near its core
    const core = 1 - smoothstep(V.radius * 0.35, V.radius, vr);
    h = lerp(h, Math.min(h, 30), core * 0.6) + vh;
  }

  // Inland lake (sits at sea level so the global water plane fills it)
  const L = LOCATIONS.lake;
  const lx = x - L.x,
    lz = z - L.z;
  const lr = Math.sqrt(lx * lx + lz * lz) / (L.r * (1 + 0.28 * nB.noise2(x / 160, z / 160)));
  if (lr < 2.2) {
    const w = 1 - smoothstep(0.5, 1.9, lr);
    h = lerp(h, -6, w);
  }

  // Coastline / beaches
  const f = smoothstep(0.74, 0.955, d);
  let beach = 2.8 - 62 * (d - 0.945);
  if (d > 1.0) beach -= 260 * (d - 1.0) * (d - 1.0);
  h = lerp(h, beach, f);
  if (h < -45) h = -45;
  if (out) {
    out.d = d;
    out.volc = volc;
    out.mMask = mMask;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Road routing

const G = 256; // A* grid resolution
const GC = SIZE / G; // 16 m
const DIRS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [1, 2],
  [-1, 2],
  [-2, 1],
  [-2, -1],
  [-1, -2],
  [1, -2],
  [2, -1],
];

function astar(hf, occ, sx, sz, gx, gz, opt) {
  const maxGrade = opt.maxGrade ?? 0.1;
  const wSlope = opt.slopeWeight ?? 6;
  const toCell = (v) => clamp(Math.floor((v + HALF) / GC), 0, G - 1);
  const start = toCell(sz) * G + toCell(sx);
  const goal = toCell(gz) * G + toCell(gx);
  const gScore = new Float64Array(G * G).fill(Infinity);
  const came = new Int32Array(G * G).fill(-1);
  const closed = new Uint8Array(G * G);
  const heap = new MinHeap(4096);
  const cx = (i) => (i % G) * GC - HALF + GC / 2;
  const cz = (i) => Math.floor(i / G) * GC - HALF + GC / 2;
  const gxw = cx(goal),
    gzw = cz(goal);
  const sxw = cx(start),
    szw = cz(start);
  gScore[start] = 0;
  heap.push(start, 0);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const ix = cur % G,
      iz = (cur / G) | 0;
    const x0 = cx(cur),
      z0 = cz(cur);
    const h0 = hf.height(x0, z0);
    // incoming direction (for a turning penalty that favours flowing roads)
    const par = came[cur];
    let inX = 0,
      inZ = 0;
    if (par >= 0) {
      inX = x0 - cx(par);
      inZ = z0 - cz(par);
      const l = Math.hypot(inX, inZ) || 1;
      inX /= l;
      inZ /= l;
    }
    for (let k = 0; k < DIRS.length; k++) {
      const nx = ix + DIRS[k][0],
        nz = iz + DIRS[k][1];
      if (nx < 1 || nz < 1 || nx >= G - 1 || nz >= G - 1) continue;
      const n = nz * G + nx;
      if (closed[n]) continue;
      const x1 = x0 + DIRS[k][0] * GC,
        z1 = z0 + DIRS[k][1] * GC;
      const dist = Math.hypot(x1 - x0, z1 - z0);
      const h1 = hf.height(x1, z1);
      const hm = hf.height((x0 + x1) / 2, (z0 + z1) / 2);
      const grade = Math.max(Math.abs(hm - h0), Math.abs(h1 - hm)) / (dist / 2);
      const gr = grade / maxGrade;
      let cost = dist * (1 + wSlope * gr * gr);
      if (gr > 1) cost += dist * 25 * (gr - 1);
      if (par >= 0) {
        const cosT = (inX * (x1 - x0) + inZ * (z1 - z0)) / dist;
        cost += dist * (opt.turnWeight ?? 1.2) * (1 - cosT);
      }
      const hmin = Math.min(h1, hm);
      if (hmin < 2.0) cost += dist * (12 + (2.0 - hmin) * 8);
      if (occ && occ[n]) {
        const ds = Math.min(Math.hypot(x1 - sxw, z1 - szw), Math.hypot(x1 - gxw, z1 - gzw));
        if (ds > 90) cost += dist * 4;
      }
      if (opt.avoid) {
        for (const a of opt.avoid) {
          const dd = Math.hypot(x1 - a.x, z1 - a.z);
          if (dd < a.r) cost += dist * 30 * (1 - dd / a.r);
        }
      }
      const ng = gScore[cur] + cost;
      if (ng < gScore[n]) {
        gScore[n] = ng;
        came[n] = cur;
        heap.push(n, ng + Math.hypot(x1 - gxw, z1 - gzw));
      }
    }
  }
  const path = [];
  let c = goal;
  if (came[c] === -1 && c !== start) return [[sx, sz], [gx, gz]];
  while (c !== -1) {
    path.push([cx(c), cz(c)]);
    if (c === start) break;
    c = came[c];
  }
  path.reverse();
  path[0] = [sx, sz];
  path[path.length - 1] = [gx, gz];
  return path;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a],
      [bx, bz] = pts[b];
    const dx = bx - ax,
      dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-9;
    let maxD = 0,
      idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, pz] = pts[i];
      const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
      const ex = ax + dx * t - px,
        ez = az + dz * t - pz;
      const d = ex * ex + ez * ez;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps * eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function chaikin(pts, iters, closed = false) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const out = [];
    const n = p.length;
    if (!closed) out.push(p[0]);
    const lim = closed ? n : n - 1;
    for (let i = 0; i < lim; i++) {
      const a = p[i],
        b = p[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}

function catmull(pts, closed, step = 4) {
  // centripetal-ish uniform Catmull-Rom, sampled densely
  const out = [];
  const n = pts.length;
  const get = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[clamp(i, 0, n - 1)];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(2, Math.ceil(len / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps,
        t2 = t * t,
        t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

function resample(pts, step, closed) {
  const src = closed ? [...pts, pts[0]] : pts;
  const out = [src[0]];
  let carry = 0;
  for (let i = 0; i < src.length - 1; i++) {
    const [ax, az] = src[i],
      [bx, bz] = src[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= len) {
      const t = d / len;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
      d += step;
    }
    carry = len - (d - step);
  }
  if (!closed) {
    const last = src[src.length - 1];
    const pl = out[out.length - 1];
    if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.4) out.push(last);
    else out[out.length - 1] = last;
  } else {
    // drop the duplicate closing point if too close to start
    const pl = out[out.length - 1];
    if (Math.hypot(pl[0] - out[0][0], pl[1] - out[0][1]) < step * 0.5) out.pop();
  }
  return out;
}

function laplacian(pts, iters, alpha, closed, fixed) {
  const n = pts.length;
  let a = pts.map((p) => [p[0], p[1]]);
  for (let it = 0; it < iters; it++) {
    const b = a.map((p) => [p[0], p[1]]);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      if (fixed && fixed[i]) continue;
      const p = a[(i - 1 + n) % n],
        q = a[(i + 1) % n];
      b[i][0] = a[i][0] + alpha * ((p[0] + q[0]) / 2 - a[i][0]);
      b[i][1] = a[i][1] + alpha * ((p[1] + q[1]) / 2 - a[i][1]);
    }
    a = b;
  }
  return a;
}

// Relax the path wherever the turning radius (over a 12 m span) is below rMin
function enforceMinRadius(pts, rMin, iters = 400) {
  let p = pts.map((q) => [q[0], q[1]]);
  const K = 6;
  // remove reversals / loops first (points where the path doubles back)
  const despike = (arr) => {
    let changed = true,
      guard = 0;
    while (changed && guard++ < 500) {
      changed = false;
      for (let i = 2; i < arr.length - 2; i++) {
        const ux = arr[i][0] - arr[i - 2][0],
          uz = arr[i][1] - arr[i - 2][1];
        const vx = arr[i + 2][0] - arr[i][0],
          vz = arr[i + 2][1] - arr[i][1];
        const c = (ux * vx + uz * vz) / ((Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1);
        if (c < -0.2) {
          arr.splice(i - 1, 3);
          changed = true;
          break;
        }
      }
    }
    return arr;
  };
  p = resample(despike(p), 2, false);
  for (let it = 0; it < iters; it++) {
    const n = p.length;
    const mark = new Uint8Array(n);
    let bad = 0;
    for (let i = K; i < n - K; i++) {
      const a1 = Math.atan2(p[i][1] - p[i - K][1], p[i][0] - p[i - K][0]);
      const a2 = Math.atan2(p[i + K][1] - p[i][1], p[i + K][0] - p[i][0]);
      let da = Math.abs(a2 - a1);
      if (da > Math.PI) da = 2 * Math.PI - da;
      const span = Math.hypot(p[i + K][0] - p[i - K][0], p[i + K][1] - p[i - K][1]);
      const R = span / Math.max(da, 1e-4);
      if (R < rMin) {
        bad++;
        for (let j = Math.max(1, i - 10); j <= Math.min(n - 2, i + 10); j++) mark[j] = 1;
      }
    }
    if (!bad) break;
    const q = p.map((v) => v.slice());
    for (let i = 1; i < n - 1; i++)
      if (mark[i]) {
        q[i][0] = p[i][0] * 0.4 + (p[i - 1][0] + p[i + 1][0]) * 0.3;
        q[i][1] = p[i][1] * 0.4 + (p[i - 1][1] + p[i + 1][1]) * 0.3;
      }
    p = q;
    if (it % 20 === 19) p = resample(p, 2, false);
  }
  return resample(p, 2, false);
}

function smoothProfile(h, sigmaSamples, closed) {
  const n = h.length;
  const out = new Float32Array(n);
  const R = Math.ceil(sigmaSamples * 2.5);
  const w = new Float32Array(R * 2 + 1);
  for (let k = -R; k <= R; k++) w[k + R] = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples));
  for (let i = 0; i < n; i++) {
    let s = 0,
      ws = 0;
    for (let k = -R; k <= R; k++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      s += h[j] * w[k + R];
      ws += w[k + R];
    }
    out[i] = s / ws;
  }
  return out;
}

function limitGrade(h, ds, g, closed) {
  const n = h.length;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < n; i++) h[i] = clamp(h[i], h[i - 1] - g * ds, h[i - 1] + g * ds);
    for (let i = n - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - g * ds, h[i + 1] + g * ds);
    if (closed) {
      h[0] = clamp(h[0], h[n - 1] - g * ds, h[n - 1] + g * ds);
    }
  }
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rX = bx - ax,
    rZ = bz - az,
    sX = dx - cx,
    sZ = dz - cz;
  const den = rX * sZ - rZ * sX;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sZ - (cz - az) * sX) / den;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

// ---------------------------------------------------------------------------

export function generateWorld(opts = {}, progress = () => {}) {
  const seed = opts.seed ?? WORLD.seed;
  nA = new SimplexNoise(mulberry32(seed + 11));
  nB = new SimplexNoise(mulberry32(seed + 23));
  nC = new SimplexNoise(mulberry32(seed + 37));
  nD = new SimplexNoise(mulberry32(seed + 51));
  const rand = mulberry32(seed + 99);

  const t0 = performance.now();
  const base = new Float32Array(S * S);
  const coastD = new Float32Array(S * S);
  const volcH = new Float32Array(S * S);
  const mountain = new Float32Array(S * S);
  const tmp = { d: 0, volc: 0, mMask: 0 };
  for (let iz = 0; iz < S; iz++) {
    const z = iz * CELL - HALF;
    for (let ix = 0; ix < S; ix++) {
      const x = ix * CELL - HALF;
      const i = iz * S + ix;
      base[i] = baseHeight(x, z, tmp);
      coastD[i] = tmp.d;
      volcH[i] = tmp.volc;
      mountain[i] = tmp.mMask;
    }
    if ((iz & 63) === 0) progress(0.05 + 0.25 * (iz / S), 'Shaping the island');
  }

  // Flat pads (festival, town)
  const pads = [
    { ...LOCATIONS.festival, h: null, min: 5 },
    { ...LOCATIONS.town, h: null, min: 6 },
  ];
  const baseHF = new HeightField(base, RES, SIZE);
  for (const p of pads) {
    let acc = 0,
      cnt = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      for (const rr of [0, p.r * 0.5, p.r]) {
        acc += baseHF.height(p.x + Math.cos(ang) * rr, p.z + Math.sin(ang) * rr);
        cnt++;
      }
    }
    p.h = Math.max(p.min, acc / cnt);
    flattenCircle(base, p.x, p.z, p.r, p.blend, p.h);
  }
  // Airfield strip: long flat rectangle
  const AF = LOCATIONS.airfield;
  {
    const hc = Math.max(8, baseHF.height(AF.x, AF.z));
    AF.h = hc;
    flattenRect(base, AF.x, AF.z, AF.len / 2, AF.w / 2, AF.angle, 60, hc);
  }
  progress(0.32, 'Surveying roads');

  // ------------------------------------------------------------------ roads
  const occ = new Uint8Array(G * G);
  const markOcc = (pts) => {
    for (const [x, z] of pts) {
      const ix = Math.floor((x + HALF) / GC),
        iz = Math.floor((z + HALF) / GC);
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const a = ix + dx,
            b = iz + dz;
          if (a >= 0 && b >= 0 && a < G && b < G) occ[b * G + a] = 1;
        }
    }
  };

  const F = LOCATIONS.festival,
    T = LOCATIONS.town,
    V = WORLD.volcano;
  const J = {
    C: [60, 200],
    W: [-780, 250],
    E: [640, 160],
    VB: [30, -40],
    RW: null,
    RE: null,
  };
  const roadDefs = [];

  // 1. Coastal ring road (closed)
  {
    const pts = [];
    for (let a = 0; a < 180; a++) {
      const ang = (a / 180) * Math.PI * 2;
      const R = ringRadius(ang) * 0.855;
      pts.push([Math.cos(ang) * R, Math.sin(ang) * R]);
    }
    let p = catmull(pts, true, 6);
    p = resample(p, 2, true);
    p = laplacian(p, 30, 0.5, true);
    p = resample(p, 2, true);
    roadDefs.push({ name: 'Costa Ring', kind: 'road', width: 11, closed: true, pts2: p });
  }
  const ringPts = roadDefs[0].pts2;
  const nearestOn = (pts, x, z) => {
    let best = 1e18,
      bi = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    return { i: bi, p: pts[bi], d: Math.sqrt(best) };
  };
  J.RW = nearestOn(ringPts, -1500, 300).p.slice();
  J.RE = nearestOn(ringPts, 1500, 120).p.slice();
  const ringS = nearestOn(ringPts, F.x + 10, F.z + 300).p.slice();
  const ringN = nearestOn(ringPts, 650, -1400).p.slice();
  const ringNW = nearestOn(ringPts, -1100, -900).p.slice();
  const ringSW = nearestOn(ringPts, -900, 1150).p.slice();
  markOcc(ringPts);

  // 2. Autopista (highway, gentle spline through waypoints)
  {
    const wp = [J.RW, [-1150, 290], J.W, [-420, 170], J.C, [360, 150], J.E, [T.x - 190, T.z - 10], [T.x, T.z], [T.x + 190, T.z], [1330, 140], J.RE];
    let p = catmull(wp, false, 6);
    p = resample(p, 2, false);
    p = laplacian(p, 40, 0.5, false);
    p = resample(p, 2, false);
    roadDefs.push({ name: 'Autopista Isla', kind: 'highway', width: 15, closed: false, pts2: p });
    markOcc(p);
  }

  const routed = (name, kind, width, waypoints, opt = {}) => {
    let path = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const [ax, az] = waypoints[i],
        [bx, bz] = waypoints[i + 1];
      const leg = astar(baseHF, occ, ax, az, bx, bz, opt);
      if (i > 0) leg.shift();
      path = path.concat(leg);
    }
    let p = rdp(path, opt.rdp ?? 10);
    p = chaikin(p, 3, false);
    p = resample(p, 2, false);
    p = laplacian(p, opt.smooth ?? 60, 0.5, false);
    p = resample(p, 2, false);
    p = enforceMinRadius(p, kind === 'dirt' ? 15 : 22);
    markOcc(p);
    roadDefs.push({ name, kind, width, closed: false, pts2: p, maxGrade: opt.maxGrade });
    return p;
  };

  // 3. Festival boulevard: festival -> central crossroads -> volcano base
  routed('Via Central', 'road', 11, [[F.x, F.z - F.r + 5], [170, 700], J.C, J.VB], { maxGrade: 0.08, slopeWeight: 5 });
  // festival to ring road (south)
  routed('Festival Drive', 'road', 11, [[F.x + 20, F.z + F.r - 10], ringS], { maxGrade: 0.1 });
  // 4. Volcano ascent - a spiral that follows the contours up to a viewpoint below the rim
  {
    const pts = [[J.VB[0], J.VB[1]]];
    let ang = Math.atan2(J.VB[1] - V.z, J.VB[0] - V.x);
    let r = Math.hypot(J.VB[0] - V.x, J.VB[1] - V.z);
    let h = baseHF.height(J.VB[0], J.VB[1]);
    const radial = (a, targetH) => {
      let lo = V.crater + 40,
        hi = V.radius + 200;
      for (let it = 0; it < 28; it++) {
        const mid = (lo + hi) / 2;
        const hh = baseHF.height(V.x + Math.cos(a) * mid, V.z + Math.sin(a) * mid);
        if (hh > targetH) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const ds = 4;
    // spiral in whichever direction continues the arriving road most smoothly
    const vc = roadDefs.find((rd) => rd.name === 'Via Central').pts2;
    const e1 = vc[vc.length - 1],
      e0 = vc[Math.max(0, vc.length - 8)];
    const inX = e1[0] - e0[0],
      inZ = e1[1] - e0[1];
    const tA = [Math.sin(ang), -Math.cos(ang)]; // direction when the angle decreases
    const dirSign = tA[0] * inX + tA[1] * inZ >= 0 ? -1 : 1;
    while (h < 292 && pts.length < 3000) {
      h += 0.085 * ds;
      const rt = radial(ang, h);
      r += (rt - r) * 0.2;
      ang += (dirSign * ds) / r;
      pts.push([V.x + Math.cos(ang) * r, V.z + Math.sin(ang) * r]);
    }
    let p = resample(pts, 2, false);
    p = laplacian(p, 40, 0.5, false);
    p = resample(p, 2, false);
    p = enforceMinRadius(p, 24);
    markOcc(p);
    roadDefs.push({ name: 'Volcán Spiral', kind: 'road', width: 10, closed: false, pts2: p, maxGrade: 0.1 });
    LOCATIONS.viewpoint = { x: p[p.length - 1][0], z: p[p.length - 1][1] };
  }
  // 5. Sierra pass: east junction north through the ridge to the northern ring
  routed('Sierra Pass', 'road', 10, [J.E, [820, -330], [640, -820], ringN], { maxGrade: 0.1, slopeWeight: 7 });
  // 6. Jungle trail (dirt): west junction up through the forest to the north-west ring
  routed('Selva Trail', 'dirt', 7, [J.W, [-980, -150], [-760, -560], ringNW], { maxGrade: 0.14, slopeWeight: 4 });
  // 7. Farm road: festival west through the fields past the lake to the west junction
  routed('Granja Road', 'road', 9, [[F.x - F.r + 5, F.z - 20], [-200, 980], [-560, 860], J.W], {
    maxGrade: 0.1,
    slopeWeight: 4,
    avoid: [{ x: LOCATIONS.lake.x, z: LOCATIONS.lake.z, r: 260 }],
  });
  // 8. South-west dirt track along the coast fields
  routed('Costa Dirt', 'dirt', 7, [[-560, 860], [-820, 1000], ringSW], { maxGrade: 0.15, slopeWeight: 3 });
  // 9. Airfield runway + connectors
  {
    const c = Math.cos(AF.angle),
      sn = Math.sin(AF.angle);
    const hl = AF.len / 2 - 30;
    const a = [AF.x - c * hl, AF.z - sn * hl],
      b = [AF.x + c * hl, AF.z + sn * hl];
    roadDefs.push({ name: 'Runway 09', kind: 'runway', width: 36, closed: false, pts2: resample([a, b], 2, false) });
    const vc = roadDefs.find((r) => r.name === 'Via Central').pts2;
    const west = [AF.x - c * (AF.len / 2 - 60) - sn * 40, AF.z - sn * (AF.len / 2 - 60) + c * 40];
    const onVC = nearestOn(vc, west[0] - 150, west[1] + 40).p;
    routed('Airfield Road', 'road', 9, [onVC, west], { maxGrade: 0.1 });
    const east = [AF.x + c * (AF.len / 2 - 60) + sn * 40, AF.z + sn * (AF.len / 2 - 60) - c * 40];
    const onRing = nearestOn(ringPts, east[0] + 120, east[1] + 60).p;
    routed('Airfield East', 'road', 9, [east, onRing], { maxGrade: 0.1 });
  }
  // 10. Town grid
  {
    const streets = [
      [[T.x - 150, T.z - 110], [T.x + 150, T.z - 110]],
      [[T.x - 150, T.z + 110], [T.x + 150, T.z + 110]],
      [[T.x - 110, T.z - 150], [T.x - 110, T.z + 150]],
      [[T.x + 110, T.z - 150], [T.x + 110, T.z + 150]],
    ];
    let k = 0;
    for (const st of streets) {
      let p = resample(st, 2, false);
      roadDefs.push({ name: ['Calle Norte', 'Calle Sur', 'Avenida Oeste', 'Avenida Este'][k++], kind: 'street', width: 10, closed: false, pts2: p });
    }
  }
  progress(0.45, 'Grading roads');

  // ------------------------------------------------------ height profiles
  const roads = [];
  for (let ri = 0; ri < roadDefs.length; ri++) {
    const rd = roadDefs[ri];
    const p = rd.pts2;
    const n = p.length;
    let h = new Float32Array(n);
    for (let i = 0; i < n; i++) h[i] = baseHF.height(p[i][0], p[i][1]);
    const sigma = rd.kind === 'highway' ? 22 : rd.kind === 'street' || rd.kind === 'runway' ? 4 : 12;
    h = smoothProfile(h, sigma, rd.closed);
    const g = rd.maxGrade ?? (rd.kind === 'highway' ? 0.06 : rd.kind === 'dirt' ? 0.16 : 0.1);
    for (let i = 0; i < n; i++) h[i] = Math.max(h[i], 2.2);
    limitGrade(h, 2, g, rd.closed);
    h = smoothProfile(h, 3, rd.closed);
    for (let i = 0; i < n; i++) h[i] = Math.max(h[i], 2.2);

    // pins where we meet or cross earlier roads
    const pins = [];
    for (let rj = 0; rj < roads.length; rj++) {
      const o = roads[rj];
      const op = o.pts;
      const on = op.length / 3;
      // endpoints snapping
      if (!rd.closed) {
        for (const end of [0, n - 1]) {
          let best = 1e18,
            bi = -1;
          for (let k = 0; k < on; k++) {
            const dx = op[k * 3] - p[end][0],
              dz = op[k * 3 + 2] - p[end][1];
            const d2 = dx * dx + dz * dz;
            if (d2 < best) {
              best = d2;
              bi = k;
            }
          }
          if (best < 22 * 22) {
            pins.push({ i: end, h: op[bi * 3 + 1] });
          }
        }
      }
      // crossings
      for (let i = 0; i < n - 1; i++) {
        const ax = p[i][0],
          az = p[i][1],
          bx = p[i + 1][0],
          bz = p[i + 1][1];
        for (let k = 0; k < on - 1 + (o.closed ? 1 : 0); k++) {
          const k2 = (k + 1) % on;
          const cx = op[k * 3],
            cz = op[k * 3 + 2];
          if (Math.abs(cx - ax) > 8 || Math.abs(cz - az) > 8) continue;
          const r = segIntersect(ax, az, bx, bz, cx, cz, op[k2 * 3], op[k2 * 3 + 2]);
          if (r) pins.push({ i: i + r[0], h: lerp(op[k * 3 + 1], op[k2 * 3 + 1], r[1]) });
        }
      }
    }
    for (const pin of pins) {
      const i0 = Math.floor(pin.i);
      const cur = lerp(h[clamp(i0, 0, n - 1)], h[clamp(i0 + 1, 0, n - 1)], pin.i - i0);
      const delta = pin.h - cur;
      const W = Math.round(clamp(Math.abs(delta) * 14, 30, 220)); // samples (2 m each)
      for (let i = Math.max(0, i0 - W); i <= Math.min(n - 1, i0 + W); i++) {
        const t = Math.abs(i - pin.i) / W;
        if (t < 1) h[i] += delta * (0.5 + 0.5 * Math.cos(Math.PI * t));
      }
    }
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = p[i][0];
      pts[i * 3 + 1] = h[i];
      pts[i * 3 + 2] = p[i][1];
    }
    roads.push({ id: ri, name: rd.name, kind: rd.kind, width: rd.width, closed: rd.closed, pts });
  }
  progress(0.55, 'Carving terrain');

  // ------------------------------------------------------------ carve
  const heights = new Float32Array(base);
  const best1 = new Float32Array(S * S).fill(1e9);
  const best1h = new Float32Array(S * S);
  const best1r = new Int16Array(S * S).fill(-1);
  const best1s = new Float32Array(S * S);
  const best2 = new Float32Array(S * S).fill(1e9);
  const best2h = new Float32Array(S * S);
  const roadW = new Float32Array(S * S); // half width of nearest road
  const MAXR = 70;
  for (const rd of roads) {
    const pts = rd.pts;
    const n = pts.length / 3;
    const segs = rd.closed ? n : n - 1;
    const hw = rd.width / 2;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 3],
        ah = pts[i * 3 + 1],
        az = pts[i * 3 + 2];
      const bx = pts[j * 3],
        bh = pts[j * 3 + 1],
        bz = pts[j * 3 + 2];
      const minX = Math.min(ax, bx) - MAXR,
        maxX = Math.max(ax, bx) + MAXR;
      const minZ = Math.min(az, bz) - MAXR,
        maxZ = Math.max(az, bz) + MAXR;
      const ix0 = Math.max(0, Math.floor((minX + HALF) / CELL)),
        ix1 = Math.min(RES, Math.ceil((maxX + HALF) / CELL));
      const iz0 = Math.max(0, Math.floor((minZ + HALF) / CELL)),
        iz1 = Math.min(RES, Math.ceil((maxZ + HALF) / CELL));
      const dx = bx - ax,
        dz = bz - az;
      const len2 = dx * dx + dz * dz || 1e-9;
      const sArc = i * 2;
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = iz * CELL - HALF;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = ix * CELL - HALF;
          let t = ((x - ax) * dx + (z - az) * dz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = ax + dx * t - x,
            ez = az + dz * t - z;
          const d = Math.sqrt(ex * ex + ez * ez) - hw; // distance from road edge
          if (d > MAXR - hw) continue;
          const v = iz * S + ix;
          const hh = ah + (bh - ah) * t;
          const s = sArc + t * 2;
          if (d < best1[v]) {
            const same = best1r[v] === rd.id && Math.abs(s - best1s[v]) < 60;
            if (!same && best1r[v] >= 0) {
              best2[v] = best1[v];
              best2h[v] = best1h[v];
            }
            best1[v] = d;
            best1h[v] = hh;
            best1r[v] = rd.id;
            best1s[v] = s;
            roadW[v] = hw;
          } else if (d < best2[v]) {
            const same = best1r[v] === rd.id && Math.abs(s - best1s[v]) < 60;
            if (!same) {
              best2[v] = d;
              best2h[v] = hh;
            }
          }
        }
      }
    }
  }
  const FLAT = 6.2; // flat shoulder beyond the edge
  const weight = (d, dh) => {
    const bw = clamp(10 + 1.6 * Math.abs(dh), 10, 60);
    return 1 - smoothstep(FLAT, FLAT + bw, d);
  };
  for (let v = 0; v < S * S; v++) {
    if (best1r[v] < 0) continue;
    let h = heights[v];
    if (best2[v] < 1e8) {
      const w2 = weight(best2[v], h - best2h[v]);
      h = lerp(h, best2h[v], w2);
    }
    const w1 = weight(best1[v], h - best1h[v]);
    h = lerp(h, best1h[v], w1);
    heights[v] = h;
  }
  // danger-sign jumps: kickers sculpted into dirt trails and open fields
  const jumps = [];
  {
    const byName = (n) => roads.find((r) => r.name === n);
    const at = (road, frac, side) => {
      const n = road.pts.length / 3;
      const i = Math.floor(n * frac);
      const a = Math.max(0, i - 2),
        b = Math.min(n - 1, i + 2);
      let dx = road.pts[b * 3] - road.pts[a * 3],
        dz = road.pts[b * 3 + 2] - road.pts[a * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      return { x: road.pts[i * 3] - dz * side, z: road.pts[i * 3 + 2] + dx * side, dx, dz };
    };
    const defs = [
      { road: 'Selva Trail', frac: 0.62, side: 0, name: 'Selva Danger Sign', H: 2.6 },
      { road: 'Costa Dirt', frac: 0.5, side: 0, name: 'Costa Danger Sign', H: 2.4 },
      { road: 'Via Central', frac: 0.3, side: 34, name: 'Granja Danger Sign', H: 3.2 },
      { road: 'Autopista Isla', frac: 0.62, side: -40, name: 'Llanura Danger Sign', H: 3.4 },
    ];
    for (const d of defs) {
      const road = byName(d.road);
      if (!road) continue;
      const j = at(road, d.frac, d.side);
      sculptJump(heights, j.x, j.z, j.dx, j.dz, d.H, d.side === 0 ? 5.5 : 8);
      jumps.push({ name: d.name, x: j.x - j.dx * 45, z: j.z - j.dz * 45, dx: j.dx, dz: j.dz, lip: { x: j.x, z: j.z } });
    }
  }
  const hf = new HeightField(heights, RES, SIZE);
  progress(0.66, 'Painting the land');

  // ------------------------------------------------------------ surface + colours
  const colors = new Uint8Array(S * S * 4);
  const surface = new Uint8Array(S * S);
  const nrm = { x: 0, y: 1, z: 0 };
  const P = {
    grass: [88, 122, 46],
    grass2: [112, 136, 54],
    grassDark: [62, 96, 38],
    dry: [176, 156, 94],
    dry2: [150, 128, 78],
    dirt: [122, 94, 66],
    sand: [222, 204, 164],
    wetSand: [168, 146, 112],
    rock: [120, 114, 106],
    rockDark: [84, 80, 76],
    ash: [66, 60, 58],
    ashRed: [110, 72, 58],
    forest: [58, 76, 36],
    verge: [138, 126, 104],
    pave: [150, 146, 140],
    seabed: [196, 178, 140],
  };
  const fieldCols = [
    [206, 184, 92],
    [104, 146, 52],
    [120, 92, 64],
    [214, 196, 70],
    [134, 158, 64],
    [186, 160, 90],
  ];
  const col = [0, 0, 0];
  const mix3 = (a, b, t) => {
    col[0] = a[0] + (b[0] - a[0]) * t;
    col[1] = a[1] + (b[1] - a[1]) * t;
    col[2] = a[2] + (b[2] - a[2]) * t;
  };
  const blendTo = (b, t) => {
    col[0] += (b[0] - col[0]) * t;
    col[1] += (b[1] - col[1]) * t;
    col[2] += (b[2] - col[2]) * t;
  };
  const fieldAng = 0.35,
    fc = Math.cos(fieldAng),
    fs = Math.sin(fieldAng);
  const fieldMaskAt = (x, z) => {
    // countryside south-west / south-central, not forest, not steep
    const m1 = smoothstep(1250, 900, Math.hypot(x + 200, z - 650) * 1.0);
    return m1 * smoothstep(0.15, -0.25, nB.noise2(x / 520 + 9, z / 520 - 4));
  };
  const forestAt = (x, z) => {
    let f = nC.fbm(x / 650 - 3, z / 650 + 8, 3) * 0.9 + 0.1;
    f += smoothstep(-400, -1100, x) * 0.55; // western jungle
    f -= smoothstep(300, 1100, x) * 0.55; // dry east
    return saturate(f);
  };
  const dryAt = (x, z) => saturate(smoothstep(250, 1150, x + 160 * nA.noise2(x / 500, z / 500)) - smoothstep(-500, -1100, z) * 0.6);

  for (let iz = 0; iz < S; iz++) {
    const z = iz * CELL - HALF;
    for (let ix = 0; ix < S; ix++) {
      const x = ix * CELL - HALF;
      const i = iz * S + ix;
      const h = heights[i];
      hf.smoothNormal(x, z, nrm);
      const slope = 1 - nrm.y;
      const n1 = nC.noise2(x / 40, z / 40);
      const n2 = nD.noise2(x / 140, z / 140);
      const dry = dryAt(x, z);
      const forest = forestAt(x, z);
      const d = coastD[i];
      let surf = SURF.GRASS;
      let grassDensity = 1;

      // base grass tone
      mix3(P.grass, P.grass2, saturate(0.5 + 0.5 * n2));
      blendTo(P.grassDark, saturate(0.3 + 0.35 * n1) * 0.6);
      // dry region
      if (dry > 0.01) {
        const dcol = n1 > 0 ? P.dry : P.dry2;
        blendTo(dcol, dry * 0.92);
        if (dry > 0.5) surf = SURF.DRY;
        grassDensity *= 1 - dry * 0.45;
      }
      // forest floor
      if (forest > 0.55 && dry < 0.5) {
        blendTo(P.forest, smoothstep(0.55, 0.85, forest) * 0.7);
        if (forest > 0.7) surf = SURF.FOREST;
      }
      // fields patchwork
      const fm = fieldMaskAt(x, z) * (1 - smoothstep(0.5, 0.8, forest));
      if (fm > 0.05 && h > 2.5) {
        const u = (x * fc + z * fs) / 95,
          w = (-x * fs + z * fc) / 140;
        const cu = Math.floor(u),
          cw = Math.floor(w);
        const fu = u - cu,
          fw = w - cw;
        const edge = Math.min(fu, 1 - fu, fw, 1 - fw);
        const fcol = fieldCols[Math.floor(hash2(cu, cw, 7) * fieldCols.length)];
        const t = fm * smoothstep(0.02, 0.06, edge);
        if (hash2(cu, cw, 3) > 0.18) {
          // stripes of crop rows
          const rows = 0.5 + 0.5 * Math.sin(u * 95 * 0.9);
          const fc2 = [fcol[0] * (0.9 + 0.1 * rows), fcol[1] * (0.9 + 0.1 * rows), fcol[2] * (0.9 + 0.1 * rows)];
          blendTo(fc2, t * 0.95);
          if (t > 0.5) {
            surf = SURF.FIELD;
            grassDensity *= 0.35;
          }
        }
      }
      // mountains -> rocky grass
      const mm = mountain[i];
      if (h > 70) blendTo(P.grassDark, smoothstep(70, 200, h) * 0.3 * (1 - forest));
      // volcano
      const vh = volcH[i];
      if (vh > 40) {
        const vt = smoothstep(40, 170, vh + n1 * 25);
        blendTo(n2 > 0.2 ? P.ashRed : P.ash, vt);
        if (vt > 0.5) {
          surf = SURF.ASH;
          grassDensity *= 1 - vt;
        }
      }
      // steep -> rock
      const rockT = smoothstep(0.24 + n1 * 0.05, 0.42, slope);
      if (rockT > 0) {
        blendTo(mm > 0.3 || vh > 60 ? P.rockDark : P.rock, rockT);
        grassDensity *= 1 - rockT;
        if (rockT > 0.5) surf = SURF.ROCK;
      }
      // beaches
      if (h < 4.2 && d > 0.8) {
        const st = smoothstep(4.2, 2.4, h + n1 * 0.6);
        blendTo(P.sand, st);
        if (h < 0.6) blendTo(P.wetSand, smoothstep(0.6, -0.3, h));
        if (st > 0.5) {
          surf = SURF.SAND;
          grassDensity *= 1 - st;
        }
      }
      if (h < 0) {
        blendTo(P.seabed, smoothstep(0, -3, h));
        grassDensity = 0;
      }
      // lake shores -> muddy
      // roads / verges
      const rd = best1[i];
      if (best1r[i] >= 0 && rd < FLAT + 2) {
        const rk = roads[best1r[i]].kind;
        if (rd < 0.5) {
          surf = rk === 'dirt' ? SURF.DIRTROAD : SURF.ROAD;
          blendTo(rk === 'dirt' ? P.dirt : P.verge, 0.9);
          grassDensity = 0;
        } else {
          const vt = 1 - smoothstep(0.5, FLAT + 2, rd);
          blendTo(rk === 'street' ? P.pave : P.verge, vt * 0.75);
          grassDensity *= 1 - vt;
          if (rd < 2.5) surf = rk === 'street' ? SURF.PAVE : SURF.VERGE;
        }
      }
      // pads
      for (const p of pads) {
        const pd = Math.hypot(x - p.x, z - p.z);
        if (pd < p.r + 6) {
          const pt = 1 - smoothstep(p.r - 10, p.r + 6, pd);
          blendTo(P.pave, pt * 0.85);
          grassDensity *= 1 - pt;
          if (pt > 0.5) surf = SURF.PAVE;
        }
      }
      // airfield strip
      {
        const ax = x - AF.x,
          az = z - AF.z;
        const u = ax * Math.cos(AF.angle) + az * Math.sin(AF.angle);
        const w = -ax * Math.sin(AF.angle) + az * Math.cos(AF.angle);
        if (Math.abs(u) < AF.len / 2 + 5 && Math.abs(w) < AF.w / 2 + 5) {
          const at = (1 - smoothstep(AF.len / 2 - 5, AF.len / 2 + 5, Math.abs(u))) * (1 - smoothstep(AF.w / 2 - 5, AF.w / 2 + 5, Math.abs(w)));
          blendTo([96, 96, 98], at * 0.95);
          grassDensity *= 1 - at;
          if (at > 0.5) surf = SURF.ROAD;
        }
      }
      // micro variation
      const v = 1 + n1 * 0.07 + nA.noise2(x / 9, z / 9) * 0.05;
      colors[i * 4] = clamp(col[0] * v, 0, 255);
      colors[i * 4 + 1] = clamp(col[1] * v, 0, 255);
      colors[i * 4 + 2] = clamp(col[2] * v, 0, 255);
      colors[i * 4 + 3] = clamp(grassDensity * 255, 0, 255);
      surface[i] = surf;
    }
    if ((iz & 63) === 0) progress(0.66 + 0.14 * (iz / S), 'Painting the land');
  }

  // ------------------------------------------------------------ vegetation
  progress(0.82, 'Planting forests');
  const veg = { broadleaf: [], pine: [], palm: [], bush: [], cactus: [], rock: [], birch: [] };
  const roadDist = (x, z) => {
    const ix = clamp(Math.round((x + HALF) / CELL), 0, RES),
      iz = clamp(Math.round((z + HALF) / CELL), 0, RES);
    const v = iz * S + ix;
    return best1r[v] >= 0 ? best1[v] : 1e9;
  };
  const inPad = (x, z, m = 0) => {
    for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < p.r + m) return true;
    for (const j of jumps) if (Math.hypot(x - j.lip.x, z - j.lip.z) < 45 + m || Math.hypot(x - j.x, z - j.z) < 30 + m) return true;
    const ax = x - AF.x,
      az = z - AF.z;
    const u = ax * Math.cos(AF.angle) + az * Math.sin(AF.angle);
    const w = -ax * Math.sin(AF.angle) + az * Math.cos(AF.angle);
    return Math.abs(u) < AF.len / 2 + m + 10 && Math.abs(w) < AF.w / 2 + m + 10;
  };
  const STEP = 11;
  for (let gz = -HALF + STEP; gz < HALF - STEP; gz += STEP) {
    for (let gx = -HALF + STEP; gx < HALF - STEP; gx += STEP) {
      const r1 = hash2(gx, gz, 1),
        r2 = hash2(gx, gz, 2),
        r3 = hash2(gx, gz, 3),
        r4 = hash2(gx, gz, 4);
      const x = gx + (r1 - 0.5) * STEP * 0.95;
      const z = gz + (r2 - 0.5) * STEP * 0.95;
      const h = hf.height(x, z);
      if (h < 1.2) continue;
      const rdist = roadDist(x, z);
      if (inPad(x, z, 4)) continue;
      hf.smoothNormal(x, z, nrm);
      const ix = clamp(Math.round((x + HALF) / CELL), 0, RES),
        iz = clamp(Math.round((z + HALF) / CELL), 0, RES);
      const i = iz * S + ix;
      const d = coastD[i];
      const forest = forestAt(x, z);
      const dry = dryAt(x, z);
      const vh = volcH[i];
      const surf = surface[i];
      const rot = r3 * Math.PI * 2;

      // rocks / boulders anywhere rugged
      if (rdist > 6 && (surf === SURF.ROCK || surf === SURF.ASH || (h > 80 && r4 < 0.06)) && r4 < 0.16) {
        veg.rock.push(x, h, z, 0.8 + r1 * 2.6, rot);
        continue;
      }
      if (rdist < 7.5) continue;
      if (nrm.y < 0.8) continue;
      if (vh > 110) continue;
      if (surf === SURF.FIELD) {
        continue;
      }

      // palms on the coast
      if (d > 0.86 && h < 14 && dry < 0.7) {
        if (r4 < 0.2 + forest * 0.2) veg.palm.push(x, h, z, 0.8 + r1 * 0.5, rot);
        else if (r4 < 0.3) veg.bush.push(x, h, z, 0.7 + r2 * 0.6, rot);
        continue;
      }
      // dry east: cacti + sparse shrubs + few trees
      if (dry > 0.55) {
        if (r4 < 0.05) veg.cactus.push(x, h, z, 0.8 + r1 * 0.7, rot);
        else if (r4 < 0.11) veg.bush.push(x, h, z, 0.6 + r2 * 0.6, rot);
        else if (r4 < 0.135) veg.broadleaf.push(x, h, z, 0.6 + r1 * 0.35, rot);
        continue;
      }
      // highlands -> pines
      const pineZone = smoothstep(60, 120, h + (r1 - 0.5) * 30) + (vh > 20 ? 0.7 : 0);
      const density = smoothstep(0.22, 0.8, forest) * 0.92 + 0.05 + (pineZone > 0.5 ? 0.12 : 0);
      if (r4 < density) {
        if (pineZone > 0.5) veg.pine.push(x, h, z, 0.75 + r1 * 0.6, rot);
        else if (x < -500 && r2 < 0.35) veg.palm.push(x, h, z, 0.9 + r1 * 0.4, rot);
        else if (r2 < 0.18) veg.birch.push(x, h, z, 0.8 + r1 * 0.4, rot);
        else veg.broadleaf.push(x, h, z, 0.75 + r1 * 0.55, rot);
        // a second tree in dense forest
        if (forest > 0.75 && r2 > 0.5) {
          const x2 = x + (r3 - 0.5) * 6,
            z2 = z + (r1 - 0.5) * 6;
          if (roadDist(x2, z2) > 8) {
            const h2 = hf.height(x2, z2);
            (pineZone > 0.5 ? veg.pine : veg.broadleaf).push(x2, h2, z2, 0.7 + r4 * 0.5, rot + 1);
          }
        }
      } else if (r4 < density + 0.08) {
        veg.bush.push(x, h, z, 0.6 + r2 * 0.7, rot);
      }
    }
  }
  // hedgerows along field borders
  {
    for (let gz = -HALF; gz < HALF; gz += 7) {
      for (let gx = -HALF; gx < HALF; gx += 7) {
        const u = (gx * fc + gz * fs) / 95,
          w = (-gx * fs + gz * fc) / 140;
        const fu = u - Math.floor(u),
          fw = w - Math.floor(w);
        const edge = Math.min(fu, 1 - fu, fw, 1 - fw);
        if (edge > 0.03) continue;
        const fm = fieldMaskAt(gx, gz);
        if (fm < 0.5) continue;
        const h = hf.height(gx, gz);
        if (h < 2 || roadDist(gx, gz) < 7 || inPad(gx, gz, 6)) continue;
        const r = hash2(gx, gz, 9);
        if (r < 0.75) veg.bush.push(gx, h, gz, 0.9 + r * 0.6, r * 6.28);
        else if (r < 0.8) veg.broadleaf.push(gx, h, gz, 0.9 + r * 0.3, r * 6.28);
      }
    }
  }
  const vegOut = {};
  for (const k in veg) vegOut[k] = new Float32Array(veg[k]);
  progress(0.9, 'Placing landmarks');

  // ------------------------------------------------------------ props
  const props = placeProps(roads, hf, heights, base, best1, best1r, pads, coastD, rand);
  progress(0.97, 'Finishing');

  return {
    heights,
    colors,
    surface,
    roads,
    veg: vegOut,
    props,
    pads: pads.map((p) => ({ x: p.x, z: p.z, r: p.r, h: p.h })),
    jumps,
    airfield: { ...AF },
    genTime: performance.now() - t0,
  };
}

// ramp rising along (dx,dz) to a lip at (cx,cz), then dropping away steeply
function sculptJump(arr, cx, cz, dx, dz, H, halfW) {
  const R = 40;
  const ix0 = Math.max(0, Math.floor((cx - R + HALF) / CELL)),
    ix1 = Math.min(RES, Math.ceil((cx + R + HALF) / CELL));
  const iz0 = Math.max(0, Math.floor((cz - R + HALF) / CELL)),
    iz1 = Math.min(RES, Math.ceil((cz + R + HALF) / CELL));
  for (let iz = iz0; iz <= iz1; iz++)
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = ix * CELL - HALF - cx,
        z = iz * CELL - HALF - cz;
      const u = x * dx + z * dz;
      const v = -x * dz + z * dx;
      let add = 0;
      if (u > -22 && u <= 0) add = H * Math.pow(smoothstep(-22, 0, u), 1.4);
      else if (u > 0 && u < 5) add = H * Math.pow(1 - u / 5, 2.2);
      add *= 1 - smoothstep(halfW, halfW + 5, Math.abs(v));
      arr[iz * S + ix] += add;
    }
}

function flattenCircle(arr, cx, cz, r, blend, h) {
  const R = r + blend;
  const ix0 = Math.max(0, Math.floor((cx - R + HALF) / CELL)),
    ix1 = Math.min(RES, Math.ceil((cx + R + HALF) / CELL));
  const iz0 = Math.max(0, Math.floor((cz - R + HALF) / CELL)),
    iz1 = Math.min(RES, Math.ceil((cz + R + HALF) / CELL));
  for (let iz = iz0; iz <= iz1; iz++)
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = ix * CELL - HALF,
        z = iz * CELL - HALF;
      const d = Math.hypot(x - cx, z - cz);
      const w = 1 - smoothstep(r, R, d);
      const i = iz * S + ix;
      arr[i] = lerp(arr[i], h, w);
    }
}

function flattenRect(arr, cx, cz, hl, hw, ang, blend, h) {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const R = Math.hypot(hl, hw) + blend;
  const ix0 = Math.max(0, Math.floor((cx - R + HALF) / CELL)),
    ix1 = Math.min(RES, Math.ceil((cx + R + HALF) / CELL));
  const iz0 = Math.max(0, Math.floor((cz - R + HALF) / CELL)),
    iz1 = Math.min(RES, Math.ceil((cz + R + HALF) / CELL));
  for (let iz = iz0; iz <= iz1; iz++)
    for (let ix = ix0; ix <= ix1; ix++) {
      const x = ix * CELL - HALF - cx,
        z = iz * CELL - HALF - cz;
      const u = Math.abs(x * c + z * s) - hl,
        w = Math.abs(-x * s + z * c) - hw;
      const d = Math.hypot(Math.max(u, 0), Math.max(w, 0));
      const wt = 1 - smoothstep(0, blend, d);
      const i = iz * S + ix;
      arr[i] = lerp(arr[i], h, wt);
    }
}

// ----------------------------------------------------------------------------
// Road-side props: lamps, guard rails, chevrons, fences, wind turbines, boards

function placeProps(roads, hf, heights, base, best1, best1r, pads, coastD, rand) {
  const lamps = [];
  const rails = []; // [x1,y1,z1,x2,y2,z2]
  const chevrons = []; // [x,y,z,rotY]
  const fences = [];
  const turbines = [];
  const boards = [];
  const signs = [];
  const nrm = { x: 0, y: 1, z: 0 };

  for (const rd of roads) {
    const p = rd.pts;
    const n = p.length / 3;
    const hw = rd.width / 2;
    // curvature per sample
    const curv = new Float32Array(n);
    for (let i = 3; i < n - 3; i++) {
      const ax = p[(i - 3) * 3],
        az = p[(i - 3) * 3 + 2];
      const bx = p[i * 3],
        bz = p[i * 3 + 2];
      const cx = p[(i + 3) * 3],
        cz = p[(i + 3) * 3 + 2];
      const a1 = Math.atan2(bz - az, bx - ax),
        a2 = Math.atan2(cz - bz, cx - bx);
      let da = a2 - a1;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      curv[i] = da / 12; // rad per metre (signed)
    }
    const tangent = (i) => {
      const a = Math.max(0, i - 1),
        b = Math.min(n - 1, i + 1);
      const dx = p[b * 3] - p[a * 3],
        dz = p[b * 3 + 2] - p[a * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l];
    };
    // lamps: highway + streets
    if (rd.kind === 'highway' || rd.kind === 'street') {
      const every = rd.kind === 'street' ? 18 : 30;
      for (let i = 5; i < n - 5; i += every) {
        const [tx, tz] = tangent(i);
        const side = rd.kind === 'highway' ? (((i / every) | 0) % 2 ? 1 : -1) : 1;
        for (const sd of rd.kind === 'street' ? [1, -1] : [side]) {
          const nx = -tz * sd,
            nz = tx * sd;
          const x = p[i * 3] + nx * (hw + 1.6),
            z = p[i * 3 + 2] + nz * (hw + 1.6);
          lamps.push(x, hf.height(x, z), z, Math.atan2(-nx, -nz));
        }
      }
    }
    // guard rails where the drop beside the road is big; chevrons on tight bends
    if (rd.kind !== 'street') {
      for (const sd of [1, -1]) {
        let run = null;
        for (let i = 2; i < n - 2; i += 2) {
          const [tx, tz] = tangent(i);
          const nx = -tz * sd,
            nz = tx * sd;
          const rx = p[i * 3] + nx * (hw + 0.9),
            rz = p[i * 3 + 2] + nz * (hw + 0.9);
          const ox = p[i * 3] + nx * (hw + 14),
            oz = p[i * 3 + 2] + nz * (hw + 14);
          const drop = p[i * 3 + 1] - hf.height(ox, oz);
          const tight = Math.abs(curv[i]) > 1 / 70 && Math.sign(curv[i]) === -sd;
          const want = (drop > 5.5 || (tight && drop > 2)) && rd.kind !== 'dirt';
          if (want) {
            const y = hf.height(rx, rz);
            if (!run) run = [];
            run.push([rx, y, rz]);
          } else if (run) {
            if (run.length > 2) for (let k = 0; k < run.length - 1; k++) rails.push(...run[k], ...run[k + 1]);
            run = null;
          }
        }
        if (run && run.length > 2) for (let k = 0; k < run.length - 1; k++) rails.push(...run[k], ...run[k + 1]);
      }
      // chevrons on the outside of tight bends
      for (let i = 10; i < n - 10; i += 9) {
        const c = curv[i];
        if (Math.abs(c) < 1 / 55) continue;
        const sd = c > 0 ? -1 : 1; // outside of the bend
        const [tx, tz] = tangent(i);
        const nx = -tz * sd,
          nz = tx * sd;
        const x = p[i * 3] + nx * (hw + 2.6),
          z = p[i * 3 + 2] + nz * (hw + 2.6);
        // face oncoming traffic: arrow points along bend direction
        chevrons.push(x, hf.height(x, z), z, Math.atan2(nx, nz), sd);
      }
    }
    // wooden fences along farm roads
    if (rd.kind === 'road' && (rd.name === 'Granja Road' || rd.name === 'Via Central')) {
      for (const sd of [1, -1]) {
        for (let i = 6; i < n - 6; i += 3) {
          const x0 = p[i * 3],
            z0 = p[i * 3 + 2];
          if (hash2(Math.floor(i / 60), sd, 5) < 0.45) continue;
          const [tx, tz] = tangent(i);
          const nx = -tz * sd,
            nz = tx * sd;
          const x = x0 + nx * (hw + 3.2),
            z = z0 + nz * (hw + 3.2);
          let inPad = false;
          for (const pd of pads) if (Math.hypot(x - pd.x, z - pd.z) < pd.r + 12) inPad = true;
          if (inPad) continue;
          const y = hf.height(x, z);
          if (y < 2) continue;
          fences.push(x, y, z, Math.atan2(tx, tz));
        }
      }
    }
  }

  // wind turbines on exposed hill tops in the east/south-east
  {
    const cand = [];
    for (let k = 0; k < 900; k++) {
      const x = -1500 + rand() * 3000,
        z = -1500 + rand() * 3000;
      const h = hf.height(x, z);
      if (h < 25 || h > 160) continue;
      if (x < 100) continue;
      // local maximum-ish
      let higher = 0;
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (hf.height(x + Math.cos(ang) * 40, z + Math.sin(ang) * 40) > h + 1) higher++;
      }
      if (higher > 1) continue;
      const ix = clamp(Math.round((x + HALF) / CELL), 0, RES),
        iz = clamp(Math.round((z + HALF) / CELL), 0, RES);
      const v = iz * S + ix;
      if (best1r[v] >= 0 && best1[v] < 25) continue;
      let bad = false;
      for (const pd of pads) if (Math.hypot(x - pd.x, z - pd.z) < pd.r + 80) bad = true;
      if (bad) continue;
      cand.push([x, h, z]);
    }
    for (const c of cand) {
      if (turbines.length >= 3 * 16) break;
      let ok = true;
      for (let t = 0; t < turbines.length; t += 3) if (Math.hypot(turbines[t] - c[0], turbines[t + 2] - c[2]) < 140) ok = false;
      if (ok) turbines.push(c[0], c[1], c[2]);
    }
  }

  // bonus boards: near roads but a little off the beaten path
  {
    let tries = 0;
    while (boards.length < 4 * 30 && tries++ < 5000) {
      const rd = roads[Math.floor(rand() * roads.length)];
      if (rd.kind === 'street') continue;
      const n = rd.pts.length / 3;
      const i = 5 + Math.floor(rand() * (n - 10));
      const sd = rand() < 0.5 ? 1 : -1;
      const a = Math.max(0, i - 1),
        b = Math.min(n - 1, i + 1);
      const dx = rd.pts[b * 3] - rd.pts[a * 3],
        dz = rd.pts[b * 3 + 2] - rd.pts[a * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      const off = rd.width / 2 + 10 + rand() * 25;
      const x = rd.pts[i * 3] + (-dz / l) * sd * off,
        z = rd.pts[i * 3 + 2] + (dx / l) * sd * off;
      const h = hf.height(x, z);
      if (h < 2) continue;
      hf.smoothNormal(x, z, nrm);
      if (nrm.y < 0.9) continue;
      let ok = true;
      for (let t = 0; t < boards.length; t += 4) if (Math.hypot(boards[t] - x, boards[t + 2] - z) < 180) ok = false;
      for (const pd of pads) if (Math.hypot(x - pd.x, z - pd.z) < pd.r + 20) ok = false;
      if (!ok) continue;
      boards.push(x, h, z, Math.atan2(-dx, -dz) + (rand() - 0.5));
    }
  }

  return {
    lamps: new Float32Array(lamps),
    rails: new Float32Array(rails),
    chevrons: new Float32Array(chevrons),
    fences: new Float32Array(fences),
    turbines: new Float32Array(turbines),
    boards: new Float32Array(boards),
  };
}
