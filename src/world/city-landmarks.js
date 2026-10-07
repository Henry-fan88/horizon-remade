// San Francisco landmarks: Transamerica Pyramid, Salesforce Tower, 555 California,
// Coit Tower, the Ferry Building and its piers, Union Square and the Dragon Gate.
import * as THREE from 'three';
import { FAR, BODY, MID, NEAR, FINE, Frame, finishGeometry } from './city-kit.js';
import { CITY_PARKS, CITY_PLAZAS } from './districts.js';

const C = (h) => new THREE.Color(h);
const mul = (c, k) => c.clone().multiplyScalar(k);

// Triangles with a facade mapping (u, wall width, height, total height) so the
// facade shaders can fit windows onto tapered and rounded towers.
class FacadeMesh {
  constructor() { this.pos = []; this.fac = []; }
  tri(a, b, c) { for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.fac.push(p[3], p[4], p[5], p[6]); } }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  // planar quad, wound to face away from an interior point of a convex solid
  oriented(a, b, c, d, center) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [(a[0] + c[0]) / 2 - center[0], (a[1] + c[1]) / 2 - center[1], (a[2] + c[2]) / 2 - center[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) this.quad(a, b, c, d); else this.quad(a, d, c, b);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('facade', new THREE.Float32BufferAttribute(this.fac, 4));
    g.computeVertexNormals();
    return finishGeometry(g);
  }
}

// Square frustum whose faces keep one window grid all the way up.
function taperedBlock(w0, w1, H) {
  const mesh = new FacadeMesh(), center = [0, H / 3, 0];
  for (const [fx, fz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const P = (h, w, t) => [fx ? fx * w / 2 : t * w / 2, h, fz ? fz * w / 2 : t * w / 2, t * w / 2 + w0 / 2, w0, h, H];
    mesh.oriented(P(0, w0, -1), P(0, w0, 1), P(H, w1, 1), P(H, w1, -1), center);
  }
  const top = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => [x * w1 / 2, H, z * w1 / 2, 0, 0, 0, 0]);
  mesh.oriented(top[0], top[1], top[2], top[3], center);
  return mesh;
}

function roundedRect(w, d, r, seg = 5) {
  const pts = [];
  for (const [cx, cz, a0] of [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI], [w / 2 - r, -d / 2 + r, Math.PI * 1.5]])
    for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}

// Lofted rounded-square tower; u is scaled to the base perimeter so mullions taper with it.
function roundedLoft(levels, { cap = true } = {}) {
  const mesh = new FacadeMesh();
  const rings = levels.map(l => roundedRect(l.w, l.w, l.r));
  const perim = ring => ring.reduce((a, p, i) => a + Math.hypot(ring[(i + 1) % ring.length][0] - p[0], ring[(i + 1) % ring.length][1] - p[1]), 0);
  const P0 = perim(rings[0]), H = levels[levels.length - 1].y - levels[0].y;
  const us = rings.map(ring => { let s = 0; const P = perim(ring); return ring.map((p, i) => { const u = s / P * P0; s += Math.hypot(ring[(i + 1) % ring.length][0] - p[0], ring[(i + 1) % ring.length][1] - p[1]); return u; }); });
  for (let l = 0; l < levels.length - 1; l++) {
    const A = rings[l], B = rings[l + 1], n = A.length, ya = levels[l].y, yb = levels[l + 1].y;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, uj = j === 0 ? P0 : us[l][j], ujb = j === 0 ? P0 : us[l + 1][j];
      const v = (p, y, u) => [p[0], y, p[1], u, P0, y - levels[0].y, H];
      mesh.quad(v(A[i], ya, us[l][i]), v(B[i], yb, us[l + 1][i]), v(B[j], yb, ujb), v(A[j], ya, uj));
    }
  }
  if (cap) {
    const top = rings[rings.length - 1], y = levels[levels.length - 1].y;
    for (let i = 1; i < top.length - 1; i++) mesh.tri([top[0][0], y, top[0][1], 0, 0, 0, 0], [top[i + 1][0], y, top[i + 1][1], 0, 0, 0, 0], [top[i][0], y, top[i][1], 0, 0, 0, 0]);
  }
  return mesh.geometry();
}

export function buildLandmarks(ctx, plan) {
  const sites = plan.buildings.filter(b => b.landmark);
  for (const b of sites) ({ transamerica, salesforce, bofa })[b.landmark]?.(ctx, b);
  ferryBuilding(ctx);
  piers(ctx);
  coitTower(ctx);
  unionSquare(ctx);
  dragonGate(ctx);
}

function collide(ctx, b, top, hw = b.w / 2, hd = b.d / 2) { ctx.props.game.collision.addBox(b.x, b.z, hw, hd, -b.yaw, b.base ?? b.y - 2, b.y + top, 'building'); }

// ------------------------------------------------------------------ Transamerica Pyramid
function transamerica(ctx, b) {
  const { B, M, S } = ctx, F = new Frame(B, b), white = C('#ece9e2');
  const H = b.height, body = H * .79, w0 = b.w, w1 = 8.5;
  const geo = taperedBlock(w0, w1, body).geometry();
  B.add(geo, M.masonryTall, b.x, b.y, b.z, 1, 1, 1, b.yaw, FAR, white);
  // the two wings (elevators east, stairs west) climb past the roof
  const hw = h => w0 / 2 - (w0 - w1) / 2 * h / body;
  for (const s of [-1, 1]) {
    const m = new FacadeMesh(), top = body + 16;
    const P = (h, out, z) => [s * (hw(h) + out), h, z, 0, 0, 0, 0];
    const inner = [s * (hw(top / 2) + .5), top / 2, 0];
    const box = [[P(0, -2, -3.6), P(0, 3, -3.6), P(0, 3, 3.6), P(0, -2, 3.6)], [P(top, -2, -3.6), P(top, 3, -3.6), P(top, 3, 3.6), P(top, -2, 3.6)]];
    const [l, u] = box;
    for (const [a, b2, c, d] of [[l[0], l[1], u[1], u[0]], [l[1], l[2], u[2], u[1]], [l[2], l[3], u[3], u[2]], [l[3], l[0], u[0], u[3]], u]) m.oriented(a, b2, c, d, inner);
    B.add(m.geometry(), M.paint, b.x, b.y, b.z, 1, 1, 1, b.yaw, FAR, mul(white, .97));
  }
  F.stack(S.pyramid, M.paint, 0, body, 0, w1, H - body, w1, FAR, white);
  F.put(S.sphere, M.lamp, 0, H + .3, 0, .7, .7, .7, FAR, C('#ff3a2a'));
  // tetrahedral base columns around a recessed lobby
  for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = -2; k <= 2; k++) {
    const t = k * w0 / 5.5;
    F.put(S.box, M.paint, fx ? fx * (w0 / 2 + .4) : t, 5, fz ? fz * (w0 / 2 + .4) : t, 1.2, 10, 1.2, MID, white, { roll: fx ? -fx * .09 : 0, pitch: fz ? fz * .09 : 0 });
  }
  collide(ctx, b, H, w0 / 2, w0 / 2);
}

// ------------------------------------------------------------------ Salesforce Tower
function salesforce(ctx, b) {
  const { B, M, S } = ctx, F = new Frame(B, b);
  const H = b.height, roof = H * .885, w0 = b.w;
  const shaft = roundedLoft([{ y: 0, w: w0, r: 7 }, { y: roof * .5, w: w0 - 2.2, r: 6.6 }, { y: roof, w: w0 - 5.5, r: 6 }]);
  B.add(shaft, M.glassLight, b.x, b.y, b.z, 1, 1, 1, b.yaw, FAR, C('#a9b9c4'));
  // open lattice crown curving in at the top
  const cw = w0 - 5.5, crown = roundedLoft([{ y: roof, w: cw, r: 6 }, { y: roof + (H - roof) * .5, w: cw - .8, r: 6.4 }, { y: roof + (H - roof) * .85, w: cw - 3, r: 7 }, { y: H, w: cw - 7, r: 6 }], { cap: false });
  B.add(crown, M.glassLight, b.x, b.y, b.z, 1, 1, 1, b.yaw, FAR, C('#b4bec4'));
  F.stack(S.box, M.metal, 0, roof, 0, cw * .55, (H - roof) * .5, cw * .55, FAR, C('#7d8890'));
  // glazed base with a wide canopy
  F.stack(S.box, M.paint, 0, 7.5, w0 / 2 + 2, w0 * .7, .5, 4, MID, C('#d6dadc'));
  collide(ctx, b, H, w0 / 2, w0 / 2);
}

// ------------------------------------------------------------------ 555 California
function bofa(ctx, b) {
  const { B, M, S } = ctx, F = new Frame(B, b), granite = C('#5a3833');
  const H = b.height, w = b.w, d = b.d, body = H * .88;
  F.stack(S.box, M.stucco, 0, 0, 0, w - 4, 8, d - 4, BODY, mul(granite, .8));
  F.stack(S.box, M.masonryGrid, 0, 8, 0, w, body - 8, d, FAR, granite);
  // serrated bay windows run the full height on every face
  for (const face of [1, -1]) {
    for (let u = -w / 2 + 1.3; u <= w / 2 - 1.2; u += 2.3) F.put(S.box, M.paint, u, 8 + (body - 8) / 2, face * (d / 2 + .4), 1.15, body - 8, 1.15, FAR, mul(granite, 1.15), { yaw: Math.PI / 4 });
    for (let v = -d / 2 + 1.3; v <= d / 2 - 1.2; v += 2.3) {
      const [x, z] = F.at(face * (w / 2 + .4), v);
      B.add(S.box, M.paint, x, b.y + 8 + (body - 8) / 2, z, 1.15, body - 8, 1.15, b.yaw + Math.PI / 4, FAR, mul(granite, 1.15));
    }
  }
  // the irregular sawtooth top
  for (const [u, v, uw, vd, top] of [[-w / 4, -d / 4, w / 2, d / 2, H], [w / 4, -d / 4, w / 2, d / 2, H * .95], [-w / 4, d / 4, w / 2, d / 2, H * .92], [w / 4, d / 4, w / 2, d / 2, H * .97]])
    F.stack(S.box, M.masonryGrid, u, body, v, uw, top - body, vd, FAR, granite);
  collide(ctx, b, H);
}

// ------------------------------------------------------------------ Ferry Building
function ferryBuilding(ctx) {
  const { B, M, S, props } = ctx, x = 1556, z = 143, y = props.h(1548, z);
  const b = { x, z, y, yaw: -Math.PI / 2, w: 76, d: 18 }, F = new Frame(B, b);
  const stone = C('#ece2cb'), trim = C('#f6efdf'), roof = C('#6f7b78');
  F.stack(S.box, M.masonryTall, 0, 5.5, 0, b.w, 7, b.d, BODY, stone);
  F.stack(S.box, M.stucco, 0, -1.5, 0, b.w, 7, b.d, BODY, mul(stone, .95));
  // ground-floor arcade toward the Embarcadero
  for (let u = -b.w / 2 + 2.5; u <= b.w / 2 - 2.4; u += 5) {
    F.stack(S.box, M.stucco, u, 0, b.d / 2 + .5, 1.3, 5.6, 1.0, MID, trim);
    F.stack(S.box, M.window, u + 2.5, 0, b.d / 2 + .05, 3.4, 3.9, .1, NEAR, C('#ffffff'));
    F.put(S.arch, M.paint, u + 2.5, 3.9, b.d / 2 + .6, 3.7, 3.7, 4, NEAR, trim);
  }
  F.stack(S.box, M.paint, 0, 5.4, b.d / 2 + .6, b.w + .4, .45, 1.6, MID, trim);
  F.stack(S.box, M.paint, 0, 12.4, b.d / 2 + .4, b.w + .6, .6, 1.2, MID, trim);
  F.put(S.gable, M.paint, 0, 13, 0, b.d + 1.4, 3.2, b.w + 1, BODY, roof, { yaw: Math.PI / 2 });
  F.stack(S.box, M.window, 0, 15.2, 0, b.w - 6, 1.2, 2.2, MID, C('#cfe0e6'));
  // the clock tower, after the Giralda of Seville
  const tv = b.d / 2 - 5;
  F.stack(S.box, M.masonryTall, 0, 0, tv, 10, 34, 10, FAR, stone);
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.stack(S.box, M.paint, u * 4.8, 12, tv + v * 4.8, .9, 22, .9, BODY, trim);
  F.stack(S.box, M.paint, 0, 34, tv, 10.8, .8, 10.8, BODY, trim);
  F.stack(S.box, M.stucco, 0, 34.8, tv, 9.4, 8, 9.4, FAR, stone);
  for (const [u, v, yaw] of [[0, 4.75, 0], [0, -4.75, Math.PI], [4.75, 0, Math.PI / 2], [-4.75, 0, -Math.PI / 2]]) {
    const [px, pz] = F.at(u, tv + v);
    B.add(S.plane, M.clock, px, y + 38.8, pz, 5.8, 5.8, 1, b.yaw + yaw, BODY, C('#ffffff'));
  }
  F.stack(S.box, M.paint, 0, 42.8, tv, 10.2, .6, 10.2, BODY, trim);
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.stack(S.box, M.stucco, u * 3.6, 43.4, tv + v * 3.6, 1.4, 7, 1.4, FAR, stone);
  F.stack(S.box, M.paint, 0, 43.4, tv, 5.6, 7, 5.6, BODY, mul(stone, .35));
  F.stack(S.box, M.paint, 0, 50.4, tv, 9, .6, 9, BODY, trim);
  F.stack(S.box, M.stucco, 0, 51, tv, 7, 5, 7, FAR, stone);
  F.stack(S.cyl8, M.stucco, 0, 56, tv, 3, 3.2, 3, FAR, stone);
  F.stack(S.cone8, M.paint, 0, 59.2, tv, 3.3, 4.5, 3.3, FAR, roof);
  F.stack(S.cyl, M.chrome, 0, 63.7, tv, .08, 5, .08, BODY, C('#ffffff'));
  const sign = ctx.signs.color('PORT OF SAN FRANCISCO', { bg: '#ece2cb', fg: '#2b3a36', font: 'bold 40px Georgia, serif', glow: .6 });
  F.put(S.plane, ctx.signs.material, 0, 31, tv + 5.05, 9, 1.1, 1, BODY, sign);
  collide(ctx, b, 16);
  ctx.props.game.collision.addBox(...F.at(0, tv), 5, 5, -b.yaw, y - 2, y + 64, 'building');
  // the plaza in front, with palms
  for (let u = -30; u <= 30; u += 12) ctx.trees.push({ species: 'canary', x: F.at(u, b.d / 2 + 9)[0], z: F.at(u, b.d / 2 + 9)[1], scale: .95 + (u % 3) * .03 });
}

// Pier sheds with Beaux-Arts headhouses along the bay side of the Embarcadero.
function piers(ctx) {
  const { B, M, S, props } = ctx, net = props.world.network, emb = net.roads.find(r => r.name === 'Embarcadero');
  const cream = C('#ebe2cc'), shed = C('#7f8c86'), roofCol = C('#5b6560');
  for (const [f, name] of [[.255, 'PIER 1'], [.52, 'PIER 24'], [.635, 'PIER 26'], [.725, 'PIER 28']]) {
    const p = emb.pointAt(emb.length * f, {}), L = 64, off = emb.width / 2 + 15 + L / 2;
    const x = p.x + p.tz * off, z = p.z - p.tx * off, yaw = Math.atan2(-p.tz, p.tx);
    const y = props.h(p.x + p.tz * (emb.width / 2 + 15), p.z - p.tx * (emb.width / 2 + 15));
    const b = { x, z, y, yaw, w: 22, d: L, base: 0 }, F = new Frame(B, b);
    // headhouse
    F.stack(S.box, M.masonry, 0, 0, L / 2 - 5, 24, 11, 10, BODY, cream);
    F.stack(S.box, M.paint, 0, 0, L / 2 + .05, 7, 7, .1, MID, mul(C('#2c3431'), 1));
    F.put(S.arch, M.paint, 0, 7, L / 2 + .3, 7.4, 7.4, 4, MID, C('#f6f0e2'));
    F.stack(S.box, M.paint, 0, 11, L / 2 + .2, 24.6, .7, .9, MID, C('#f6f0e2'));
    F.stack(S.gable, M.paint, 0, 11.7, L / 2 - .2, 14, 3, .8, MID, cream);
    const sign = ctx.signs.color(name, { bg: '#ebe2cc', fg: '#3a4541', font: 'bold 44px Georgia, serif', glow: .5 });
    F.put(S.plane, ctx.signs.material, 0, 9.4, L / 2 + .12, 6, 1.1, 1, MID, sign);
    // long shed reaching out over the water on timber piles
    F.stack(S.box, M.paint, 0, 0, -5, 20, 8, L - 10, BODY, shed);
    F.put(S.gable, M.paint, 0, 8, -5, 21, 2.4, L - 9, BODY, roofCol);
    for (const s of [-1, 1]) F.put(S.box, M.window, s * 10.05, 6.2, -5, .06, 1.2, L - 12, MID, C('#ffffff'));
    for (let v = -L / 2 + 2; v < L / 2 - 8; v += 8) for (const u of [-9, 0, 9]) {
      const [px, pz] = F.at(u, v), g = props.h(px, pz);
      if (g < y - 1) B.add(S.cyl, M.paint, px, (g - 1 + y) / 2, pz, .35, y - g + 1, .35, 0, NEAR, C('#4a4036'));
    }
    F.stack(S.box, M.paint, 0, -.6, -5, 21, .6, L - 9, MID, C('#6e665b'));
    ctx.props.game.collision.addBox(x, z, 12, L / 2, -yaw, y - 30, y + 12, 'building');
  }
}

// ------------------------------------------------------------------ Coit Tower
function coitTower(ctx) {
  const { B, M, S, props } = ctx, park = CITY_PARKS.find(p => p.name === 'Telegraph Hill');
  const x = park.x, z = park.z, y = props.h(x, z), concrete = C('#e6dfcc');
  const b = { x, z, y, yaw: 0, w: 12, d: 12 }, F = new Frame(B, b);
  F.stack(S.box, M.stucco, 0, -1, 0, 15, 6.5, 15, BODY, mul(concrete, .95));
  F.stack(S.box, M.paint, 0, 5.5, 0, 15.6, .5, 15.6, MID, C('#f2ecdd'));
  F.stack(S.cyl, M.stucco, 0, 0, 0, 4.4, 44, 4.4, FAR, concrete);
  // fluting
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2;
    F.stack(S.box, M.paint, Math.sin(a) * 4.35, 6, Math.cos(a) * 4.35, .5, 32, .5, BODY, mul(concrete, 1.03), { yaw: a });
  }
  // observation arcade, crown and lantern
  for (let k = 0; k < 16; k++) {
    const a = (k + .5) / 16 * Math.PI * 2;
    F.stack(S.box, M.paint, Math.sin(a) * 4.32, 39, Math.cos(a) * 4.32, 1.1, 3.4, .3, BODY, C('#2a2e2d'), { yaw: a });
  }
  F.stack(S.cyl, M.paint, 0, 44, 0, 4.8, 1.2, 4.8, FAR, C('#f2ecdd'));
  F.stack(S.cyl, M.stucco, 0, 45.2, 0, 3.6, 2.2, 3.6, FAR, concrete);
  F.stack(S.cyl, M.paint, 0, 47.4, 0, 3.9, .4, 3.9, FAR, C('#f2ecdd'));
  props.game.collision.addBox(x, z, 7.5, 7.5, 0, y - 2, y + 48, 'building');
}

// ------------------------------------------------------------------ Union Square
function unionSquare(ctx) {
  const { B, M, S, props } = ctx, sq = CITY_PLAZAS.find(p => p.name === 'Union Square');
  const c = Math.cos(sq.yaw), s = Math.sin(sq.yaw), h = props.h;
  // granite plaza draped over the slope
  const pos = [], idx = [], nu = Math.ceil(sq.w / 2), nv = Math.ceil(sq.d / 2);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = -sq.w / 2 + sq.w * i / nu, v = -sq.d / 2 + sq.d * j / nv, x = sq.x + c * u + s * v, z = sq.z - s * u + c * v;
    pos.push(x, h(x, z) + .22, z);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b2 = a + 1, d = a + nu + 1, e = d + 1; idx.push(a, d, b2, b2, d, e); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, M.granite); mesh.receiveShadow = true; props.group.add(mesh);
  props.chunks.push({ mesh, x: sq.x, z: sq.z, r: 50, maxDist: 1300, shadowDist: 0, cast: false });
  const b = { x: sq.x, z: sq.z, y: h(sq.x, sq.z), yaw: sq.yaw, w: sq.w, d: sq.d }, F = new Frame(B, b);
  const granite = C('#b7b2a6');
  // edge curb and corner planters
  for (const [u, v, w, d] of [[0, sq.d / 2, sq.w, .5], [0, -sq.d / 2, sq.w, .5], [sq.w / 2, 0, .5, sq.d], [-sq.w / 2, 0, .5, sq.d]]) {
    const [x, z] = F.at(u, v);
    B.add(S.box, M.stucco, x, h(x, z) + .1, z, w, .5, d, sq.yaw, MID, granite);
  }
  // the Dewey Monument: granite column and the gilded Victory figure
  const y0 = b.y + .2;
  B.add(S.box, M.stucco, b.x, y0 + 1.5, b.z, 5, 3, 5, sq.yaw, BODY, granite);
  B.add(S.box, M.stucco, b.x, y0 + 3.6, b.z, 3.4, 1.2, 3.4, sq.yaw, BODY, mul(granite, 1.05));
  B.add(S.cyl, M.stucco, b.x, y0 + 4.2 + 13, b.z, .95, 26, .95, 0, FAR, C('#d9d3c6'));
  B.add(S.box, M.stucco, b.x, y0 + 30.6, b.z, 2.4, 1.2, 2.4, sq.yaw, FAR, C('#d9d3c6'));
  B.add(S.cyl, M.chrome, b.x, y0 + 32.4, b.z, .35, 2.4, .35, 0, BODY, C('#d8b456'));
  B.add(S.sphere, M.chrome, b.x, y0 + 33.9, b.z, .7, .8, .7, 0, BODY, C('#d8b456'));
  props.game.collision.addBox(b.x, b.z, 2.5, 2.5, -sq.yaw, y0 - 1, y0 + 34, 'building');
  // rows of palms, planters and cafe umbrellas
  for (const [u, v] of [[-26, -24], [-26, -8], [-26, 8], [-26, 24], [26, -24], [26, -8], [26, 8], [26, 24], [-10, 25], [10, 25], [-10, -25], [10, -25]]) {
    const [x, z] = F.at(u, v);
    ctx.trees.push({ species: 'canary', x, z, scale: .9 + Math.abs(u * v) % 3 * .05, y: h(x, z) + .2 });
  }
  for (const [u, v] of [[-14, 12], [14, 12], [-14, -12], [14, -12]]) {
    const [x, z] = F.at(u, v), yy = h(x, z) + .2;
    B.add(S.box, M.stucco, x, yy + .35, z, 7, .7, 2.2, sq.yaw, NEAR, granite);
    B.add(S.box, M.paint, x, yy + .9, z, 6.6, .5, 1.8, sq.yaw, NEAR, C('#3f6b3a'));
  }
  for (const [u, v] of [[8, -16], [12, -18], [16, -15]]) {
    const [x, z] = F.at(u, v), yy = h(x, z) + .2;
    B.add(S.cyl, M.metal, x, yy + 1.2, z, .05, 2.4, .05, 0, FINE, C('#cccccc'));
    B.add(S.cone8, M.paint, x, yy + 2.2, z, 1.6, .6, 1.6, 0, NEAR, C('#b8322c'));
    B.add(S.cyl, M.paint, x, yy + .37, z, .6, .05, .6, 0, FINE, C('#e8e4da'));
  }
}

// ------------------------------------------------------------------ Dragon Gate
function dragonGate(ctx) {
  const { B, M, S, props } = ctx, grant = props.world.network.roads.find(r => r.name === 'Grant Avenue');
  if (!grant) return;
  const p = grant.pointAt(grant.length * .14, {}), yaw = Math.atan2(p.tx, p.tz);
  const b = { x: p.x, z: p.z, y: p.y, yaw, w: 20, d: 2 }, F = new Frame(B, b);
  const green = C('#2f7a52'), red = C('#a32a24'), gold = C('#d8a93a'), stone = C('#cfc6b3');
  const hw = grant.width / 2 + 1.2, ow = grant.width / 2 + 6.1;
  for (const u of [-ow, -hw, hw, ow]) {
    const [x, z] = F.at(u, 0);
    B.add(S.box, M.stucco, x, props.h(x, z) + 3.6, z, 1.1, 7.2, 1.1, yaw, BODY, stone);
    props.game.collision.addBox(x, z, .6, .6, -yaw, props.h(x, z) - 1, props.h(x, z) + 8, 'building');
  }
  const top = 8.6;
  // central span over the road, side spans over the sidewalks
  F.stack(S.box, M.paint, 0, top - 1.4, 0, hw * 2 + 1.2, 1.2, 1.3, MID, red);
  const sign = ctx.signs.color('天 下 為 公', { bg: '#1f5a3d', fg: '#e8c25a', font: 'bold 44px "PingFang SC", "Noto Sans CJK SC", serif', glow: .4 });
  F.put(S.plane, ctx.signs.material, 0, top - .8, .67, 4.2, .9, 1, NEAR, sign);
  F.put(S.plane, ctx.signs.material, 0, top - .8, -.67, 4.2, .9, 1, NEAR, sign, { yaw: Math.PI });
  F.stack(S.box, M.paint, 0, top - .2, 0, hw * 2 + 2.4, .35, 2.2, MID, gold);
  F.stack(S.box, M.paint, 0, top + .15, 0, hw * 2 + 3.6, .5, 3.2, MID, green);
  F.stack(S.gable, M.paint, 0, top + .65, 0, 3.0, 1.5, hw * 2 + 3.4, MID, green, { yaw: Math.PI / 2 });
  for (const s of [-1, 1]) {
    F.put(S.box, M.paint, s * (hw + 1.6), top + .7, 0, 1.4, .2, 3.4, NEAR, green, { roll: s * .5 });
    F.put(S.sphere, M.paint, s * (hw * .5), top + 2.0, 0, .7, .7, .7, NEAR, gold);
    const su = s * (hw + ow) / 2, sw = ow - hw + 1;
    F.stack(S.box, M.paint, su, top - 2.6, 0, sw, .9, 1.1, MID, red);
    F.stack(S.box, M.paint, su, top - 1.7, 0, sw + 1.4, .45, 2.6, MID, green);
    F.stack(S.gable, M.paint, su, top - 1.25, 0, 2.4, 1.0, sw + 1.2, MID, green, { yaw: Math.PI / 2 });
  }
}
