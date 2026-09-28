// Road network: spatial queries (nearest road, progress along a road) and ribbon meshes.
import * as THREE from 'three';
import { makeRoadMaterial, makeShoulderMaterial } from './road-materials.js';

export class Road {
  constructor(d) {
    this.id = d.id;
    this.name = d.name;
    this.kind = d.kind;
    this.width = d.width;
    this.closed = d.closed;
    this.pts = d.pts;
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

export class RoadNetwork {
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

const Y_OFF = { highway: 0.07, road: 0.055, runway: 0.05, street: 0.045, dirt: 0.04 };
const TEX_LEN = { highway: 16, road: 14, street: 12, dirt: 10, runway: 30 };

export function buildRoadMeshes(network, hf) {
  const group = new THREE.Group();
  group.name = 'roads';
  const mats = {};
  const shoulderMaterial = makeShoulderMaterial();
  const matFor = (kind) => {
    if (!mats[kind]) {
      mats[kind] = makeRoadMaterial(kind);
    }
    return mats[kind];
  };
  for (const r of network.roads) {
    const cols = r.kind === 'highway' || r.kind === 'runway' ? 7 : 5;
    const n = r.n;
    const rows = r.closed ? n + 1 : n;
    const pos = new Float32Array(rows * cols * 3);
    const nrm = new Float32Array(rows * cols * 3);
    const uv = new Float32Array(rows * cols * 2);
    const nv = { x: 0, y: 1, z: 0 };
    const hw = r.width / 2;
    const yo = Y_OFF[r.kind] ?? 0.05;
    const tl = TEX_LEN[r.kind] ?? 14;
    for (let row = 0; row < rows; row++) {
      const i = row % n;
      const cx = r.pts[i * 3],
        cz = r.pts[i * 3 + 2];
      const tx = r.tan[i * 2],
        tz = r.tan[i * 2 + 1];
      const rx = -tz,
        rz = tx;
      const s = row < n ? r.s[i] : r.length;
      for (let c = 0; c < cols; c++) {
        const u = c / (cols - 1);
        const off = -hw + u * r.width;
        const x = cx + rx * off,
          z = cz + rz * off;
        const k = row * cols + c;
        pos[k * 3] = x;
        pos[k * 3 + 1] = hf.height(x, z) + yo;
        pos[k * 3 + 2] = z;
        hf.smoothNormal(x, z, nv);
        nrm[k * 3] = nv.x;
        nrm[k * 3 + 1] = nv.y;
        nrm[k * 3 + 2] = nv.z;
        uv[k * 2] = u;
        uv[k * 2 + 1] = s / tl;
      }
    }
    const idx = [];
    for (let row = 0; row < rows - 1; row++)
      for (let c = 0; c < cols - 1; c++) {
        const a = row * cols + c,
          b = a + 1,
          c2 = a + cols,
          d = c2 + 1;
        idx.push(a, b, c2, b, d, c2);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    // split long roads into chunks for better culling
    const mesh = new THREE.Mesh(g, matFor(r.kind));
    mesh.receiveShadow = true;
    mesh.name = 'road:' + r.name;
    mesh.renderOrder = 0;
    group.add(mesh);
    // Loose aggregate softens the transition into the verge. These visual
    // ribbons never change the drivable road width or surface queries.
    if (r.kind === 'road' || r.kind === 'highway') {
      for (const side of [-1, 1]) {
        const sp = [], sn = [], su = [], sc = [], si = [];
        for (let row = 0; row < rows; row++) {
          const i = row % n, s = row < n ? r.s[i] : r.length;
          const width = 0.55 + 0.17 * Math.sin(s * 0.37) + 0.09 * Math.sin(s * 1.13);
          for (let edge = 0; edge < 2; edge++) {
            const off = side * (hw - 0.025 + edge * width);
            const x = r.pts[i * 3] - r.tan[i * 2 + 1] * off;
            const z = r.pts[i * 3 + 2] + r.tan[i * 2] * off;
            hf.smoothNormal(x, z, nv);
            sp.push(x, hf.height(x, z) + yo * 0.65, z);
            sn.push(nv.x, nv.y, nv.z); su.push(x / 2, z / 2);
            sc.push(1, 1, 1, edge ? 0 : 0.82);
          }
          if (row < rows - 1) {
            const a = row * 2;
            if (side === 1) si.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            else si.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        sg.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
        sg.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
        sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 4)); sg.setIndex(si);
        const shoulder = new THREE.Mesh(sg, shoulderMaterial);
        shoulder.receiveShadow = true; shoulder.name = `verge:${r.name}`;
        group.add(shoulder);
      }
    }
  }
  return group;
}
