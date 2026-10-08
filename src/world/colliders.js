// Static collision world (trees, rocks, buildings, rails) + smashable props, with impulse
// responses for vehicles. A car is a rounded box (an inner box plus a radius) that follows
// the body's full orientation, so contacts happen at the bumper or sill that actually hits,
// at its real height, and pitch / roll the car as well as yawing it.
// Statics are vertical cylinders (trees, poles) and vertical prisms (buildings, rails).
import * as THREE from 'three';
import { clamp } from '../core/math.js';

const CELL = 8;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _r2 = new THREE.Vector3();
const _v = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _t = new THREE.Vector3();
const _J = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

// ------------------------------------------------------------------ car shape
// Rounded box of a body: centre (world), rotation, inner half extents, radius.
export class CarShape {
  constructor() {
    this.c = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.qi = new THREE.Quaternion();
    this.e = new THREE.Vector3();
    this.R = 0.25;
    this.bound = 3;
    // sample points on the inner box (local): corners, edge midpoints, quarter points on the
    // long edges and face centres; each carries the rounding radius
    this.samples = [];
    this.world = [];
  }

  update(phys) {
    const he = phys.halfExtents;
    const R = Math.min(0.3, he.x * 0.3, he.y * 0.8);
    this.R = R;
    this.e.set(Math.max(0.05, he.x - R), Math.max(0.05, he.y - R), Math.max(0.05, he.z - R));
    this.q.copy(phys.quat);
    this.qi.copy(phys.quat).invert();
    this.c.copy(phys.boxCenterLocal).applyQuaternion(this.q).add(phys.pos);
    this.bound = this.e.length() + R;
    if (this.samples.length === 0) {
      for (const x of [-1, 0, 1])
        for (const y of [-1, 0, 1])
          for (const z of [-1, -0.5, 0, 0.5, 1]) {
            const k = (x !== 0) + (y !== 0) + (z !== 0);
            if (!(k >= 2 || (k === 1 && y === 0))) continue;
            // the roof is shorter than the body: pull the top front/rear points in, so a
            // nose or tail hit lands at bumper height rather than on a phantom roof corner
            this.samples.push(new THREE.Vector3(x, y, y === 1 && Math.abs(z) === 1 ? z * 0.55 : z));
          }
      for (let i = 0; i < this.samples.length; i++) this.world.push(new THREE.Vector3());
    }
    const e = this.e;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      this.world[i].set(s.x * e.x, s.y * e.y, s.z * e.z).applyQuaternion(this.q).add(this.c);
    }
    return this;
  }

  toLocal(p, out) {
    return out.subVectors(p, this.c).applyQuaternion(this.qi);
  }

  toWorldDir(v, out) {
    return out.copy(v).applyQuaternion(this.q);
  }
}

const _shapeA = new CarShape();
const _shapeB = new CarShape();
const _hit = { depth: 0, n: new THREE.Vector3(), p: new THREE.Vector3() };
const _hit2 = { depth: 0, n: new THREE.Vector3(), p: new THREE.Vector3() };
const _pairN = new THREE.Vector3();
const _depths = new Float32Array(64);

// closest points between segment [A,B] (local space) and the box |x| <= e; writes the
// segment point into P and box point into Q, returns the distance
function segmentBox(A, B, e, P, Q, t0 = 0.5) {
  let t = t0;
  const dx = B.x - A.x,
    dy = B.y - A.y,
    dz = B.z - A.z;
  const L2 = dx * dx + dy * dy + dz * dz || 1e-9;
  for (let it = 0; it < 6; it++) {
    P.set(A.x + dx * t, A.y + dy * t, A.z + dz * t);
    Q.set(clamp(P.x, -e.x, e.x), clamp(P.y, -e.y, e.y), clamp(P.z, -e.z, e.z));
    t = clamp(((Q.x - A.x) * dx + (Q.y - A.y) * dy + (Q.z - A.z) * dz) / L2, 0, 1);
  }
  P.set(A.x + dx * t, A.y + dy * t, A.z + dz * t);
  Q.set(clamp(P.x, -e.x, e.x), clamp(P.y, -e.y, e.y), clamp(P.z, -e.z, e.z));
  return Math.hypot(P.x - Q.x, P.y - Q.y, P.z - Q.z);
}

// Car (rounded box) vs vertical cylinder at (x, z) radius r spanning y0..y1.
function carVsCylinder(sh, x, z, r, y0, y1, hit) {
  _a.set(x, y0, z);
  _b.set(x, y1, z);
  sh.toLocal(_a, _a);
  sh.toLocal(_b, _b);
  // start the search at bumper height so a flat face meets a trunk there, not at the roof
  const t0 = clamp((sh.c.y - sh.e.y * 0.5 - y0) / Math.max(1e-3, y1 - y0), 0, 1);
  const d = segmentBox(_a, _b, sh.e, _c, _d, t0); // _c on axis, _d on inner box (local)
  const reach = r + sh.R;
  if (d >= reach) return null;
  if (d > 1e-6) {
    // normal from the obstacle toward the car, in local space
    _n.set(_d.x - _c.x, _d.y - _c.y, _d.z - _c.z).divideScalar(d);
    hit.depth = reach - d;
  } else {
    // the axis passes through the inner box: push out through the nearest side (x or z)
    const px = sh.e.x - Math.abs(_c.x),
      pz = sh.e.z - Math.abs(_c.z);
    if (px < pz) _n.set(_c.x > 0 ? -1 : 1, 0, 0);
    else _n.set(0, 0, _c.z > 0 ? -1 : 1);
    hit.depth = reach + Math.min(px, pz);
  }
  sh.toWorldDir(_n, hit.n);
  // contact point: on the car's surface
  hit.p.copy(_d).addScaledVector(_n, -sh.R).applyQuaternion(sh.q).add(sh.c);
  return hit;
}

// Car vs vertical prism: centre (x, z), half extents hx (along (c, s)) and hz, y0..y1.
function carVsPrism(sh, st, hit) {
  let best = 0;
  const c = st.c,
    s = st.s;
  // depths of all samples first, so ties (a flat face against a wall) average to the
  // middle of the contact patch instead of one corner
  const depths = _depths;
  depths.fill(-1);
  // 1) sample points of the car against the prism
  for (let i = 0; i < sh.world.length; i++) {
    const P = sh.world[i];
    const dx = P.x - st.x,
      dz = P.z - st.z;
    const u = dx * c + dz * s,
      v = -dx * s + dz * c;
    const qu = clamp(u, -st.hx, st.hx),
      qv = clamp(v, -st.hz, st.hz),
      qy = clamp(P.y, st.y0, st.y1);
    const eu = u - qu,
      ev = v - qv,
      ey = P.y - qy;
    const d2 = eu * eu + ev * ev + ey * ey;
    let depth, nu, nv, ny;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      depth = sh.R - d;
      depths[i] = depth;
      if (depth <= best) continue;
      nu = eu / d;
      nv = ev / d;
      ny = ey / d;
    } else {
      // sample point inside the prism: leave through the nearest face
      const fu = st.hx - Math.abs(u),
        fv = st.hz - Math.abs(v),
        fy = Math.min(P.y - st.y0, st.y1 - P.y);
      const m = Math.min(fu, fv, fy);
      depth = sh.R + m;
      depths[i] = depth;
      if (depth <= best) continue;
      nu = nv = ny = 0;
      if (m === fu) nu = u >= 0 ? 1 : -1;
      else if (m === fv) nv = v >= 0 ? 1 : -1;
      else ny = P.y - st.y0 < st.y1 - P.y ? -1 : 1;
    }
    best = depth;
    hit.depth = depth;
    hit.n.set(nu * c - nv * s, ny, nu * s + nv * c);
  }
  if (best > 0) {
    let cnt = 0;
    hit.p.set(0, 0, 0);
    for (let i = 0; i < sh.world.length; i++)
      if (depths[i] > best - 0.02) {
        hit.p.add(sh.world[i]);
        cnt++;
      }
    hit.p.divideScalar(cnt).addScaledVector(hit.n, -sh.R);
  }
  // 2) the prism's vertical edges against the car (a corner poking into a flank)
  for (const cu of [-1, 1])
    for (const cv of [-1, 1]) {
      const ex = st.x + cu * st.hx * c - cv * st.hz * s,
        ez = st.z + cu * st.hx * s + cv * st.hz * c;
      _a.set(ex, st.y0, ez);
      _b.set(ex, st.y1, ez);
      sh.toLocal(_a, _a);
      sh.toLocal(_b, _b);
      const d = segmentBox(_a, _b, sh.e, _c, _d, clamp((sh.c.y - sh.e.y * 0.5 - st.y0) / Math.max(1e-3, st.y1 - st.y0), 0, 1));
      if (d >= sh.R) continue;
      let depth;
      if (d > 1e-6) {
        depth = sh.R - d;
        _n.set(_d.x - _c.x, _d.y - _c.y, _d.z - _c.z).divideScalar(d);
      } else {
        const px = sh.e.x - Math.abs(_c.x),
          pz = sh.e.z - Math.abs(_c.z);
        if (px < pz) _n.set(_c.x > 0 ? -1 : 1, 0, 0);
        else _n.set(0, 0, _c.z > 0 ? -1 : 1);
        depth = sh.R + Math.min(px, pz);
      }
      if (depth <= best) continue;
      best = depth;
      hit.depth = depth;
      sh.toWorldDir(_n, hit.n);
      hit.p.copy(_d).addScaledVector(_n, -sh.R).applyQuaternion(sh.q).add(sh.c);
    }
  return best > 0 ? hit : null;
}

// Car B (rounded box) vs sample points of car A. Normal points from B toward A.
function samplesVsCar(A, B, hit, best) {
  const e = B.e;
  const reach = A.R + B.R;
  for (let i = 0; i < A.world.length; i++) {
    B.toLocal(A.world[i], _a);
    const qx = clamp(_a.x, -e.x, e.x),
      qy = clamp(_a.y, -e.y, e.y),
      qz = clamp(_a.z, -e.z, e.z);
    const dx = _a.x - qx,
      dy = _a.y - qy,
      dz = _a.z - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    let depth;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      depth = reach - d;
      if (depth <= best) continue;
      _n.set(dx / d, dy / d, dz / d);
    } else {
      const fx = e.x - Math.abs(_a.x),
        fy = e.y - Math.abs(_a.y),
        fz = e.z - Math.abs(_a.z);
      const m = Math.min(fx, fy, fz);
      depth = reach + m;
      if (depth <= best) continue;
      if (m === fx) _n.set(_a.x > 0 ? 1 : -1, 0, 0);
      else if (m === fz) _n.set(0, 0, _a.z > 0 ? 1 : -1);
      else _n.set(0, _a.y > 0 ? 1 : -1, 0);
    }
    best = depth;
    hit.depth = depth;
    B.toWorldDir(_n, hit.n);
    // midway between the two surfaces
    hit.p.set(qx, qy, qz).addScaledVector(_n, B.R + (reach - depth - B.R - A.R) * 0.5).applyQuaternion(B.q).add(B.c);
  }
  return best;
}

export class CollisionWorld {
  constructor() {
    this.statics = [];
    this.grid = new Map();
    this.smash = [];
    this.smashGrid = new Map();
    this.onSmash = null;
    this._cand = [];
    this._scand = [];
    this._stamp = 1;
  }

  key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  insert(grid, idx, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL),
      x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL),
      z1 = Math.floor(maxZ / CELL);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const k = this.key(x, z);
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(idx);
      }
  }

  addCircle(x, z, r, y0, y1, kind = 'tree') {
    const idx = this.statics.length;
    this.statics.push({ type: 0, x, z, r, y0, y1, kind, seen: 0 });
    this.insert(this.grid, idx, x - r, z - r, x + r, z + r);
  }

  addBox(x, z, hx, hz, rot, y0, y1, kind = 'building') {
    const idx = this.statics.length;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    this.statics.push({ type: 1, x, z, hx, hz, c, s, y0, y1, kind, seen: 0 });
    const R = Math.hypot(hx, hz);
    this.insert(this.grid, idx, x - R, z - R, x + R, z + R);
  }

  // a rail: a thin wall along the segment (stored as a prism)
  addSegment(x1, z1, x2, z2, r, y0, y1, kind = 'rail') {
    const len = Math.hypot(x2 - x1, z2 - z1) || 1e-3;
    const c = (x2 - x1) / len,
      s = (z2 - z1) / len;
    const idx = this.statics.length;
    this.statics.push({ type: 1, x: (x1 + x2) / 2, z: (z1 + z2) / 2, hx: len / 2 + r, hz: r, c, s, y0, y1, kind, seen: 0 });
    this.insert(this.grid, idx, Math.min(x1, x2) - r, Math.min(z1, z2) - r, Math.max(x1, x2) + r, Math.max(z1, z2) + r);
  }

  addSmashable(obj) {
    // obj: { x, z, r, y, kind, alive, onSmash? }
    const idx = this.smash.length;
    obj.alive = true;
    obj.seen = 0;
    this.smash.push(obj);
    this.insert(this.smashGrid, idx, obj.x - obj.r, obj.z - obj.r, obj.x + obj.r, obj.z + obj.r);
    return idx;
  }

  // candidate indices near (x, z); each index once (stamped, no allocation)
  query(grid, list, x, z, r, out) {
    out.length = 0;
    const stamp = ++this._stamp;
    const x0 = Math.floor((x - r) / CELL),
      x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL),
      z1 = Math.floor((z + r) / CELL);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const a = grid.get(this.key(cx, cz));
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const o = list[a[k]];
          if (o.seen === stamp) continue;
          o.seen = stamp;
          out.push(a[k]);
        }
      }
    return out;
  }

  // Resolve a vehicle against static geometry. Returns max impact speed (m/s).
  resolveVehicle(phys) {
    const sh = _shapeA.update(phys);
    const cand = this.query(this.grid, this.statics, sh.c.x, sh.c.z, sh.bound + 1, this._cand);
    let impact = 0;
    for (const i of cand) {
      const s = this.statics[i];
      if (sh.c.y + sh.bound < s.y0 || sh.c.y - sh.bound > s.y1) continue;
      const hit = s.type === 0 ? carVsCylinder(sh, s.x, s.z, s.r, s.y0, s.y1, _hit) : carVsPrism(sh, s, _hit);
      if (hit) {
        const soft = s.kind === 'rail' || s.kind === 'pole';
        const imp = respond(phys, hit, soft ? 0.12 : 0.2, soft ? 0.22 : 0.45);
        impact = Math.max(impact, imp);
        sh.update(phys);
      }
    }
    // smashables (signs, fences, bushes, boards): knocked flat by the car's footprint
    const sc = this.query(this.smashGrid, this.smash, sh.c.x, sh.c.z, sh.bound + 1, this._scand);
    for (const i of sc) {
      const o = this.smash[i];
      if (!o.alive) continue;
      if (Math.abs(o.y - sh.c.y) > 4) continue;
      if (carVsCylinder(sh, o.x, o.z, o.r, o.y - 1, o.y + 3, _hit)) {
        o.alive = false;
        const sp = phys.vel.length();
        phys.vel.multiplyScalar(o.mass ? clamp(1 - o.mass / (phys.mass * 4), 0.85, 0.995) : 0.985);
        if (this.onSmash) this.onSmash(o, phys, sp);
      }
    }
    return impact;
  }

  // Distance from (x, z) at height y to the nearest static shape (negative inside), up to max.
  clearance(x, z, y, max = 4) {
    const cand = this.query(this.grid, this.statics, x, z, max, (this._clear ||= []));
    let best = max;
    for (const i of cand) {
      const s = this.statics[i];
      if (y + 1 < s.y0 || y > s.y1) continue;
      let d;
      if (s.type === 0) d = Math.hypot(s.x - x, s.z - z) - s.r;
      else {
        const u = Math.abs((x - s.x) * s.c + (z - s.z) * s.s) - s.hx,
          v = Math.abs(-(x - s.x) * s.s + (z - s.z) * s.c) - s.hz;
        d = u > 0 && v > 0 ? Math.hypot(u, v) : Math.max(u, v);
      }
      best = Math.min(best, d);
    }
    return best;
  }

  // How far a car of radius `rad` at height `y` can move along (x0, z0) -> (x1, z1) before
  // touching static geometry, as a fraction 0..1 (1 = clear). Shapes it already touches at
  // the start are ignored, so a car sliding along a wall keeps sliding. (Other players'
  // predicted paths stop at walls instead of running through them; see net.js.)
  sweep(x0, z0, x1, z1, rad, y) {
    const dx = x1 - x0,
      dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) return 1;
    const cand = this.query(this.grid, this.statics, x0 + dx / 2, z0 + dz / 2, len / 2 + rad, (this._sweep ||= []));
    let best = 1;
    for (const i of cand) {
      const s = this.statics[i];
      if (y < s.y0 - 0.5 || y > s.y1 + 0.5) continue;
      const t = s.type === 0 ? enterCircle(x0 - s.x, z0 - s.z, dx, dz, s.r + rad) : enterBox(x0 - s.x, z0 - s.z, dx, dz, s, rad);
      if (t < best) best = t;
    }
    return best;
  }
}

// First t in [0, 1] at which the point (px, pz) + t (dx, dz) enters a circle of radius R
// around the origin; Infinity if it never does or starts inside.
function enterCircle(px, pz, dx, dz, R) {
  const c = px * px + pz * pz - R * R;
  if (c <= 0) return Infinity;
  const a = dx * dx + dz * dz,
    b = 2 * (px * dx + pz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0 || b >= 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t <= 1 ? t : Infinity;
}

// ... the same for a static prism grown by R, in its own frame (u along hx, v along hz)
function enterBox(px, pz, dx, dz, st, R) {
  const c = st.c,
    s = st.s;
  const u = px * c + pz * s,
    v = -px * s + pz * c;
  const du = dx * c + dz * s,
    dv = -dx * s + dz * c;
  const hu = st.hx + R,
    hv = st.hz + R;
  if (Math.abs(u) <= hu && Math.abs(v) <= hv) return Infinity;
  let t0 = 0,
    t1 = 1;
  if (Math.abs(du) < 1e-9) {
    if (Math.abs(u) > hu) return Infinity;
  } else {
    const a = (-hu - u) / du,
      b = (hu - u) / du;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (Math.abs(dv) < 1e-9) {
    if (Math.abs(v) > hv) return Infinity;
  } else {
    const a = (-hv - v) / dv,
      b = (hv - v) / dv;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? t0 : Infinity;
}

// Kept for callers that want the old footprint description.
export function vehicleBox(phys) {
  const sh = _shapeA.update(phys);
  return { cx: sh.c.x, cy: sh.c.y, cz: sh.c.z, R: sh.bound };
}

// Impulse response against a fixed obstacle. Records impact, scraping and damage on phys.
function respond(phys, hit, restitution, friction) {
  const n = hit.n;
  // push out of the obstacle (vertical push-down is limited so walls can't pin a car)
  const push = hit.depth * 0.9;
  phys.pos.x += n.x * push;
  phys.pos.z += n.z * push;
  phys.pos.y += n.y * push * (n.y < 0 ? 0.3 : 1);
  _p.copy(hit.p);
  _r.subVectors(_p, phys.pos);
  _v.crossVectors(phys.angVel, _r).add(phys.vel);
  const vn = _v.dot(n);
  _t.copy(_v).addScaledVector(n, -vn);
  const vt = _t.length();
  // sliding along the obstacle: scrape (sparks + sound)
  if (vt > 2.5 && vn > -6) phys.noteScrape?.(_p, vt);
  if (vn >= 0) return 0;
  const k = phys.invMassAt(_p, n);
  const j = (-(1 + restitution) * vn) / k;
  _J.copy(n).multiplyScalar(j);
  if (vt > 1e-3) {
    _t.divideScalar(vt);
    const kt = phys.invMassAt(_p, _t);
    const jt = Math.min(friction * j, vt / kt);
    _J.addScaledVector(_t, -jt);
  }
  phys.applyImpulse(_J, _p);
  phys.addDamage?.(_p, -vn);
  return -vn;
}

// Vehicle vs vehicle (b may be kinematic). Returns impact speed.
export function resolveVehiclePair(a, b, bIsKinematic = false) {
  const A = _shapeA.update(a);
  const B = _shapeB.update(b);
  const dx = A.c.x - B.c.x,
    dy = A.c.y - B.c.y,
    dz = A.c.z - B.c.z;
  const reach = A.bound + B.bound;
  if (dx * dx + dy * dy + dz * dz > reach * reach) return 0;
  // deepest contact from either car's sample points against the other's rounded box
  let best = samplesVsCar(A, B, _hit, 0); // normal from B toward A
  if (best > 0) {
    _pairN.copy(_hit.n);
    _p.copy(_hit.p);
  }
  const bestB = samplesVsCar(B, A, _hit2, best); // normal from A toward B
  if (bestB > best) {
    best = bestB;
    _pairN.copy(_hit2.n).negate();
    _p.copy(_hit2.p);
  }
  if (best <= 0) return 0;
  _n.copy(_pairN);
  const totalInv = 1 / a.mass + (bIsKinematic ? 0 : 1 / b.mass);
  const shareA = 1 / a.mass / totalInv;
  // separate horizontally (cars don't get lifted by each other's push-out)
  const hn = Math.hypot(_n.x, _n.z) || 1;
  a.pos.x += (_n.x / hn) * best * shareA;
  a.pos.z += (_n.z / hn) * best * shareA;
  if (!bIsKinematic) {
    b.pos.x -= (_n.x / hn) * best * (1 - shareA);
    b.pos.z -= (_n.z / hn) * best * (1 - shareA);
  }
  // relative velocity at the contact
  _r.subVectors(_p, a.pos);
  _v.crossVectors(a.angVel, _r).add(a.vel);
  _r2.subVectors(_p, b.pos);
  _vb.crossVectors(b.angVel, _r2).add(b.vel);
  _v.sub(_vb);
  const vn = _v.dot(_n);
  _t.copy(_v).addScaledVector(_n, -vn);
  const vt = _t.length();
  if (vt > 3 && vn > -5) {
    a.noteScrape?.(_p, vt);
    if (!bIsKinematic) b.noteScrape?.(_p, vt);
  }
  if (vn >= 0) return 0;
  const e = 0.25;
  const k = a.invMassAt(_p, _n) + (bIsKinematic ? 0 : b.invMassAt(_p, _n));
  const j = (-(1 + e) * vn) / k;
  _J.copy(_n).multiplyScalar(j);
  if (vt > 1e-3) {
    _t.divideScalar(vt);
    _J.addScaledVector(_t, -Math.min(0.3 * j, (vt / k) * 0.5));
  }
  a.applyImpulse(_J, _p);
  a.addDamage?.(_p, -vn);
  if (!bIsKinematic) {
    _J.negate();
    b.applyImpulse(_J, _p);
    b.addDamage?.(_p, -vn);
  }
  return -vn;
}
