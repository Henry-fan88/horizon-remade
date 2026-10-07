// San Francisco street trees: London planes on Market Street, clipped ficus
// downtown, small mixed street trees in the neighbourhoods, Canary Island date
// palms on the Embarcadero and Union Square, and windswept Monterey cypress.
// They reuse the island's leaf and bark materials (wind, alpha coverage).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trunk, withGroups, branchBetween, stripAttrs, shellCrown, buildBroadleaf } from './vegetation.js';
import { mulberry32 } from '../core/math.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function ficus(seed) {
  const rnd = mulberry32(seed), H = 3.0;
  const wood = [trunk(H + .6, .2, .09, 6, .06, 3)];
  for (let k = 0; k < 4; k++) { const a = k * 1.7 + rnd(); wood.push(branchBetween(V(0, H * .8, 0), V(Math.cos(a) * 1.1, H + .9, Math.sin(a) * 1.1), .09, .03, 4)); }
  const clumps = [{ x: 0, y: H + 1.7, z: 0, r: 2.1, sx: 1.05, sy: .72 }, { x: .9, y: H + 1.3, z: .5, r: 1.3, sx: 1, sy: .8 }, { x: -.8, y: H + 1.4, z: -.6, r: 1.3, sx: 1, sy: .8 }];
  return withGroups(mergeGeometries(wood.map(stripAttrs)), shellCrown(rnd, clumps, 20, 1.25, V(0, H + 1.4, 0)));
}

function streetTree(seed) {
  const rnd = mulberry32(seed), H = 2.6;
  const wood = [trunk(H + .5, .13, .05, 6, .1, 3)];
  const clumps = [];
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + rnd(), r = .5 + rnd() * .3;
    wood.push(branchBetween(V(0, H * .75, 0), V(Math.cos(a) * r, H + .9 + rnd() * .4, Math.sin(a) * r), .06, .02, 4));
    clumps.push({ x: Math.cos(a) * r, y: H + 1.3 + rnd() * .4, z: Math.sin(a) * r, r: 1.0 + rnd() * .3, sx: 1, sy: .85 });
  }
  clumps.push({ x: 0, y: H + 1.9, z: 0, r: 1.0, sx: 1, sy: .9 });
  return withGroups(mergeGeometries(wood.map(stripAttrs)), shellCrown(rnd, clumps, 12, 1.05, V(0, H + 1.4, 0)));
}

function cypress(seed) {
  const rnd = mulberry32(seed), H = 7;
  const lean = (rnd() - .5) * 1.4;
  const wood = [trunk(H, .45, .12, 7, lean, 4)];
  const clumps = [];
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05 + rnd() * .4, r = 2 + rnd() * 2.2;
    const end = V(Math.cos(a) * r + lean, H * (.65 + rnd() * .3), Math.sin(a) * r);
    wood.push(branchBetween(V(lean * .5, H * .55, 0), end, .14, .05, 5));
    clumps.push({ x: end.x, y: end.y + .5, z: end.z, r: 1.8 + rnd() * .6, sx: 1.3, sy: .45 });
  }
  clumps.push({ x: lean, y: H + .6, z: 0, r: 2.4, sx: 1.4, sy: .45 });
  return withGroups(mergeGeometries(wood.map(stripAttrs)), shellCrown(rnd, clumps, 16, 1.6, V(lean, H, 0)));
}

// Canary Island date palm: a thick straight trunk under a dense, round crown.
function canaryPalm(seed) {
  const rnd = mulberry32(seed), H = 7.2 + rnd() * 1.6;
  const stem = new THREE.CylinderGeometry(.4, .5, H, 9, 6, true);
  stem.translate(0, H / 2, 0);
  const uv = stem.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * H * .45);
  const knob = new THREE.SphereGeometry(.7, 9, 6); knob.scale(1, .9, 1); knob.translate(0, H + .1, 0);
  const fronds = [], n = 46;
  for (let k = 0; k < n; k++) {
    const a = k * 2.39996 + rnd() * .25, tier = k % 3, len = 4.8 + rnd() * 1.3, segs = 7;
    const pos = [], nor = [], uvs = [], idx = [];
    const rise = tier === 0 ? 1.9 : tier === 1 ? 1.1 : .4, droop = tier === 0 ? .1 : tier === 1 ? .24 : .42;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs, x = t * len;
      const y = Math.sin(t * Math.PI * .55) * rise - t * t * len * droop;
      const w = .95 * Math.sin(Math.PI * Math.min(1, t * 1.05 + .05));
      for (const side of [-1, 1]) { pos.push(x, y - .12 * t, side * w); nor.push(0, 1, 0); uvs.push(t, side < 0 ? 0 : 1); }
    }
    for (let s = 0; s < segs; s++) { const q = s * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.rotateX((rnd() - .5) * .35); g.rotateY(a); g.translate(0, H + .3, 0);
    fronds.push(stripAttrs(g.toNonIndexed()));
  }
  return withGroups(mergeGeometries([stripAttrs(stem.toNonIndexed()), stripAttrs(knob.toNonIndexed())]), mergeGeometries(fronds));
}

const SPECIES = {
  plane: { make: s => buildBroadleaf(s, false, 0), set: 'broadleaf', variants: 2, scale: [1.25, 1.5], range: 650 },
  ficus: { make: ficus, set: 'broadleaf', variants: 2, scale: [.9, 1.1], range: 520 },
  street: { make: streetTree, set: 'broadleaf', variants: 3, scale: [.85, 1.15], range: 450 },
  canary: { make: canaryPalm, set: 'palm', variants: 2, scale: [.9, 1.1], range: 1100 },
  cypress: { make: cypress, set: 'broadleaf', variants: 2, scale: [.9, 1.2], range: 900 },
};
const TINTS = {
  plane: [[.95, 1, .85], [.9, .98, .8]],
  ficus: [[.62, .78, .55], [.7, .82, .6]],
  street: [[.9, 1, .8], [.78, .48, .55], [1, .95, .62], [.7, .85, .62], [.95, .7, .62]],
  canary: [[1, 1, 1], [.96, 1, .94]],
  cypress: [[.5, .62, .5], [.56, .66, .52]],
};

export function buildCityTrees(props, list) {
  const veg = props.world.vegetation;
  if (!veg || !list.length) return 0;
  const groups = new Map(), rnd = mulberry32(5150), q = new THREE.Quaternion(), up = V(0, 1, 0);
  for (const t of list) {
    const sp = SPECIES[t.species];
    if (!sp) continue;
    const variant = Math.floor(rnd() * sp.variants), key = `${t.species}:${variant}`;
    if (!groups.has(key)) groups.set(key, { sp, species: t.species, variant, matrices: [], colors: [] });
    const g = groups.get(key), s = (t.scale ?? 1) * (sp.scale[0] + rnd() * (sp.scale[1] - sp.scale[0]));
    const y = t.y ?? props.h(t.x, t.z) + .1;
    q.setFromAxisAngle(up, t.rot ?? rnd() * Math.PI * 2);
    g.matrices.push(new THREE.Matrix4().compose(V(t.x, y, t.z), q, V(s, s * (.92 + rnd() * .16), s)));
    const tint = t.tint || TINTS[t.species][Math.floor(rnd() * TINTS[t.species].length)];
    g.colors.push(new THREE.Color(...tint));
  }
  for (const g of groups.values()) {
    const geo = g.sp.make(4100 + g.variant * 31 + g.species.length * 7);
    geo.computeBoundingSphere();
    props.chunked(geo, veg.materials[g.sp.set], g.matrices, { maxDist: g.sp.range, shadowDist: 180, colors: g.colors });
  }
  return list.length;
}
