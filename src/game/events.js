// Event definitions (races + PR stunts), routes with racing lines, and world markers.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { LOCATIONS } from '../world/worldgen.js';
import { fogUniforms } from '../world/sky.js';
import { PALETTE } from '../config.js';

const G = 9.81;

// ------------------------------------------------------------------ Route
export class Route {
  constructor(points, closed, world) {
    // points: [[x, z, width], ...]
    let pts = [];
    for (const p of points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1.5) pts.push(p);
    }
    pts = cleanRoute(pts, closed);
    if (closed && pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 3) pts.pop();
    this.closed = closed;
    this.world = world;
    this.n = pts.length;
    const n = this.n;
    this.x = new Float32Array(n);
    this.z = new Float32Array(n);
    this.w = new Float32Array(n);
    this.s = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i][0];
      this.z[i] = pts[i][1];
      this.w[i] = pts[i][2] ?? 10;
    }
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.s[i] = acc;
      const j = i + 1 < n ? i + 1 : closed ? 0 : -1;
      if (j >= 0) acc += Math.hypot(this.x[j] - this.x[i], this.z[j] - this.z[i]);
    }
    this.s[n] = acc;
    this.length = acc;
    // tangents / normals
    this.tx = new Float32Array(n);
    this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 1),
        b = this.idx(i + 1);
      const dx = this.x[b] - this.x[a],
        dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
    this.buildRacingLine();
  }

  idx(i) {
    if (this.closed) return ((i % this.n) + this.n) % this.n;
    return clamp(i, 0, this.n - 1);
  }

  buildRacingLine() {
    const n = this.n;
    const lx = Float32Array.from(this.x),
      lz = Float32Array.from(this.z);
    for (let it = 0; it < 90; it++) {
      for (let i = 0; i < n; i++) {
        if (!this.closed && (i < 2 || i > n - 3)) continue;
        const a = this.idx(i - 2),
          b = this.idx(i + 2);
        const tx = (lx[a] + lx[b]) / 2,
          tz = (lz[a] + lz[b]) / 2;
        lx[i] += (tx - lx[i]) * 0.5;
        lz[i] += (tz - lz[i]) * 0.5;
        // constrain inside the road
        const nx = -this.tz[i],
          nz = this.tx[i];
        const lim = Math.max(0.5, this.w[i] / 2 - 1.6);
        let off = (lx[i] - this.x[i]) * nx + (lz[i] - this.z[i]) * nz;
        off = clamp(off, -lim, lim);
        let along = (lx[i] - this.x[i]) * this.tx[i] + (lz[i] - this.z[i]) * this.tz[i];
        along = clamp(along, -1, 1);
        lx[i] = this.x[i] + nx * off + this.tx[i] * along;
        lz[i] = this.z[i] + nz * off + this.tz[i] * along;
      }
    }
    this.lx = lx;
    this.lz = lz;
    this.lineOff = new Float32Array(n);
    for (let i = 0; i < n; i++) this.lineOff[i] = (lx[i] - this.x[i]) * -this.tz[i] + (lz[i] - this.z[i]) * this.tx[i];
    // curvature of the racing line & speed profile
    const curv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.idx(i - 4),
        b = this.idx(i + 4);
      const ax = lx[i] - lx[a],
        az = lz[i] - lz[a];
      const bx = lx[b] - lx[i],
        bz = lz[b] - lz[i];
      const la = Math.hypot(ax, az) || 1,
        lb = Math.hypot(bx, bz) || 1;
      let da = Math.atan2(bz, bx) - Math.atan2(az, ax);
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      curv[i] = da / ((la + lb) / 2);
    }
    this.curv = curv;
    this.baseSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = Math.abs(curv[i]);
      this.baseSpeed[i] = k < 1e-4 ? 120 : Math.min(120, Math.sqrt((1.05 * G) / k));
    }
  }

  // speed profile for a given grip and top speed, with braking passes
  speedProfile(mu = 1, vmax = 90, brake = 7.5) {
    const n = this.n;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.min(vmax, this.baseSpeed[i] * Math.sqrt(mu / 1.05));
    const passes = this.closed ? 2 : 1;
    for (let p = 0; p < passes; p++)
      for (let i = n - 2 + (this.closed ? 1 : 0); i >= 0; i--) {
        const j = this.idx(i + 1);
        const ds = Math.max(0.5, this.segLen(i));
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds));
      }
    return v;
  }

  segLen(i) {
    return this.s[i + 1] - this.s[i];
  }

  // project a point onto the route, searching near a hint index
  project(x, z, hint = -1, window = 40) {
    const n = this.n;
    let best = 1e18,
      bi = 0,
      bt = 0;
    const search = (i0, i1) => {
      for (let k = i0; k <= i1; k++) {
        const i = this.idx(k);
        const j = this.closed ? this.idx(i + 1) : Math.min(n - 1, i + 1);
        if (j === i) continue;
        const ex = this.x[j] - this.x[i],
          ez = this.z[j] - this.z[i];
        const l2 = ex * ex + ez * ez || 1e-9;
        let t = ((x - this.x[i]) * ex + (z - this.z[i]) * ez) / l2;
        t = clamp(t, 0, 1);
        const px = this.x[i] + ex * t,
          pz = this.z[i] + ez * t;
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bt = t;
        }
      }
    };
    if (hint >= 0) search(hint - window, hint + window);
    if (hint < 0 || best > 60 * 60) search(0, n - 1);
    const s = this.s[bi] + (this.s[bi + 1] - this.s[bi]) * bt;
    const lat = (x - (this.x[bi] + (this.x[this.idx(bi + 1)] - this.x[bi]) * bt)) * -this.tz[bi] + (z - (this.z[bi] + (this.z[this.idx(bi + 1)] - this.z[bi]) * bt)) * this.tx[bi];
    return { i: bi, s, dist: Math.sqrt(best), lateral: lat };
  }

  // position at distance s, optionally on the racing line blend (0 = centre, 1 = line) + offset
  pointAt(s, lineBlend = 0, offset = 0, out = {}) {
    const L = this.length;
    if (this.closed) s = ((s % L) + L) % L;
    else s = clamp(s, 0, L - 0.01);
    let lo = 0,
      hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.s[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    const i = lo,
      j = this.closed ? this.idx(i + 1) : Math.min(this.n - 1, i + 1);
    const t = j === i ? 0 : (s - this.s[i]) / (this.s[i + 1] - this.s[i] || 1);
    const cx = lerp(this.x[i], this.x[j], t),
      cz = lerp(this.z[i], this.z[j], t);
    const lxv = lerp(this.lx[i], this.lx[j], t),
      lzv = lerp(this.lz[i], this.lz[j], t);
    const tx = lerp(this.tx[i], this.tx[j], t),
      tz = lerp(this.tz[i], this.tz[j], t);
    const tl = Math.hypot(tx, tz) || 1;
    out.tx = tx / tl;
    out.tz = tz / tl;
    out.x = lerp(cx, lxv, lineBlend) - out.tz * offset;
    out.z = lerp(cz, lzv, lineBlend) + out.tx * offset;
    out.i = i;
    out.w = lerp(this.w[i], this.w[j], t);
    return out;
  }

  // world polyline (for minimap GPS)
  polyline(step = 4) {
    const out = [];
    for (let i = 0; i < this.n; i += step) out.push([this.x[i], this.z[i]]);
    if (this.closed) out.push([this.x[0], this.z[0]]);
    else out.push([this.x[this.n - 1], this.z[this.n - 1]]);
    return out;
  }
}

// Remove direction reversals at road joins and round off the remaining sharp corners.
function cleanRoute(pts, closed) {
  const angleAt = (a, b, c) => {
    const ux = b[0] - a[0],
      uz = b[1] - a[1],
      vx = c[0] - b[0],
      vz = c[1] - b[1];
    const d = (ux * vx + uz * vz) / ((Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1);
    return Math.acos(Math.max(-1, Math.min(1, d)));
  };
  let changed = true,
    guard = 0;
  while (changed && guard++ < 400) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      if (angleAt(pts[i - 1], pts[i], pts[i + 1]) > 1.2) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  // light smoothing (keeps the ends of sprints fixed)
  const n = pts.length;
  for (let it = 0; it < 6; it++) {
    const nx = pts.map((p) => p.slice());
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = pts[(i - 1 + n) % n],
        c = pts[(i + 1) % n];
      nx[i][0] = pts[i][0] * 0.5 + (a[0] + c[0]) * 0.25;
      nx[i][1] = pts[i][1] * 0.5 + (a[1] + c[1]) * 0.25;
    }
    pts = nx;
  }
  return pts;
}

// ------------------------------------------------------------------ builders
function roadByName(net, name) {
  return net.roads.find((r) => r.name === name);
}
function sNear(road, x, z) {
  let best = 1e18,
    bs = 0;
  for (let i = 0; i < road.n; i++) {
    const d = (road.pts[i * 3] - x) ** 2 + (road.pts[i * 3 + 2] - z) ** 2;
    if (d < best) {
      best = d;
      bs = road.s[i];
    }
  }
  return bs;
}
function piece(road, s0, s1, step = 3) {
  const pts = [];
  const dir = s1 >= s0 ? 1 : -1;
  const len = Math.abs(s1 - s0);
  const n = Math.max(2, Math.ceil(len / step));
  const o = {};
  for (let k = 0; k <= n; k++) {
    let s = s0 + dir * (len * k) / n;
    road.pointAt(s, o);
    pts.push([o.x, o.z, road.width]);
  }
  return pts;
}
function filletCorners(pts, radius) {
  // round sharp polyline corners (used for town street circuits)
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n],
      b = pts[i],
      c = pts[(i + 1) % n];
    const d1x = b[0] - a[0],
      d1z = b[1] - a[1],
      l1 = Math.hypot(d1x, d1z);
    const d2x = c[0] - b[0],
      d2z = c[1] - b[1],
      l2 = Math.hypot(d2x, d2z);
    const ang = Math.acos(clamp((d1x * d2x + d1z * d2z) / (l1 * l2), -1, 1));
    if (ang < 0.3) {
      out.push(b);
      continue;
    }
    const r = Math.min(radius, l1 * 0.45, l2 * 0.45);
    const p0 = [b[0] - (d1x / l1) * r, b[1] - (d1z / l1) * r, b[2]];
    const p1 = [b[0] + (d2x / l2) * r, b[1] + (d2z / l2) * r, b[2]];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * b[0] + t * t * p1[0];
      const z = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * b[1] + t * t * p1[1];
      out.push([x, z, b[2]]);
    }
  }
  return out;
}
function densify(pts, step = 3) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 0; k < n; k++) out.push([lerp(a[0], b[0], k / n), lerp(a[1], b[1], k / n), a[2]]);
  }
  return out;
}

export function buildEvents(world) {
  const net = world.network;
  const F = LOCATIONS.festival,
    T = LOCATIONS.town;
  const ring = roadByName(net, 'Costa Ring');
  const hwy = roadByName(net, 'Autopista Isla');
  const via = roadByName(net, 'Via Central');
  const spiral = roadByName(net, 'Volcán Spiral');
  const sierra = roadByName(net, 'Sierra Pass');
  const selva = roadByName(net, 'Selva Trail');
  const granja = roadByName(net, 'Granja Road');
  const runway = roadByName(net, 'Runway 09');
  const races = [];

  // Costa Ring circuit: start near the festival
  {
    const s0 = sNear(ring, F.x + 10, F.z + 300);
    const pts = [...piece(ring, s0, ring.length), ...piece(ring, 0, s0)];
    races.push({ id: 'ring', name: 'Costa Ring Circuit', type: 'circuit', series: 'Road Racing', laps: 1, closed: true, pts, ai: 7, desc: 'A full lap of the island on the coastal ring road.' });
  }
  // Festival circuit: Granja -> Autopista -> Via Central back to the festival
  {
    const jw = sNear(hwy, -780, 250),
      jc = sNear(hwy, 60, 200);
    const vjc = sNear(via, 60, 200);
    const pts = [...piece(granja, 0, granja.length), ...piece(hwy, jw, jc), ...piece(via, vjc, 0)];
    races.push({ id: 'festival', name: 'Festival Circuit', type: 'circuit', series: 'Road Racing', laps: 2, closed: true, pts, ai: 7, desc: 'Fields, lakeside and the Autopista — two laps around the festival grounds.' });
  }
  // Volcán hillclimb sprint
  {
    const vjc = sNear(via, 60, 200);
    const pts = [...piece(via, vjc, via.length), ...piece(spiral, 0, spiral.length)];
    races.push({ id: 'volcan', name: 'Volcán Hillclimb', type: 'sprint', series: 'Road Racing', laps: 1, closed: false, pts, ai: 7, desc: 'Spiral up the flanks of the volcano to the viewpoint below the rim.' });
  }
  // Autopista sprint
  races.push({ id: 'autopista', name: 'Autopista Sprint', type: 'sprint', series: 'Street Scene', laps: 1, closed: false, pts: piece(hwy, 0, hwy.length), ai: 7, desc: 'Flat out across the island on the highway.' });
  // Sierra pass sprint
  races.push({ id: 'sierra', name: 'Sierra Pass Sprint', type: 'sprint', series: 'Road Racing', laps: 1, closed: false, pts: piece(sierra, 0, sierra.length), ai: 7, desc: 'Twisting climb through the north-eastern ridges.' });
  // Selva dirt scramble
  races.push({ id: 'selva', name: 'Selva Scramble', type: 'dirt', series: 'Dirt Racing', laps: 1, closed: false, pts: piece(selva, 0, selva.length), ai: 5, desc: 'Gravel and mud through the western jungle.' });
  // Town street circuit
  {
    const c = [
      [T.x - 110, T.z - 110, 10],
      [T.x + 110, T.z - 110, 10],
      [T.x + 110, T.z + 110, 10],
      [T.x - 110, T.z + 110, 10],
    ];
    const pts = densify(filletCorners(densify(c, 6), 16), 3);
    races.push({ id: 'town', name: 'Pueblo Street Circuit', type: 'circuit', series: 'Street Scene', laps: 3, closed: true, pts, ai: 5, desc: 'Tight corners around the town blocks.' });
  }
  // Runway drag
  races.push({ id: 'drag', name: 'Runway Drag', type: 'drag', series: 'Drag Racing', laps: 1, closed: false, pts: piece(runway, 0, runway.length), ai: 1, desc: 'Head to head down the airfield runway.' });

  for (const r of races) {
    r.route = new Route(r.pts, r.closed, world);
    r.distance = r.route.length * r.laps;
    const p = r.route.pointAt(r.closed ? 0 : 50, 0, 0);
    r.start = { x: p.x, z: p.z, tx: p.tx, tz: p.tz };
    const ms = r.route.pointAt(r.closed ? -30 : 20, 0, 0);
    r.marker = { x: ms.x, z: ms.z };
  }

  // ---------------------------------------------------------------- PR stunts
  const stunts = [];
  const straightness = (road, s, span) => Math.abs(road.curvatureAt(s, span));
  const pickStraight = (road, count, minGap, span = 80) => {
    const cands = [];
    for (let s = span; s < road.length - span; s += 20) cands.push([s, straightness(road, s, span)]);
    cands.sort((a, b) => a[1] - b[1]);
    const out = [];
    for (const [s] of cands) {
      if (out.every((o) => Math.abs(o - s) > minGap)) out.push(s);
      if (out.length >= count) break;
    }
    return out;
  };
  const addTrap = (road, s, name) => {
    const p = road.pointAt(s, {});
    stunts.push({ id: 'trap-' + stunts.length, type: 'speed', name, road, s, x: p.x, z: p.z, tx: p.tx, tz: p.tz, width: road.width, stars: [180, 230, 280] });
  };
  pickStraight(hwy, 2, 900).forEach((s, k) => addTrap(hwy, s, ['Autopista Speed Trap', 'Pueblo Speed Trap'][k]));
  pickStraight(ring, 2, 2500, 100).forEach((s, k) => addTrap(ring, s, ['Costa Speed Trap', 'Faro Speed Trap'][k]));
  addTrap(runway, runway.length * 0.7, 'Airfield Speed Trap');
  // speed zones (average speed over 400 m)
  {
    const s = pickStraight(ring, 1, 1000, 200)[0] + 1200;
    const s0 = ((s % ring.length) + ring.length) % ring.length;
    const a = ring.pointAt(s0, {});
    stunts.push({ id: 'zone-0', type: 'zone', name: 'Costa Speed Zone', road: ring, s: s0, len: 450, x: a.x, z: a.z, tx: a.tx, tz: a.tz, width: ring.width, stars: [150, 190, 230] });
    const s1 = sNear(via, 170, 700);
    const b = via.pointAt(s1, {});
    stunts.push({ id: 'zone-1', type: 'zone', name: 'Via Central Speed Zone', road: via, s: s1, len: 350, x: b.x, z: b.z, tx: b.tx, tz: b.tz, width: via.width, stars: [120, 160, 200] });
  }
  // drift zones on twisty sections
  const drifty = (road, name, sStart, len) => {
    const a = road.pointAt(sStart, {});
    stunts.push({ id: 'drift-' + stunts.length, type: 'drift', name, road, s: sStart, len, x: a.x, z: a.z, tx: a.tx, tz: a.tz, width: road.width, stars: [6000, 14000, 26000] });
  };
  drifty(spiral, 'Volcán Drift Zone', spiral.length * 0.55, 500);
  drifty(sierra, 'Sierra Drift Zone', sierra.length * 0.35, 600);
  drifty(selva, 'Selva Drift Zone', selva.length * 0.3, 500);
  drifty(ring, 'Faro Drift Zone', ring.length * 0.38, 700);
  // danger signs (jumps sculpted into the terrain)
  for (const j of world.data.jumps || []) {
    stunts.push({ id: 'jump-' + stunts.length, type: 'jump', name: j.name, x: j.x, z: j.z, tx: j.dx, tz: j.dz, lip: j.lip, stars: [60, 95, 135] });
  }
  return { races, stunts };
}

// ------------------------------------------------------------------ markers
const beamVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWP;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWP = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const beamFrag = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float intensity;
varying vec2 vUv;
varying vec3 vWP;
#include <fog_pars_fragment>
void main() {
  float a = pow( 1.0 - vUv.y, 1.6 ) * ( 0.55 + 0.45 * sin( vUv.y * 30.0 - time * 3.0 ) * 0.3 );
  float edge = 1.0 - abs( vUv.x - 0.5 ) * 2.0;
  a *= smoothstep( 0.0, 0.6, edge );
  float d = length( cameraPosition - vWP );
  a *= smoothstep( 6.0, 30.0, d );
  gl_FragColor = vec4( color * intensity, a * 0.9 );
}`;

export function makeEventMarker(type, color) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  // light beam
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 4.5, 160, 24, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), color: { value: col.clone() }, time: { value: 0 }, intensity: { value: 2.2 } },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );
  beam.position.y = 80;
  g.add(beam);
  // ground ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(6.4, 7.2, 64),
    new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2.5), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  g.add(ring);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(6.4, 48), new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true, opacity: 0.18, depthWrite: false }));
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.22;
  g.add(inner);
  // icon sprite
  const icon = makeIconSprite(type, color);
  icon.position.y = 5.5;
  g.add(icon);
  g.userData = { beam, ring, icon };
  return g;
}

export function makeIconSprite(type, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,18,0.85)';
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 7;
  g.lineCap = 'round';
  if (type === 'speed' || type === 'zone') {
    g.beginPath();
    g.arc(64, 74, 30, Math.PI, 0);
    g.stroke();
    g.beginPath();
    g.moveTo(64, 74);
    g.lineTo(84, 48);
    g.stroke();
  } else if (type === 'drift') {
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(38, 92);
    g.bezierCurveTo(38, 50, 90, 78, 90, 36);
    g.stroke();
  } else if (type === 'jump') {
    g.beginPath();
    g.moveTo(64, 30);
    g.lineTo(96, 92);
    g.lineTo(32, 92);
    g.closePath();
    g.stroke();
    g.fillRect(60, 50, 8, 22);
    g.fillRect(60, 78, 8, 8);
  } else {
    // flag
    g.beginPath();
    g.moveTo(42, 98);
    g.lineTo(42, 30);
    g.stroke();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) g.fillRect(46 + i * 11, 32 + j * 11, 11, 11);
    g.lineWidth = 3;
    g.strokeRect(46, 32, 44, 33);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: true }));
  sp.scale.set(4, 4, 1);
  return sp;
}

export const EVENT_COLORS = {
  circuit: PALETTE.pink,
  sprint: PALETTE.pink,
  dirt: '#e0a040',
  drag: PALETTE.yellow,
  speed: PALETTE.cyan,
  zone: PALETTE.cyan,
  drift: '#b05cff',
  jump: PALETTE.orange,
};

export function smooth01(a, b, x) {
  return smoothstep(a, b, x);
}
