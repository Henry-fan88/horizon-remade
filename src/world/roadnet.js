// Road network: spatial queries (nearest road, progress along a road). No three.js or
// DOM dependencies, so it also runs inside Node benches and workers.
import { Junctions } from './junctions.js';

export class Road {
  constructor(d) {
    this.id = d.id;
    this.name = d.name;
    this.kind = d.kind;
    this.city = !!d.city;
    this.surface = d.surface;
    this.width = d.width;
    this.closed = d.closed;
    this.pts = d.pts;
    this.bank = d.bank || null; // superelevation per sample (see roadprofile.js)
    this.crown = d.crown || null; // crown scale per sample (0 where it meets another road)
    const n = (this.n = d.pts.length / 3);
    this.s = new Float32Array(n + 1);
    this.tan = new Float32Array(n * 2);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.s[i] = acc;
      const j = i + 1 < n ? i + 1 : this.closed ? 0 : -1;
      if (j >= 0) acc += Math.hypot(d.pts[j * 3] - d.pts[i * 3], d.pts[j * 3 + 2] - d.pts[i * 3 + 2]);
    }
    this.s[n] = acc;
    this.length = acc;
    for (let i = 0; i < n; i++) {
      let a = i - 1,
        b = i + 1;
      if (this.closed) {
        a = (a + n) % n;
        b = b % n;
      } else {
        a = Math.max(0, a);
        b = Math.min(n - 1, b);
      }
      const dx = this.pts[b * 3] - this.pts[a * 3],
        dz = this.pts[b * 3 + 2] - this.pts[a * 3 + 2];
      const l = Math.hypot(dx, dz) || 1;
      this.tan[i * 2] = dx / l;
      this.tan[i * 2 + 1] = dz / l;
    }
    this.lanes = d.kind === 'highway' ? 4 : d.kind === 'runway' ? 2 : 2;
    this.kerb = d.kind === 'track' ? kerbFlags(this) : null;
  }

  // kerb flags at sample i: 1 = left edge, 2 = right edge (see kerbFlags)
  kerbAt(i) {
    return this.kerb ? this.kerb[i] : 0;
  }

  // Point at arc-length s (wraps for closed roads). Writes into out {x,y,z,tx,tz,i}
  pointAt(s, out = {}) {
    const L = this.length;
    if (this.closed) s = ((s % L) + L) % L;
    else s = Math.max(0, Math.min(L - 1e-3, s));
    // binary search
    let lo = 0,
      hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const j = i + 1 < this.n ? i + 1 : this.closed ? 0 : i;
    const segLen = this.s[i + 1] - this.s[i] || 1;
    const t = j === i ? 0 : (s - this.s[i]) / segLen;
    const p = this.pts;
    out.x = p[i * 3] + (p[j * 3] - p[i * 3]) * t;
    out.y = p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t;
    out.z = p[i * 3 + 2] + (p[j * 3 + 2] - p[i * 3 + 2]) * t;
    const tx = this.tan[i * 2] + (this.tan[j * 2] - this.tan[i * 2]) * t;
    const tz = this.tan[i * 2 + 1] + (this.tan[j * 2 + 1] - this.tan[i * 2 + 1]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.i = i;
    return out;
  }

  // Signed curvature (1/m) at arc length s, measured over +-span metres
  curvatureAt(s, span = 12) {
    const a = this.pointAt(s - span, {}),
      b = this.pointAt(s + span, {});
    let da = Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx);
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    return da / (2 * span);
  }
}

// Race circuits: kerbs on the inside of every corner and on the outside of the tighter
// ones, running a little before and after the apex. Bit 1 = left edge, bit 2 = right edge.
function kerbFlags(road) {
  const n = road.n,
    p = road.pts,
    K = 8;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = road.closed ? (i - K + n) % n : Math.max(0, i - K),
      c = road.closed ? (i + K) % n : Math.min(n - 1, i + K);
    const ax = p[i * 3] - p[a * 3],
      az = p[i * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[i * 3],
      bz = p[c * 3 + 2] - p[i * 3 + 2];
    const la = Math.hypot(ax, az),
      lb = Math.hypot(bx, bz);
    if (la < 1e-3 || lb < 1e-3) continue;
    const curv = (ax * bz - az * bx) / (la * lb) / ((la + lb) / 2); // + bends right
    if (Math.abs(curv) < 1 / 230) continue;
    const inside = curv > 0 ? 2 : 1;
    raw[i] = inside | (Math.abs(curv) > 1 / 120 ? 3 ^ inside : 0);
  }
  const out = new Uint8Array(n);
  const R = 7;
  for (let i = 0; i < n; i++) {
    if (!raw[i]) continue;
    for (let k = -R; k <= R; k++) {
      const j = road.closed ? (i + k + n) % n : i + k;
      if (j >= 0 && j < n) out[j] |= raw[i];
    }
  }
  return out;
}

export class RoadNetwork {
  get junctions() {
    return this._junctions ||= new Junctions(this);
  }

  constructor(roadsData) {
    this.roads = roadsData.map((d) => new Road(d));
    this.cellSize = 32;
    this.grid = new Map();
    for (const r of this.roads) {
      const segs = r.closed ? r.n : r.n - 1;
      const pad = r.width / 2 + 2;
      for (let i = 0; i < segs; i++) {
        const j = (i + 1) % r.n;
        const ax = r.pts[i * 3],
          az = r.pts[i * 3 + 2],
          bx = r.pts[j * 3],
          bz = r.pts[j * 3 + 2];
        const x0 = Math.floor((Math.min(ax, bx) - pad) / this.cellSize),
          x1 = Math.floor((Math.max(ax, bx) + pad) / this.cellSize);
        const z0 = Math.floor((Math.min(az, bz) - pad) / this.cellSize),
          z1 = Math.floor((Math.max(az, bz) + pad) / this.cellSize);
        for (let cz = z0; cz <= z1; cz++)
          for (let cx = x0; cx <= x1; cx++) {
            const key = cx * 100003 + cz;
            let arr = this.grid.get(key);
            if (!arr) this.grid.set(key, (arr = []));
            arr.push(r.id, i);
          }
      }
    }
    this._res = { road: null, i: 0, t: 0, dist: 0, s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 0, lateral: 0 };
  }

  // Nearest road point within maxDist (searches neighbouring cells). Returns a shared object or null.
  nearest(x, z, maxDist = 40, filter = null, out = null) {
    const res = out || this._res;
    const cs = this.cellSize;
    const r = Math.ceil(maxDist / cs);
    const cx0 = Math.floor(x / cs),
      cz0 = Math.floor(z / cs);
    let best = maxDist * maxDist;
    let found = false;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const arr = this.grid.get((cx0 + dx) * 100003 + (cz0 + dz));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const road = this.roads[arr[k]];
          if (filter && !filter(road)) continue;
          const i = arr[k + 1];
          const j = (i + 1) % road.n;
          const p = road.pts;
          const ax = p[i * 3],
            az = p[i * 3 + 2];
          const ex = p[j * 3] - ax,
            ez = p[j * 3 + 2] - az;
          const l2 = ex * ex + ez * ez || 1e-9;
          let t = ((x - ax) * ex + (z - az) * ez) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + ex * t,
            pz = az + ez * t;
          const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
          if (d2 < best) {
            best = d2;
            found = true;
            res.road = road;
            res.i = i;
            res.t = t;
            res.x = px;
            res.z = pz;
            res.y = p[i * 3 + 1] + (p[j * 3 + 1] - p[i * 3 + 1]) * t;
            const l = Math.sqrt(l2);
            res.tx = ex / l;
            res.tz = ez / l;
          }
        }
      }
    if (!found) return null;
    res.dist = Math.sqrt(best);
    res.s = res.road.s[res.i] + (res.road.s[res.i + 1] - res.road.s[res.i]) * res.t;
    // signed lateral offset (positive = right of travel direction)
    res.lateral = (x - res.x) * -res.tz + (z - res.z) * res.tx;
    return res;
  }
}
