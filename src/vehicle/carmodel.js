// Procedural car model generator.
// Car space: +Z forward, +X left, +Y up, ground at y = 0, z = 0 midway between the axles.
// The body is lofted along Z from key cross-sections derived from side / plan profile curves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { buildRealCar } from './realcar.js';
import { buildImportedCar } from './importedcars.js';

// Monotone cubic interpolation over sorted [x, y] points
export function pchip(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const d = [],
    m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t,
      t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ------------------------------------------------------------------ materials

const matCache = new Map();
export function makePaintMaterial(color, finish = 'gloss') {
  const c = new THREE.Color(color);
  if (finish === 'matte') return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.15, roughness: 0.55, clearcoat: 0.0 });
  if (finish === 'chrome') return new THREE.MeshPhysicalMaterial({ color: c, metalness: 1.0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
  if (finish === 'pearl') return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.6, iridescenceIOR: 1.4, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) });
  return new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.55, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.035, envMapIntensity: 1.15 });
}

function shared(key, make) {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
}

export const SharedMats = {
  glass: () => shared('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x0b1016, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.82, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02 })),
  trim: () => shared('trim', () => new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.2, roughness: 0.55 })),
  gloss: () => shared('glossblack', () => new THREE.MeshPhysicalMaterial({ color: 0x050506, metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })),
  carbon: () => shared('carbon', () => new THREE.MeshPhysicalMaterial({ color: 0x151518, metalness: 0.4, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 })),
  rubber: () => shared('rubber', () => new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.92 })),
  chrome: () => shared('chrome', () => new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.12 })),
  under: () => shared('under', () => new THREE.MeshStandardMaterial({ color: 0x08080a, metalness: 0, roughness: 1 })),
  interior: () => shared('interior', () => new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0, roughness: 0.8 })),
  disc: () => shared('disc', () => new THREE.MeshStandardMaterial({ color: 0x8a8a8a, metalness: 0.9, roughness: 0.45 })),
  plate: () => shared('plate', () => new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0, roughness: 0.5 })),
};

let _plateMat = null;
function plateMaterial() {
  if (_plateMat) return _plateMat;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e7df';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1f3fa8';
  g.fillRect(0, 0, 26, 64);
  g.fillStyle = '#16161a';
  g.font = '700 40px "Barlow Condensed", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('HRZN 026', 140, 34);
  g.strokeStyle = '#333';
  g.lineWidth = 3;
  g.strokeRect(2, 2, 252, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _plateMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
  return _plateMat;
}

export function rimMaterial(color) {
  return shared('rim' + color, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 1.0, roughness: 0.28 }));
}
export function caliperMaterial(color) {
  return shared('cal' + color, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.2, roughness: 0.4 }));
}

// ------------------------------------------------------------------ body loft

const SEG = { BOTTOM: 0, SIDE: 1, SHOULDER: 2, GLASS_SIDE: 3, ROOF_EDGE: 4, TOP: 5 };

function sectionKeys(st) {
  const { yb, yBelt, yTop, w, wr } = st;
  const hs = Math.max(0.02, yBelt - yb);
  const gh = Math.max(0.0, yTop - yBelt);
  const wg = Math.min(w * 0.9, Math.max(wr, w * 0.5));
  return [
    [0, yb, SEG.BOTTOM],
    [w * 0.9, yb, SEG.BOTTOM],
    [w * 0.985, yb + Math.min(0.045, hs * 0.2), SEG.SIDE],
    [w, yb + hs * 0.4, SEG.SIDE],
    [w * 0.995, yb + hs * 0.8, SEG.SIDE],
    [w * 0.955, yBelt, SEG.SHOULDER],
    [lerp(w * 0.9, wg, 0.1), yBelt + gh * 0.07 + 0.004, SEG.GLASS_SIDE],
    [lerp(w * 0.9, wg, 0.62), yBelt + gh * 0.58, SEG.GLASS_SIDE],
    [wg, yTop - Math.min(0.045, gh * 0.3 + 0.01), SEG.ROOF_EDGE],
    [wg * 0.55, yTop - 0.004, SEG.TOP],
    [0, yTop, SEG.TOP],
  ];
}

// Catmull-Rom subdivision of the half profile, carrying segment tags
function subdivide(keys, per = 3) {
  const out = [];
  const n = keys.length;
  const g = (i) => keys[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const p0 = g(i - 1),
      p1 = g(i),
      p2 = g(i + 1),
      p3 = g(i + 2);
    const sharp = p1[2] === SEG.SHOULDER; // keep the shoulder crease crisper
    for (let s = 0; s < per; s++) {
      const t = s / per,
        t2 = t * t,
        t3 = t2 * t;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      let x = cr(p0[0], p1[0], p2[0], p3[0]);
      let y = cr(p0[1], p1[1], p2[1], p3[1]);
      if (sharp) {
        x = lerp(p1[0], p2[0], t) * 0.6 + x * 0.4;
        y = lerp(p1[1], p2[1], t) * 0.6 + y * 0.4;
      }
      out.push([x, y, s === 0 ? p1[2] : p1[2] === SEG.SHOULDER ? SEG.GLASS_SIDE : p1[2]]);
    }
  }
  out.push(keys[n - 1].slice());
  // make the outline monotonic in x towards the top so the loft never folds
  return out;
}

export function buildBody(style) {
  const S = style;
  const L = S.L;
  const zR = -S.WB / 2 - S.ro,
    zF = S.WB / 2 + S.fo;
  const top = pchip(S.top);
  const belt = pchip(S.belt);
  const width = pchip(S.width);
  const roofW = pchip(S.roofW);
  const wheelZ = [S.WB / 2, -S.WB / 2];
  const wheelR = [S.wheelR, S.wheelRr ?? S.wheelR];
  const archR = wheelR.map((r) => r + (S.archGap ?? 0.055));
  const stations = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    // denser sampling near the ends
    const u = i / N;
    const uu = 0.5 - 0.5 * Math.cos(u * Math.PI);
    const z = lerp(zR, zF, lerp(u, uu, 0.45));
    stations.push(z);
  }
  // extra stations right at the arch edges for clean cut-outs
  for (let k = 0; k < 2; k++) for (const e of [-1, -0.7, -0.35, 0, 0.35, 0.7, 1]) stations.push(wheelZ[k] + e * archR[k] * 1.02);
  stations.sort((a, b) => a - b);
  const zs = stations.filter((z, i) => i === 0 || z - stations[i - 1] > 0.004);

  const rings = [];
  const ringTags = [];
  const noseP = S.noseP ?? 5,
    tailP = S.tailP ?? 6;
  for (const z of zs) {
    const u = z >= 0 ? z / zF : -z / -zR;
    const p = z >= 0 ? noseP : tailP;
    const plan = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, u), p)), 1 / p);
    const minW = z >= 0 ? S.noseMinW ?? 0.42 : S.tailMinW ?? 0.55;
    const w = width(z) * lerp(minW, 1, plan);
    let yTop = top(z);
    const inCab = z < S.cabin.a && z > S.cabin.d;
    let yBelt = Math.min(belt(z), inCab ? yTop - 0.015 : yTop + (S.fenderRise ?? 0.02));
    let yb = S.sill;
    // front/rear bumper lower lip rises at the very ends
    const endRise = z >= 0 ? S.noseLift ?? 0.12 : S.tailLift ?? 0.14;
    yb += endRise * Math.pow(smoothstep(0.82, 1.0, u), 1.5);
    // wheel arches
    for (let k = 0; k < 2; k++) {
      const dz = z - wheelZ[k];
      if (Math.abs(dz) < archR[k]) {
        const archY = wheelR[k] + Math.sqrt(archR[k] * archR[k] - dz * dz);
        yb = Math.max(yb, archY);
      }
    }
    yb = Math.min(yb, yBelt - 0.04);
    const wr = Math.min(roofW(z), w * 0.86);
    const keys = sectionKeys({ yb, yBelt, yTop, w, wr });
    const half = subdivide(keys, 3);
    rings.push({ z, half, yb, yBelt, yTop, w });
  }
  // rounded end domes: shrink the end sections toward their centre so the caps shade smoothly
  const dome = (ring, dir, depth) => {
    const ys = ring.half.map((p) => p[1]);
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const out = [];
    const K = 6;
    for (let k = 1; k <= K; k++) {
      // quarter-circle profile: tangent-continuous with the body sides
      const th = (k / K) * Math.PI * 0.5 * 0.94;
      const sc = Math.cos(th);
      const zz = ring.z + dir * depth * Math.sin(th);
      out.push({ ...ring, z: zz, half: ring.half.map(([x, y, tg]) => [x * sc, cy + (y - cy) * sc, tg]), yb: cy + (ring.yb - cy) * sc, yTop: cy + (ring.yTop - cy) * sc });
    }
    return out;
  };
  const rearDome = dome(rings[0], -1, S.tailRound ?? 0.1).reverse();
  const frontDome = dome(rings[rings.length - 1], 1, S.noseRound ?? 0.12);
  rings.unshift(...rearDome);
  rings.push(...frontDome);
  // Build full ring: right half (x negative = right side since +X is left) bottom->top, then left half top->bottom
  const H = rings[0].half.length;
  const ringLen = (H - 1) * 2; // shared bottom/top centre points
  const pos = [],
    tag = [],
    zTag = [];
  for (const r of rings) {
    for (let j = 0; j < H; j++) {
      pos.push(-r.half[j][0], r.half[j][1], r.z);
      tag.push(r.half[j][2]);
      zTag.push(r.z);
    }
    for (let j = H - 2; j >= 1; j--) {
      pos.push(r.half[j][0], r.half[j][1], r.z);
      tag.push(r.half[j][2]);
      zTag.push(r.z);
    }
  }
  const cab = S.cabin; // {a: windshield base z, b: roof front, c: roof rear, d: rear glass base}
  const bPillar = S.bPillar ?? (cab.b + cab.c) / 2;
  const groups = { paint: [], glass: [], trim: [] };
  const classify = (t, z, isTop) => {
    const inCabin = z < cab.a - 0.02 && z > cab.d + 0.02;
    if (!inCabin) return 'paint';
    if (t === SEG.GLASS_SIDE) {
      if (Math.abs(z - bPillar) < (S.bPillarW ?? 0.05)) return 'trim';
      if (z > cab.a - 0.13) return S.pillarColor ?? 'trim'; // A-pillar base region
      if (z < cab.d + (cab.c - cab.d) * (S.cPillar ?? 0.35)) return S.pillarColor ?? 'paint';
      return 'glass';
    }
    if (t === SEG.ROOF_EDGE) {
      if ((z < cab.a - 0.03 && z > cab.b) || (z < cab.c && z > cab.d)) return S.pillarColor ?? 'trim';
      return S.roofColor ?? 'paint';
    }
    if (t === SEG.TOP) {
      if (z < cab.a - 0.03 && z > cab.b + 0.01) return 'glass'; // windshield
      if (z < cab.c - 0.01 && z > cab.d + 0.03) return S.rearGlass === false ? 'paint' : 'glass';
      return S.roofColor ?? 'paint';
    }
    return 'paint';
  };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < ringLen; j++) {
      const a = i * ringLen + j,
        b = i * ringLen + ((j + 1) % ringLen);
      const c = (i + 1) * ringLen + j,
        d = (i + 1) * ringLen + ((j + 1) % ringLen);
      // tag of the face = tag of the lower index point along the half profile
      const jj = j < H - 1 ? j : ringLen - j - 1;
      const t = tag[i * ringLen + (j < H - 1 ? j : (j + 1) % ringLen)];
      const tt = j < H - 1 ? rings[i].half[jj][2] : rings[i].half[Math.max(0, ringLen - j - 1)][2];
      const zc = (rings[i].z + rings[i + 1].z) / 2;
      const cls = classify(j < H - 1 ? rings[i].half[j][2] : rings[i].half[ringLen - j - 1][2], zc, false);
      void t;
      void tt;
      groups[cls].push(a, c, b, b, c, d);
    }
  }
  // end caps
  const capIdx = (ringIndex, flip) => {
    const base = ringIndex * ringLen;
    const r = rings[ringIndex];
    const cy = (r.yb + r.yTop) / 2;
    const ci = pos.length / 3;
    pos.push(0, cy, r.z + (flip ? -0.012 : 0.012));
    tag.push(SEG.SIDE);
    for (let j = 0; j < ringLen; j++) {
      const a = base + j,
        b = base + ((j + 1) % ringLen);
      if (flip) groups.paint.push(ci, a, b);
      else groups.paint.push(ci, b, a);
    }
  };
  capIdx(0, true);
  capIdx(rings.length - 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const index = [];
  const order = ['paint', 'glass', 'trim'];
  let start = 0;
  for (let gi = 0; gi < order.length; gi++) {
    const arr = groups[order[gi]];
    index.push(...arr);
    geo.addGroup(start, arr.length, gi);
    start += arr.length;
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  // decide winding: normal at the roof centre must point up
  const n = geo.attributes.normal;
  const midRing = Math.floor(rings.length / 2);
  const topIdx = midRing * ringLen + (H - 1);
  if (n.getY(topIdx) < 0) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    geo.computeVertexNormals();
  }
  // flatten the shading of the end domes (removes pyramid ridges on bumpers)
  {
    const nrm = geo.attributes.normal;
    const K = rearDome.length;
    const nR = rings.length;
    const blend = (ri, b, dz) => {
      for (let j = 0; j < ringLen; j++) {
        const vi = ri * ringLen + j;
        const x = nrm.getX(vi) * (1 - b),
          y = nrm.getY(vi) * (1 - b),
          z = nrm.getZ(vi) * (1 - b) + dz * b;
        const l = Math.hypot(x, y, z) || 1;
        nrm.setXYZ(vi, x / l, y / l, z / l);
      }
    };
    for (let i = 0; i < K; i++) blend(i, Math.pow(1 - i / K, 0.7), -1);
    for (let j = 0; j < K; j++) blend(nR - K + j, Math.pow((j + 1) / K, 0.7), 1);
    const last = nrm.count;
    nrm.setXYZ(last - 2, 0, 0, -1);
    nrm.setXYZ(last - 1, 0, 0, 1);
    nrm.needsUpdate = true;
  }
  geo.computeBoundingBox();
  const zRearFace = zR - (S.tailRound ?? 0.1),
    zFrontFace = zF + (S.noseRound ?? 0.12);
  return { geo, rings, top, belt, width, zR, zF, ringLen, H, zRearFace, zFrontFace };
}

// Sample the body surface: side = +1 (left) / -1 (right), v in [0,1] along the half profile
export function bodyPoint(body, z, side, v) {
  const { rings } = body;
  let i = 0;
  while (i < rings.length - 2 && rings[i + 1].z < z) i++;
  const r0 = rings[i],
    r1 = rings[i + 1];
  const t = clamp((z - r0.z) / (r1.z - r0.z || 1), 0, 1);
  const H = r0.half.length;
  const f = v * (H - 1);
  const j = Math.min(H - 2, Math.floor(f)),
    ft = f - j;
  const px = lerp(lerp(r0.half[j][0], r0.half[j + 1][0], ft), lerp(r1.half[j][0], r1.half[j + 1][0], ft), t);
  const py = lerp(lerp(r0.half[j][1], r0.half[j + 1][1], ft), lerp(r1.half[j][1], r1.half[j + 1][1], ft), t);
  return new THREE.Vector3(px * side, py, z);
}

// position + outward normal on the body surface
export function bodyFrame(body, z, side, v) {
  const p = bodyPoint(body, z, side, v);
  const dz = 0.02,
    dv = 0.01;
  const a = bodyPoint(body, z + dz, side, v),
    b = bodyPoint(body, z - dz, side, v);
  const c = bodyPoint(body, z, side, Math.min(1, v + dv)),
    d = bodyPoint(body, z, side, Math.max(0, v - dv));
  const tz = a.sub(b),
    tv = c.sub(d);
  const n = new THREE.Vector3().crossVectors(tz, tv).normalize();
  if (side < 0) n.negate();
  // make sure it points away from the car centre line
  const out = new THREE.Vector3(p.x, p.y - 0.5, 0);
  if (n.dot(out) < 0 && Math.abs(n.z) < 0.7) n.negate();
  return { p, n };
}

function placeFlush(mesh, frame, lift = 0.004) {
  mesh.position.copy(frame.p).addScaledVector(frame.n, lift);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.n);
  mesh.quaternion.copy(q);
}

// ------------------------------------------------------------------ wheels

const wheelGeoCache = new Map();
function wheelGeometries(radius, width, rimStyle, spokes) {
  const key = `${radius.toFixed(3)}_${width.toFixed(3)}_${rimStyle}_${spokes}`;
  if (wheelGeoCache.has(key)) return wheelGeoCache.get(key);
  const r = radius,
    w = width;
  const rimR = r * (rimStyle === 'offroad' ? 0.6 : 0.7);
  // tyre: lathe profile in (radius, axial) around Y, then rotate so axis = X
  const prof = [];
  const sidewall = r - rimR;
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI;
    const bulge = Math.sin(a);
    const rr = rimR + sidewall * (0.5 - 0.5 * Math.cos(a)) * 0.98 + 0.004;
    const yy = (-w / 2) * Math.cos(a) * (0.92 + 0.08 * bulge);
    prof.push(new THREE.Vector2(i === 0 || i === steps ? rimR : Math.max(rimR, rr + (rr > r - sidewall * 0.35 ? 0 : 0)), yy));
  }
  // flatten the tread
  const tread = [];
  tread.push(new THREE.Vector2(rimR * 0.98, -w / 2 + 0.01));
  tread.push(new THREE.Vector2(r - sidewall * 0.35, -w / 2));
  tread.push(new THREE.Vector2(r - 0.012, -w / 2 + 0.02));
  tread.push(new THREE.Vector2(r, -w / 2 + 0.05));
  tread.push(new THREE.Vector2(r, w / 2 - 0.05));
  tread.push(new THREE.Vector2(r - 0.012, w / 2 - 0.02));
  tread.push(new THREE.Vector2(r - sidewall * 0.35, w / 2));
  tread.push(new THREE.Vector2(rimR * 0.98, w / 2 - 0.01));
  const tyre = new THREE.LatheGeometry(tread, 36);
  tyre.rotateZ(Math.PI / 2);
  // rim barrel + face
  const barrel = new THREE.CylinderGeometry(rimR * 0.98, rimR * 0.98, w * 0.92, 28, 1, true);
  barrel.rotateZ(Math.PI / 2);
  const face = [];
  const lip = new THREE.TorusGeometry(rimR * 0.96, 0.012, 6, 36);
  lip.rotateY(Math.PI / 2);
  lip.translate(w * 0.4, 0, 0);
  face.push(lip);
  const hub = new THREE.CylinderGeometry(rimR * 0.2, rimR * 0.24, 0.06, 16);
  hub.rotateZ(Math.PI / 2);
  hub.translate(w * 0.34, 0, 0);
  face.push(hub);
  const nSp = spokes;
  for (let k = 0; k < nSp; k++) {
    const a = (k / nSp) * Math.PI * 2;
    let sp;
    if (rimStyle === 'mesh') {
      sp = new THREE.BoxGeometry(0.02, rimR * 0.78, 0.022);
      sp.translate(0, rimR * 0.52, 0);
      sp.rotateX(a);
      sp.rotateX(0.25);
    } else if (rimStyle === 'turbine') {
      sp = new THREE.BoxGeometry(0.03, rimR * 0.72, 0.07);
      sp.translate(0, rimR * 0.55, 0);
      sp.rotateY(0.5);
      sp.rotateX(a);
    } else if (rimStyle === 'offroad') {
      sp = new THREE.BoxGeometry(0.05, rimR * 0.62, 0.1);
      sp.translate(0, rimR * 0.5, 0);
      sp.rotateX(a);
    } else {
      // split five-spoke / multi-spoke
      sp = new THREE.BoxGeometry(0.035, rimR * 0.78, rimStyle === 'split' ? 0.03 : 0.055);
      sp.translate(0, rimR * 0.52, rimStyle === 'split' ? 0.022 : 0);
      sp.rotateX(a);
      if (rimStyle === 'split') {
        const sp2 = new THREE.BoxGeometry(0.035, rimR * 0.78, 0.03);
        sp2.translate(0, rimR * 0.52, -0.022);
        sp2.rotateX(a);
        sp2.translate(w * 0.32, 0, 0);
        face.push(sp2);
      }
    }
    sp.translate(w * 0.32, 0, 0);
    face.push(sp);
  }
  const rimFace = mergeGeometries(face.map((g) => (g.index ? g.toNonIndexed() : g)));
  const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.03, 24);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-w * 0.05, 0, 0);
  const caliper = new THREE.BoxGeometry(0.07, rimR * 0.55, rimR * 0.3);
  caliper.translate(w * 0.06, rimR * 0.55, 0);
  const out = { tyre, barrel, rimFace, disc, caliper, rimR };
  wheelGeoCache.set(key, out);
  return out;
}

export function buildWheel(radius, width, opts, side) {
  const g = wheelGeometries(radius, width, opts.rimStyle ?? 'fivespoke', opts.spokes ?? 5);
  const spin = new THREE.Group(); // rotates with the wheel
  const tyre = new THREE.Mesh(g.tyre, SharedMats.rubber());
  const barrel = new THREE.Mesh(g.barrel, rimMaterial(opts.rimColor ?? '#b8b8b8'));
  const face = new THREE.Mesh(g.rimFace, rimMaterial(opts.rimColor ?? '#b8b8b8'));
  const disc = new THREE.Mesh(g.disc, SharedMats.disc());
  spin.add(tyre, barrel, face, disc);
  tyre.castShadow = true;
  face.castShadow = true;
  // mirror so the rim face points outward
  if (side < 0) spin.scale.x = -1;
  const caliper = new THREE.Mesh(g.caliper, caliperMaterial(opts.caliperColor ?? '#d01c1c'));
  if (side < 0) caliper.scale.x = -1;
  const steer = new THREE.Group(); // steers, holds the caliper (doesn't spin)
  steer.add(spin, caliper);
  return { steer, spin };
}

// ------------------------------------------------------------------ lights & details

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2,
    y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function lampMesh(w, h, depth, mat) {
  const g = new THREE.ExtrudeGeometry(roundedRectShape(w, h, Math.min(w, h) * 0.45), { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth);
  return new THREE.Mesh(g, mat);
}

function wingGeometry(span, chord, thick) {
  const s = new THREE.Shape();
  s.moveTo(-chord / 2, 0);
  s.quadraticCurveTo(-chord * 0.2, thick * 1.4, chord / 2, thick * 0.3);
  s.lineTo(chord / 2, -thick * 0.1);
  s.quadraticCurveTo(0, -thick * 0.2, -chord / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -span / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// ------------------------------------------------------------------ full car

export function buildCar(style, paint = {}) {
  const S = style;
  if (S.visualAsset) {
    const paintMat = makePaintMaterial(paint.color ?? S.defaultColor ?? '#c81d25', paint.finish ?? 'gloss');
    const detailed = S.visualAsset === 'ferrari-458' ? buildRealCar(S, paint, paintMat) : buildImportedCar(S, paint, paintMat);
    if (detailed) return detailed;
    paintMat.dispose();
  }
  const group = new THREE.Group();
  group.name = 'car';
  const paintMat = makePaintMaterial(paint.color ?? S.defaultColor ?? '#c81d25', paint.finish ?? 'gloss');
  const body = buildBody(S);
  const bodyMesh = new THREE.Mesh(body.geo, [paintMat, SharedMats.glass(), S.trimGloss ? SharedMats.gloss() : SharedMats.trim()]);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const zF = body.zF,
    zR = body.zR;
  const halfW = (z) => body.width(z);
  const lights = { head: [], tail: [], brake: [], reverse: [] };

  // --- underbody / chassis tub & wheel wells
  const tw = Math.min(S.trackF, S.trackR) - (S.wheelW ?? 0.26) - 0.08;
  const tub = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.28, S.WB + S.fo * 0.8 + S.ro * 0.8), SharedMats.under());
  tub.position.set(0, S.sill + 0.1, (S.fo - S.ro) * 0.4);
  group.add(tub);
  for (const [k, z] of [
    [0, S.WB / 2],
    [1, -S.WB / 2],
  ]) {
    const r = (k === 0 ? S.wheelR : S.wheelRr ?? S.wheelR) + 0.05;
    const well = new THREE.Mesh(new THREE.CylinderGeometry(r, r, S.W * 0.96, 20, 1, true, Math.PI * 0.5, Math.PI), SharedMats.under());
    well.material = SharedMats.under();
    well.rotation.z = Math.PI / 2;
    well.position.set(0, k === 0 ? S.wheelR : S.wheelRr ?? S.wheelR, z);
    group.add(well);
    const wellMat = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, side: THREE.BackSide });
    well.material = wellMat;
  }

  // --- interior silhouette
  const cab = S.cabin;
  const floorY = S.sill + 0.22;
  const beltMid = body.belt((cab.a + cab.c) / 2);
  const interior = new THREE.Mesh(new THREE.BoxGeometry(halfW((cab.a + cab.c) / 2) * 1.55, Math.max(0.1, beltMid - floorY - 0.04), cab.a - cab.d - 0.25), SharedMats.interior());
  interior.position.set(0, (beltMid + floorY) / 2 - 0.02, (cab.a + cab.d) / 2);
  group.add(interior);
  // seats + dash
  const roofY = body.top((cab.b + cab.c) / 2);
  const seatH = Math.min(0.62, roofY - floorY - 0.2);
  for (const sx of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, seatH, 0.12), SharedMats.interior());
    seat.position.set(sx * halfW(cab.b) * 0.4, floorY + seatH / 2 + 0.05, (cab.b + cab.c) / 2 - 0.15);
    seat.rotation.x = -0.22;
    group.add(seat);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(halfW(cab.a) * 1.6, 0.18, 0.4), SharedMats.interior());
  dash.position.set(0, body.top(cab.a) - 0.12, cab.a - 0.25);
  group.add(dash);

  // --- headlights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xdde8ff), emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.2 });
  const drlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0xffffff), emissiveIntensity: 3, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: new THREE.Color(0xff1010), emissiveIntensity: 1.2, roughness: 0.3 });
  const revMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.0, roughness: 0.3 });
  lights.headMat = headMat;
  lights.tailMat = tailMat;
  lights.revMat = revMat;
  lights.drlMat = drlMat;
  const hl = S.headlight ?? { type: 'slit', w: 0.42, h: 0.1, y: 0.66, inset: 0.28 };
  // find the body parameter v whose height matches the requested lamp height at that station
  const vAtHeight = (z, y, side) => {
    let best = 0.5,
      bd = 1e9;
    for (let v = 0.12; v <= 0.62; v += 0.005) {
      const q = bodyPoint(body, z, side, v);
      const d = Math.abs(q.y - y);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  for (const sd of [-1, 1]) {
    const zL = zF - (hl.back ?? 0.2) + 0.05;
    const v = hl.v ?? vAtHeight(zL, hl.y, sd);
    const fr = bodyFrame(body, zL, sd, v);
    // pull the lamp inboard a little so it sits on the front corner, not the side
    fr.p.x -= sd * (hl.inset ?? 0.28) * 0.35;
    const m = lampMesh(hl.w, hl.h, 0.06, headMat);
    placeFlush(m, fr, 0.012);
    m.rotateZ((sd * (hl.tilt ?? 0.08)));
    group.add(m);
    lights.head.push(m);
    const bezel = lampMesh(hl.w + 0.04, hl.h + 0.035, 0.05, SharedMats.gloss());
    placeFlush(bezel, fr, 0.004);
    bezel.rotateZ(sd * (hl.tilt ?? 0.08));
    group.add(bezel);
    if (hl.type === 'round') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(hl.h * 0.55, 0.012, 6, 20), SharedMats.chrome());
      placeFlush(ring, fr, 0.016);
      group.add(ring);
    }
    if (hl.drl) {
      const d = lampMesh(hl.w * 0.9, 0.016, 0.02, drlMat);
      placeFlush(d, { p: fr.p.clone().add(new THREE.Vector3(0, hl.h * 0.55 + 0.01, 0)), n: fr.n }, 0.014);
      group.add(d);
    }
  }
  // --- tail lights
  const tl = S.taillight ?? { type: 'pair', w: 0.34, h: 0.1, y: 0.82, inset: 0.3 };
  const zRF = body.zRearFace;
  if (tl.type === 'strip') {
    const wStrip = halfW(zR) * 2 * lerp(S.tailMinW ?? 0.55, 1, 0.9) * 0.86;
    const m = lampMesh(wStrip, tl.h, 0.04, tailMat);
    m.position.set(0, tl.y, zRF + 0.004);
    m.rotation.y = Math.PI;
    group.add(m);
    lights.tail.push(m);
  }
  const vAtH = (z, y, side) => {
    let best = 0.5,
      bd = 1e9;
    for (let v = 0.12; v <= 0.62; v += 0.005) {
      const q = bodyPoint(body, z, side, v);
      const d = Math.abs(q.y - y);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  };
  for (const sd of [-1, 1]) {
    const zt = zR - (S.tailRound ?? 0.1) * 0.35;
    const fr = bodyFrame(body, zt, sd, vAtH(zt, tl.y, sd));
    fr.p.x -= sd * (tl.inset ?? 0.3) * 0.3;
    if (tl.type === 'round') {
      for (const off of [0, 0.2]) {
        const m = new THREE.Mesh(new THREE.CircleGeometry(tl.h * 0.6, 20), tailMat);
        placeFlush(m, { p: new THREE.Vector3(fr.p.x - sd * off, fr.p.y, zRF + 0.006), n: new THREE.Vector3(0, 0, -1) }, 0);
        group.add(m);
      }
    } else if (tl.type !== 'strip') {
      const m = lampMesh(tl.w, tl.h, 0.05, tailMat);
      placeFlush(m, fr, 0.01);
      group.add(m);
    }
    const rv = lampMesh(0.1, 0.045, 0.02, revMat);
    placeFlush(rv, { p: new THREE.Vector3(sd * halfW(zR) * 0.42, tl.y - 0.13, zRF + 0.005), n: new THREE.Vector3(0, 0, -1) }, 0);
    group.add(rv);
  }

  // --- grille / intakes
  const gY = S.grilleY ?? S.sill + 0.2;
  const gW = Math.min(S.grilleW ?? halfW(zF) * 1.0, Math.abs(bodyPoint(body, body.zFrontFace - 0.06, 1, 0.3).x) * 2 * 0.9);
  const grille = lampMesh(gW, S.grilleH ?? 0.16, 0.06, SharedMats.gloss());
  grille.position.set(0, gY, body.zFrontFace - 0.025);
  group.add(grille);
  if (S.sideIntake) {
    for (const sd of [-1, 1]) {
      const it = lampMesh(0.55, 0.22, 0.03, SharedMats.gloss());
      const z = -S.WB / 2 + 0.75;
      it.position.set(sd * (halfW(z) + 0.004), S.sill + 0.42, z);
      it.rotation.y = sd * Math.PI * 0.5;
      it.rotation.z = sd * 0.1;
      group.add(it);
    }
  }
  // --- mirrors
  for (const sd of [-1, 1]) {
    const z = cab.a - 0.18;
    const p = bodyPoint(body, z, sd, 0.6);
    const mirGeo = new THREE.SphereGeometry(0.5, 12, 8);
    mirGeo.scale(0.17, 0.1, 0.13);
    const mir = new THREE.Mesh(mirGeo, paintMat);
    mir.position.set(p.x + sd * 0.12, p.y + 0.04, z);
    mir.castShadow = true;
    group.add(mir);
    const glassM = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), SharedMats.chrome());
    glassM.scale.set(1.4, 0.8, 1);
    glassM.position.set(p.x + sd * 0.12, p.y + 0.04, z - 0.066);
    glassM.rotation.y = Math.PI;
    group.add(glassM);
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.04), SharedMats.trim());
    stalk.position.set(p.x + sd * 0.03, p.y + 0.02, z);
    group.add(stalk);
  }
  // --- wing / spoiler
  if (S.wing) {
    const wg = S.wing;
    const span = halfW(wg.z) * 2 * (wg.spanK ?? 0.92);
    const wing = new THREE.Mesh(wingGeometry(span, wg.chord ?? 0.34, 0.07), S.wingPaint ? paintMat : SharedMats.carbon());
    wing.position.set(0, wg.y, wg.z);
    wing.rotation.x = -(wg.angle ?? 0.12);
    wing.castShadow = true;
    group.add(wing);
    for (const sd of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, wg.y - body.top(wg.z) + 0.05, 0.14), SharedMats.carbon());
      post.position.set(sd * span * 0.32, (wg.y + body.top(wg.z)) / 2 - 0.02, wg.z + 0.02);
      group.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, (wg.chord ?? 0.34) + 0.08), SharedMats.carbon());
      plate.position.set(sd * span * 0.5, wg.y + 0.02, wg.z);
      group.add(plate);
    }
  }
  if (S.lipSpoiler) {
    const z = zR + 0.1;
    const lip = new THREE.Mesh(wingGeometry(halfW(z) * 2 * 0.8, 0.14, 0.03), paintMat);
    lip.position.set(0, body.top(z) + 0.015, z + 0.02);
    lip.rotation.x = -0.2;
    group.add(lip);
  }
  if (S.hoodScoop) {
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.6), paintMat);
    const z = (cab.a + zF) / 2 + 0.05;
    sc.position.set(0, body.top(z) + 0.03, z);
    sc.rotation.x = -0.06;
    group.add(sc);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.07), SharedMats.gloss());
    hole.position.set(0, body.top(z) + 0.05, z + 0.301);
    group.add(hole);
  }
  if (S.roofScoop) {
    const z = (cab.b + cab.c) / 2;
    const sc = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.4), paintMat);
    sc.position.set(0, body.top(z) + 0.035, z);
    group.add(sc);
  }
  if (S.lightBar) {
    const z = cab.b - 0.05;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(halfW(z) * 1.3, 0.08, 0.1), SharedMats.trim());
    bar.position.set(0, body.top(z) + 0.1, z);
    group.add(bar);
    for (let k = -3; k <= 3; k++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), headMat);
      l.position.set(k * 0.16, body.top(z) + 0.1, z + 0.052);
      group.add(l);
    }
  }
  if (S.bedCover) {
    // pickup truck bed: dark box on the rear deck
    const z0 = cab.d - 0.05,
      z1 = zR + 0.1;
    const bed = new THREE.Mesh(new THREE.BoxGeometry(halfW((z0 + z1) / 2) * 1.7, 0.04, z0 - z1), SharedMats.trim());
    bed.position.set(0, body.top((z0 + z1) / 2) + 0.005, (z0 + z1) / 2);
    group.add(bed);
  }
  // --- exhausts
  const ex = S.exhaust ?? { n: 2, spread: 0.45, r: 0.045, y: S.sill + 0.12 };
  for (let k = 0; k < ex.n; k++) {
    const x = ex.n === 1 ? 0.3 : lerp(-ex.spread, ex.spread, k / (ex.n - 1));
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(ex.r, ex.r, 0.18, 14, 1, true), SharedMats.chrome());
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, ex.y, body.zRearFace + 0.03);
    group.add(pipe);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(ex.r * 0.85, 14), SharedMats.under());
    inner.position.set(x, ex.y, body.zRearFace - 0.055);
    inner.rotation.y = Math.PI;
    group.add(inner);
  }
  // --- diffuser fins
  if (S.diffuser) {
    for (let k = -2; k <= 2; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.08, 0.36), SharedMats.carbon());
      fin.position.set(k * 0.22, S.sill + (S.tailLift ?? 0.14) + 0.02, zR + 0.1);
      group.add(fin);
    }
  }
  // --- license plates
  if (S.plates !== false) {
    const rp = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), plateMaterial());
    rp.position.set(0, S.plateY ?? S.sill + 0.33, body.zRearFace - 0.004);
    rp.rotation.y = Math.PI;
    group.add(rp);
  }

  // --- wheels
  const wheels = [];
  const wF = S.wheelW ?? 0.26,
    wR = S.wheelWr ?? wF;
  const defs = [
    { x: S.trackF / 2, z: S.WB / 2, r: S.wheelR, w: wF, front: true, side: 1 },
    { x: -S.trackF / 2, z: S.WB / 2, r: S.wheelR, w: wF, front: true, side: -1 },
    { x: S.trackR / 2, z: -S.WB / 2, r: S.wheelRr ?? S.wheelR, w: wR, front: false, side: 1 },
    { x: -S.trackR / 2, z: -S.WB / 2, r: S.wheelRr ?? S.wheelR, w: wR, front: false, side: -1 },
  ];
  for (const d of defs) {
    const wopts = { rimStyle: paint.rimStyle ?? S.rimStyle, spokes: paint.spokes ?? S.spokes, rimColor: paint.rim ?? S.rimColor, caliperColor: paint.caliper ?? S.caliperColor };
    const wh = buildWheel(d.r, d.w, wopts, d.side);
    wh.steer.position.set(d.x, d.r, d.z);
    group.add(wh.steer);
    wheels.push({ ...d, steer: wh.steer, spin: wh.spin, baseY: d.r });
  }
  // merge all static parts per material to keep draw calls low
  const wheelSet = new Set(wheels.map((w) => w.steer));
  const statics = group.children.filter((c) => !wheelSet.has(c));
  const merged = mergeByMaterial(statics, group);
  for (const c of statics) group.remove(c);
  for (const m of merged) group.add(m);
  const paintMesh = merged.find((m) => m.material === paintMat) || merged[0];
  return { group, body: paintMesh, merged, paintMat, wheels, lights, zF, zR, bodyData: body, dispose: () => merged.forEach((m) => m.geometry.dispose()) };
}

// Bake transforms and merge meshes that share a material (splits multi-material geometry groups).
export function mergeByMaterial(objects, root) {
  const buckets = new Map();
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const addPart = (geo, mat, matrix) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    if (matrix.determinant() < 0) {
      // mirrored parts: flip winding
      const p = g.attributes.position,
        n = g.attributes.normal,
        uv = g.attributes.uv;
      for (let i = 0; i < p.count; i += 3) {
        for (const a of [p, n, uv]) {
          const sz = a.itemSize;
          for (let c = 0; c < sz; c++) {
            const t = a.array[(i + 1) * sz + c];
            a.array[(i + 1) * sz + c] = a.array[(i + 2) * sz + c];
            a.array[(i + 2) * sz + c] = t;
          }
        }
      }
    }
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  };
  const visit = (o) => {
    if (o.isMesh) {
      m.multiplyMatrices(inv, o.matrixWorld);
      if (Array.isArray(o.material)) {
        for (const gr of o.geometry.groups) {
          const sub = o.geometry.clone();
          sub.clearGroups();
          const idx = o.geometry.index.array.slice(gr.start, gr.start + gr.count);
          sub.setIndex(Array.from(idx));
          addPart(sub, o.material[gr.materialIndex], m);
        }
      } else addPart(o.geometry, o.material, m);
    }
    for (const c of o.children) visit(c);
  };
  for (const o of objects) visit(o);
  const out = [];
  for (const [mat, geos] of buckets) {
    const g = mergeGeometries(geos);
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}
