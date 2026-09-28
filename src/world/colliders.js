// Static collision world (trees, rocks, buildings, rails) + smashable props,
// with impulse-based responses for vehicles (2.5D: oriented boxes in XZ + height ranges).
import * as THREE from 'three';
import { clamp } from '../core/math.js';

const CELL = 8;
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _r = new THREE.Vector3();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _J = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _c = new THREE.Vector3();

export class CollisionWorld {
  constructor() {
    this.statics = [];
    this.grid = new Map();
    this.smash = [];
    this.smashGrid = new Map();
    this.onSmash = null;
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
    this.statics.push({ type: 0, x, z, r, y0, y1, kind });
    this.insert(this.grid, idx, x - r, z - r, x + r, z + r);
  }

  addBox(x, z, hx, hz, rot, y0, y1, kind = 'building') {
    const idx = this.statics.length;
    const c = Math.cos(rot),
      s = Math.sin(rot);
    this.statics.push({ type: 1, x, z, hx, hz, c, s, y0, y1, kind });
    const R = Math.hypot(hx, hz);
    this.insert(this.grid, idx, x - R, z - R, x + R, z + R);
  }

  addSegment(x1, z1, x2, z2, r, y0, y1, kind = 'rail') {
    const idx = this.statics.length;
    this.statics.push({ type: 2, x1, z1, x2, z2, r, y0, y1, kind });
    this.insert(this.grid, idx, Math.min(x1, x2) - r, Math.min(z1, z2) - r, Math.max(x1, x2) + r, Math.max(z1, z2) + r);
  }

  addSmashable(obj) {
    // obj: { x, z, r, y, kind, alive, onSmash? }
    const idx = this.smash.length;
    obj.alive = true;
    this.smash.push(obj);
    this.insert(this.smashGrid, idx, obj.x - obj.r, obj.z - obj.r, obj.x + obj.r, obj.z + obj.r);
    return idx;
  }

  query(grid, x, z, r, out) {
    out.length = 0;
    const x0 = Math.floor((x - r) / CELL),
      x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL),
      z1 = Math.floor((z + r) / CELL);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const a = grid.get(this.key(cx, cz));
        if (a) for (const i of a) if (!out.includes(i)) out.push(i);
      }
    return out;
  }

  // Resolve a vehicle against static geometry. Returns max impact speed (m/s).
  resolveVehicle(phys) {
    const box = vehicleBox(phys);
    const cand = this.query(this.grid, box.cx, box.cz, box.R, this._cand || (this._cand = []));
    let impact = 0;
    for (const i of cand) {
      const s = this.statics[i];
      if (box.y1 < s.y0 || box.y0 > s.y1) continue;
      let hit = null;
      if (s.type === 0) hit = circleVsBox(s.x, s.z, s.r, box);
      else if (s.type === 1) hit = obbVsBox(s, box);
      else if (s.type === 2) hit = segmentVsBox(s, box);
      if (hit) {
        const imp = respond(phys, hit, box, s.kind === 'rail' ? 0.12 : 0.18, s.kind === 'rail' ? 0.18 : 0.5);
        impact = Math.max(impact, imp);
      }
    }
    // smashables
    const sc = this.query(this.smashGrid, box.cx, box.cz, box.R, this._scand || (this._scand = []));
    for (const i of sc) {
      const o = this.smash[i];
      if (!o.alive) continue;
      if (Math.abs(o.y - box.cy) > 4) continue;
      if (circleVsBox(o.x, o.z, o.r, box)) {
        o.alive = false;
        const sp = phys.vel.length();
        phys.vel.multiplyScalar(o.mass ? clamp(1 - o.mass / (phys.mass * 4), 0.85, 0.995) : 0.985);
        if (this.onSmash) this.onSmash(o, phys, sp);
      }
    }
    return impact;
  }
}

// Car footprint (XZ OBB) + vertical range
export function vehicleBox(phys) {
  _fwd.set(0, 0, 1).applyQuaternion(phys.quat);
  _fwd.y = 0;
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, 1);
  _fwd.normalize();
  _c.copy(phys.boxCenterLocal).applyQuaternion(phys.quat).add(phys.pos);
  const he = phys.halfExtents;
  return {
    cx: _c.x,
    cy: _c.y,
    cz: _c.z,
    fx: _fwd.x,
    fz: _fwd.z,
    lx: _fwd.z,
    lz: -_fwd.x,
    hl: he.z,
    hw: he.x,
    y0: _c.y - he.y,
    y1: _c.y + he.y,
    R: Math.hypot(he.x, he.z) + 1,
  };
}

// circle (static) vs car box. Returns { nx, nz, depth, px, pz } with n pointing from obstacle to car.
function circleVsBox(x, z, r, b) {
  const dx = x - b.cx,
    dz = z - b.cz;
  const lx = dx * b.lx + dz * b.lz; // along car's left
  const lz = dx * b.fx + dz * b.fz; // along car's forward
  const qx = clamp(lx, -b.hw, b.hw),
    qz = clamp(lz, -b.hl, b.hl);
  const ex = lx - qx,
    ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 > r * r) return null;
  let nlx, nlz, depth;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    nlx = -ex / d;
    nlz = -ez / d;
    depth = r - d;
  } else {
    const px = b.hw - Math.abs(lx),
      pz = b.hl - Math.abs(lz);
    if (px < pz) {
      nlx = lx > 0 ? -1 : 1;
      nlz = 0;
      depth = px + r;
    } else {
      nlx = 0;
      nlz = lz > 0 ? -1 : 1;
      depth = pz + r;
    }
  }
  return {
    nx: nlx * b.lx + nlz * b.fx,
    nz: nlx * b.lz + nlz * b.fz,
    depth,
    px: b.cx + qx * b.lx + qz * b.fx,
    pz: b.cz + qx * b.lz + qz * b.fz,
  };
}

// static OBB vs car box via corner tests (both ways), returns deepest contact
function obbVsBox(s, b) {
  let best = null;
  // car corners inside the static box
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = b.cx + sx * b.hw * b.lx + sz * b.hl * b.fx;
      const pz = b.cz + sx * b.hw * b.lz + sz * b.hl * b.fz;
      const dx = px - s.x,
        dz = pz - s.z;
      const u = dx * s.c + dz * s.s,
        v = -dx * s.s + dz * s.c;
      const ou = s.hx - Math.abs(u),
        ov = s.hz - Math.abs(v);
      if (ou > 0 && ov > 0) {
        let nx, nz, depth;
        if (ou < ov) {
          const sg = Math.sign(u) || 1;
          nx = s.c * sg;
          nz = s.s * sg;
          depth = ou;
        } else {
          const sg = Math.sign(v) || 1;
          nx = -s.s * sg;
          nz = s.c * sg;
          depth = ov;
        }
        if (!best || depth > best.depth) best = { nx, nz, depth, px, pz };
      }
    }
  // static corners inside the car
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const px = s.x + sx * s.hx * s.c - sz * s.hz * s.s;
      const pz = s.z + sx * s.hx * s.s + sz * s.hz * s.c;
      const hit = circleVsBox(px, pz, 0.01, b);
      if (hit && (!best || hit.depth > best.depth)) best = hit;
    }
  return best;
}

function segmentVsBox(s, b) {
  const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
  const n = Math.max(2, Math.ceil(len / 0.5));
  let best = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const hit = circleVsBox(s.x1 + (s.x2 - s.x1) * t, s.z1 + (s.z2 - s.z1) * t, s.r, b);
    if (hit && (!best || hit.depth > best.depth)) best = hit;
  }
  return best;
}

function respond(phys, hit, box, restitution, friction) {
  _n.set(hit.nx, 0, hit.nz).normalize();
  // positional correction
  phys.pos.addScaledVector(_n, hit.depth * 0.9);
  _p.set(hit.px, phys.pos.y, hit.pz);
  _r.subVectors(_p, phys.pos);
  _v.crossVectors(phys.angVel, _r).add(phys.vel);
  const vn = _v.dot(_n);
  if (vn >= 0) return 0;
  const k = phys.invMassAt(_p, _n);
  const j = (-(1 + restitution) * vn) / k;
  _J.copy(_n).multiplyScalar(j);
  // tangential friction
  _t.copy(_v).addScaledVector(_n, -vn);
  const vt = _t.length();
  if (vt > 1e-3) {
    _t.divideScalar(vt);
    const kt = phys.invMassAt(_p, _t);
    const jt = Math.min(friction * j, vt / kt);
    _J.addScaledVector(_t, -jt);
  }
  phys.applyImpulse(_J, _p);
  return -vn;
}

// Vehicle vs vehicle (both dynamic). Returns impact speed.
export function resolveVehiclePair(a, b, bIsKinematic = false) {
  const A = vehicleBox(a);
  const Ab = { ...A };
  const B = vehicleBox(b);
  if (Math.abs(A.cy - B.cy) > 2.5) return 0;
  const dx = A.cx - B.cx,
    dz = A.cz - B.cz;
  if (dx * dx + dz * dz > (A.R + B.R) ** 2) return 0;
  // SAT on 4 axes
  const axes = [
    [Ab.lx, Ab.lz],
    [Ab.fx, Ab.fz],
    [B.lx, B.lz],
    [B.fx, B.fz],
  ];
  let minPen = Infinity,
    nx = 0,
    nz = 0;
  const proj = (bx, ax, az) => Math.abs(bx.hw * (bx.lx * ax + bx.lz * az)) + Math.abs(bx.hl * (bx.fx * ax + bx.fz * az));
  for (const [ax, az] of axes) {
    const dist = Math.abs(dx * ax + dz * az);
    const pen = proj(Ab, ax, az) + proj(B, ax, az) - dist;
    if (pen <= 0) return 0;
    if (pen < minPen) {
      minPen = pen;
      const sg = dx * ax + dz * az >= 0 ? 1 : -1;
      nx = ax * sg;
      nz = az * sg;
    }
  }
  // contact point: midpoint between centres, pushed along n
  _n.set(nx, 0, nz);
  const px = (A.cx + B.cx) / 2,
    pz = (A.cz + B.cz) / 2;
  const totalInv = 1 / a.mass + (bIsKinematic ? 0 : 1 / b.mass);
  const shareA = 1 / a.mass / totalInv;
  a.pos.addScaledVector(_n, minPen * shareA);
  if (!bIsKinematic) b.pos.addScaledVector(_n, -minPen * (1 - shareA));
  _p.set(px, (A.cy + B.cy) / 2, pz);
  // relative velocity at contact
  _r.subVectors(_p, a.pos);
  _v.crossVectors(a.angVel, _r).add(a.vel);
  const _r2 = new THREE.Vector3().subVectors(_p, b.pos);
  const vb = new THREE.Vector3().crossVectors(b.angVel, _r2).add(b.vel);
  _v.sub(vb);
  const vn = _v.dot(_n);
  if (vn >= 0) return 0;
  const e = 0.25;
  const k = a.invMassAt(_p, _n) + (bIsKinematic ? 0 : b.invMassAt(_p, _n));
  const j = (-(1 + e) * vn) / k;
  _J.copy(_n).multiplyScalar(j);
  // friction
  _t.copy(_v).addScaledVector(_n, -vn);
  const vt = _t.length();
  if (vt > 1e-3) {
    _t.divideScalar(vt);
    _J.addScaledVector(_t, -Math.min(0.3 * j, (vt / k) * 0.5));
  }
  a.applyImpulse(_J, _p);
  if (!bIsKinematic) b.applyImpulse(_J.clone().negate(), _p);
  return -vn;
}
