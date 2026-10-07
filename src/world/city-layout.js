// San Francisco block layout, shared by the scenery, the map and the sidewalk life.
// Street fronts are zero-lot-line rows (no side yards), the way SF blocks read from
// the street. Commercial block interiors are filled with buildings; residential
// interiors become the planted back yards that SF's mid-block open space is known for.
import { CITY_STREETS, CITY_PARKS, CITY_PLAZAS, cityMask, footprintsOverlap, footprintDistance } from './districts.js';
import { junctionDistance } from './junctions.js';
import { mulberry32, clamp } from '../core/math.js';

// Sidewalk geometry (metres from the road edge): parking strip, curb, walk.
export const CURB_IN = 2.7, CURB_OUT = 3.0, WALK_OUT = 6.65, FRONT = 6.75;

const street = name => CITY_STREETS.find(s => s.name === name).points;
const MARKET = street('Market Street'), EMBARCADERO = street('Embarcadero');
const BROADWAY = street('Broadway'), CALIFORNIA = street('California Street');

function nearestOnLine(points, x, z) {
  let best = Infinity, sign = 1;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1], ex = bx - ax, ez = bz - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez), 0, 1);
    const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
    if (d < best) { best = d; sign = Math.sign(ex * (z - az) - ez * (x - ax)) || 1; }
  }
  return { dist: best, signed: best * sign };
}
// z of a roughly east-west street at x, held flat beyond its ends
function zOn(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    if (x <= bx) return az + (bz - az) * (x - ax) / (bx - ax || 1);
  }
  return points[points.length - 1][1];
}

// Neighborhoods follow the real city's logic: the Financial District, Chinatown,
// North Beach, Nob and Russian Hill north of Market; SoMa, Transbay and the
// Mission/Haight rows south of it; Victorian Western Addition to the west.
export function neighborhoodAt(x, z) {
  const market = nearestOnLine(MARKET, x, z).signed; // positive south of Market
  if (x > 1385 && nearestOnLine(EMBARCADERO, x, z).dist < 75) return 'waterfront';
  if (market > 0) {
    if (x > 1170 && market < 240) return 'transbay';
    return x > 870 ? 'soma' : 'mission';
  }
  if (x > 1150) return 'fidi';
  if (x < 715) return 'victorian';
  if (z < zOn(BROADWAY, x)) return x > 935 ? 'northbeach' : 'russianhill';
  if (x > 900) return z < zOn(CALIFORNIA, x) + 8 ? 'chinatown' : 'unionsq';
  return z < zOn(CALIFORNIA, x) + 25 ? 'nobhill' : 'unionsq';
}

export const RESIDENTIAL = new Set(['victorian', 'mission', 'russianhill', 'northbeach', 'nobhill']);
// Neighbourhood main streets: ground floors are shops and cafes rather than garages.
export const SHOP_STREETS = new Set(['Market Street', 'Mission Street', 'Columbus Avenue', 'Grant Avenue', 'Stockton Street', 'Haight Street', 'Broadway', 'Powell Street', 'Embarcadero', 'Second Street', 'Third Street', 'California Street']);

// Building types: lot width/depth ranges, floors and floor height.
// podium: raised basement, garage level or shop/lobby storey below the typical floors.
const KINDS = {
  victorian: { w: [7.3, 8.1], d: [17, 22], floors: [2, 3], fh: 3.4, podium: 2.0 },
  edwardian: { w: [9, 13], d: [17, 22], floors: [3, 4], fh: 3.25, podium: 2.8 },
  apartment: { w: [16, 27], d: [20, 28], floors: [6, 11], fh: 3.3, podium: 4.6 },
  midcentury: { w: [16, 24], d: [18, 24], floors: [5, 8], fh: 3.0, podium: 3.0 },
  chinatown: { w: [8, 14], d: [16, 22], floors: [3, 5], fh: 3.3, podium: 4.4 },
  commercial: { w: [18, 30], d: [22, 32], floors: [7, 16], fh: 3.8, podium: 5.4 },
  deco: { w: [26, 34], d: [26, 34], floors: [20, 32], fh: 3.8, podium: 5.6 },
  glass: { w: [24, 36], d: [24, 36], floors: [22, 46], fh: 4.0, podium: 6.0 },
  slab: { w: [40, 52], d: [19, 23], floors: [24, 36], fh: 3.8, podium: 6.0 },
  loft: { w: [16, 32], d: [22, 34], floors: [4, 6], fh: 4.2, podium: 4.8 },
  modern: { w: [18, 30], d: [20, 30], floors: [6, 14], fh: 3.3, podium: 4.6 },
  shop: { w: [14, 24], d: [14, 20], floors: [2, 3], fh: 4.0, podium: 4.2 },
};
export const KIND_INFO = KINDS;

const MIX = {
  victorian: [['victorian', .86], ['edwardian', .14]],
  mission: [['victorian', .52], ['edwardian', .48]],
  russianhill: [['edwardian', .55], ['apartment', .25], ['midcentury', .2]],
  nobhill: [['apartment', .78], ['commercial', .22]],
  northbeach: [['edwardian', .78], ['apartment', .12], ['chinatown', .1]],
  chinatown: [['chinatown', 1]],
  unionsq: [['commercial', .8], ['apartment', .2]],
  fidi: [['commercial', .4], ['deco', .25], ['glass', .35]],
  transbay: [['glass', .7], ['modern', .3]],
  soma: [['loft', .6], ['modern', .4]],
  waterfront: [['shop', .7], ['loft', .3]],
};
const FIDI_CORE = { x: 1290, z: 110 };

function pick(list, r) {
  for (const [kind, weight] of list) { if ((r -= weight) <= 0) return kind; }
  return list[list.length - 1][0];
}

function kindFor(nb, x, z, r) {
  if (nb === 'fidi') {
    const core = coreAt(x, z);
    if (x > 1300 && z < 95 && r < .35) return 'slab';
    if (core < .3) return r < .7 ? 'commercial' : 'deco';
  }
  return pick(MIX[nb], r);
}
const coreAt = (x, z) => clamp(1 - Math.hypot((x - FIDI_CORE.x) / 300, (z - FIDI_CORE.z) / 260), 0, 1);

// Iconic towers on fixed sites; the rest of the layout packs around them.
export const LANDMARK_SITES = [
  { landmark: 'transamerica', x: 1100, z: 100, w: 30, d: 30, height: 172 },
  { landmark: 'salesforce', x: 1382, z: 186, w: 34, d: 34, height: 226 },
  { landmark: 'bofa', x: 1342, z: 38, w: 36, d: 28, height: 158 },
];

// Lots are oriented rectangles. A coarse spatial hash keeps the overlap tests cheap.
class LotIndex {
  constructor() { this.cells = new Map(); this.all = []; }
  key(cx, cz) { return cx * 4096 + cz; }
  add(b) {
    this.all.push(b);
    const r = Math.hypot(b.w, b.d) / 2;
    for (let cx = Math.floor((b.x - r) / 32); cx <= Math.floor((b.x + r) / 32); cx++)
      for (let cz = Math.floor((b.z - r) / 32); cz <= Math.floor((b.z + r) / 32); cz++) {
        const k = this.key(cx, cz);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(b);
      }
  }
  near(x, z, r) {
    const out = new Set();
    for (let cx = Math.floor((x - r) / 32); cx <= Math.floor((x + r) / 32); cx++)
      for (let cz = Math.floor((z - r) / 32); cz <= Math.floor((z + r) / 32); cz++)
        for (const b of this.cells.get(this.key(cx, cz)) || []) out.add(b);
    return out;
  }
  overlaps(lot, gap) {
    for (const b of this.near(lot.x, lot.z, Math.hypot(lot.w, lot.d) / 2 + 2)) if (footprintsOverlap(b, lot, gap)) return true;
    return false;
  }
  distance(x, z, r = 2) {
    let best = Infinity;
    for (const b of this.near(x, z, r + 30)) best = Math.min(best, footprintDistance(b, x, z));
    return best;
  }
}

// Distance from every 1 m cell of the city to the nearest carriageway edge, stamped
// segment by segment once per network. Clearance tests become bilinear lookups
// instead of hundreds of thousands of nearest-road searches.
const FIELD = { x0: 460, z0: -330, nx: 1220, nz: 1030, band: 8 };
const fields = new WeakMap();
export function roadEdgeField(network) {
  if (fields.has(network)) return fields.get(network);
  const { x0, z0, nx, nz, band } = FIELD, d = new Float32Array(nx * nz).fill(band);
  for (const r of network.roads) {
    const hw = r.width / 2, reach = hw + band, p = r.pts;
    for (let i = 0, segs = r.closed ? r.n : r.n - 1; i < segs; i++) {
      const j = (i + 1) % r.n, ax = p[i * 3], az = p[i * 3 + 2], bx = p[j * 3], bz = p[j * 3 + 2];
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach - x0)), i1 = Math.min(nx - 1, Math.ceil(Math.max(ax, bx) + reach - x0));
      const j0 = Math.max(0, Math.floor(Math.min(az, bz) - reach - z0)), j1 = Math.min(nz - 1, Math.ceil(Math.max(az, bz) + reach - z0));
      if (i0 > i1 || j0 > j1) continue;
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const x = x0 + ii, z = z0 + jj;
        let t = ((x - ax) * ex + (z - az) * ez) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const e = Math.hypot(x - ax - ex * t, z - az - ez * t) - hw, k = jj * nx + ii;
        if (e < d[k]) d[k] = e;
      }
    }
  }
  const edge = (x, z) => {
    const fx = x - x0, fz = z - z0, i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return band;
    const tx = fx - i, tz = fz - j, k = j * nx + i;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + nx] * (1 - tx) + d[k + nx + 1] * tx) * tz;
  };
  fields.set(network, edge);
  return edge;
}

// Roads, sidewalks and intersections must stay clear. Only the rectangle's outline
// is sampled: a street cannot cross a lot without crossing its edges.
export function lotClear(network, x, z, w, d, yaw, margin = FRONT - .2, jMargin = margin - 1.5) {
  const c = Math.cos(yaw), s = Math.sin(yaw), edge = roadEdgeField(network);
  const junctions = network.junctions.nearby(x, z, Math.hypot(w, d) / 2 + Math.max(0, jMargin) + 2);
  const nx = Math.max(1, Math.ceil(w / 3.5)), nz = Math.max(1, Math.ceil(d / 3.5));
  const test = (u, v) => {
    const px = x + c * u + s * v, pz = z - s * u + c * v;
    if (edge(px, pz) < margin) return false;
    for (const j of junctions) if (junctionDistance(j, px, pz) <= jMargin) return false;
    return true;
  };
  for (let i = 0; i <= nx; i++) for (const v of [-d / 2, d / 2]) if (!test(-w / 2 + w * i / nx, v)) return false;
  for (let k = 1; k < nz; k++) for (const u of [-w / 2, w / 2]) if (!test(u, -d / 2 + d * k / nz)) return false;
  return test(0, 0);
}

function inOpenSpace(x, z, r) {
  if (CITY_PARKS.some(p => Math.hypot(x - p.x, z - p.z) < p.r + r)) return true;
  return CITY_PLAZAS.some(p => footprintDistance(p, x, z) < r);
}

function finishLot(b, hf, rnd) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const ys = [-1, 1].flatMap(u => [-1, 1].map(v => hf.height(b.x + c * u * b.w / 2 + s * v * b.d / 2, b.z - s * u * b.w / 2 + c * v * b.d / 2)));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo < 2.5 || hi - lo > 11) return false;
  // Ground floor sits at the sidewalk in front; the base drops to the lowest corner.
  b.y = b.road ? hf.height(b.x + s * b.d / 2, b.z + c * b.d / 2) : (lo + hi) / 2;
  b.base = lo - .45;
  const K = KINDS[b.kind];
  b.fh = K.fh;
  if (!b.floors) {
    let floors = K.floors[0] + Math.floor(rnd() * (K.floors[1] - K.floors[0] + 1));
    if (b.neighborhood === 'fidi' || b.neighborhood === 'transbay') {
      const core = coreAt(b.x, b.z);
      floors = Math.round(K.floors[0] + (K.floors[1] - K.floors[0]) * clamp(core * (.55 + rnd() * .65), 0, 1));
    }
    if (b.neighborhood === 'nobhill') floors += Math.round(clamp((b.y - 22) / 6, 0, 3)); // grand buildings crown the hill
    if (b.infill && (b.kind === 'glass' || b.kind === 'deco')) floors = Math.round(floors * .8);
    b.floors = floors;
  }
  b.podium = K.podium;
  b.height = b.height || K.podium + b.floors * b.fh + .9;
  b.seed = rnd();
  b.style = Math.floor(rnd() * 6);
  return true;
}

// Block interiors are the cells enclosed by streets: flood the road raster from
// the city's outer edge, and whatever the flood cannot reach is inside a block.
function enclosedBlocks(network) {
  const G = 6, X0 = 480, Z0 = -300, NX = 200, NZ = 160, wall = new Uint8Array(NX * NZ), out = new Uint8Array(NX * NZ), edge = roadEdgeField(network);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) if (edge(X0 + i * G, Z0 + j * G) < 1.5) wall[j * NX + i] = 1;
  const stack = [];
  for (let i = 0; i < NX; i++) stack.push(i, (NZ - 1) * NX + i);
  for (let j = 0; j < NZ; j++) stack.push(j * NX, j * NX + NX - 1);
  while (stack.length) {
    const k = stack.pop();
    if (out[k] || wall[k]) continue;
    out[k] = 1;
    const i = k % NX, j = (k - i) / NX;
    if (i > 0) stack.push(k - 1); if (i < NX - 1) stack.push(k + 1);
    if (j > 0) stack.push(k - NX); if (j < NZ - 1) stack.push(k + NX);
  }
  return (x, z) => {
    const i = Math.round((x - X0) / G), j = Math.round((z - Z0) / G);
    return i >= 0 && j >= 0 && i < NX && j < NZ && !out[j * NX + i];
  };
}

function build(network, hf) {
  const rnd = mulberry32(77421), index = new LotIndex(), yards = [], enclosed = enclosedBlocks(network), edge = roadEdgeField(network);
  const cityRoads = network.roads.filter(r => r.city);
  // 1. Landmarks claim their sites first, squared to the nearest street.
  for (const site of LANDMARK_SITES) {
    const near = network.nearest(site.x, site.z, 120);
    const yaw = near ? Math.atan2(near.tz, -near.tx) : 0;
    const b = { ...site, yaw, road: null, kind: 'glass', neighborhood: neighborhoodAt(site.x, site.z), floors: Math.round(site.height / 4) };
    if (!lotClear(network, b.x, b.z, b.w, b.d, yaw) || !finishLot(b, hf, rnd)) continue;
    b.height = site.height;
    index.add(b);
  }
  // 2. Street walls. Each lot is squared to the street at its centre; the next lot
  // starts where this one ends, so rows are continuous. Narrower lots are tried
  // before giving up, which fills the tight frontages near corners.
  for (const road of cityRoads) for (const side of [-1, 1]) {
    if (road.name === 'Embarcadero' && side === -1) continue;
    for (let along = 8; along < road.length - 8;) {
      const probe = road.pointAt(along, {});
      const nb = neighborhoodAt(probe.x - probe.tz * side * (road.width / 2 + 15), probe.z + probe.tx * side * (road.width / 2 + 15));
      const kind = kindFor(nb, probe.x, probe.z, rnd()), K = KINDS[kind];
      const wFull = K.w[0] + rnd() * (K.w[1] - K.w[0]), depth = K.d[0] + rnd() * (K.d[1] - K.d[0]);
      let placed = null;
      for (const shrink of kind === 'victorian' ? [1, .88] : [1, .8, .62, .45]) {
        const w = Math.max(6.5, wFull * shrink);
        const p = road.pointAt(along + w / 2, {});
        const off = road.width / 2 + FRONT + depth / 2;
        const x = p.x - p.tz * side * off, z = p.z + p.tx * side * off;
        const yaw = Math.atan2(p.tz * side, -p.tx * side);
        const lot = { x, z, w, d: depth, yaw, road: road.name, side, along, kind, neighborhood: nb };
        if (cityMask(x, z) < .3 || inOpenSpace(x, z, Math.hypot(w, depth) / 2)) continue;
        if (road.name !== 'Embarcadero' && x > 1370) { const bay = network.nearest(x, z, 85, r => r.name === 'Embarcadero', {}); if (bay && bay.lateral < 0) continue; }
        if (!lotClear(network, x, z, w, depth, yaw) || index.overlaps(lot, .02)) continue;
        if (!finishLot(lot, hf, rnd)) continue;
        placed = lot; break;
      }
      if (placed) {
        index.add(placed);
        along += placed.w + .04 + (kind === 'shop' ? 2 + rnd() * 3 : 0);
      } else along += 1.2;
    }
  }
  // 3. Mid-block. Commercial blocks fill with buildings; residential blocks keep
  // back yards, with the occasional rear cottage or garage.
  const step = 7;
  for (let z = -260; z <= 600; z += step) for (let x = 520; x <= 1540; x += step) {
    if (!enclosed(x, z) || cityMask(x, z) < .3 || inOpenSpace(x, z, 2) || edge(x, z) < FRONT + .5) continue;
    if (index.distance(x, z, 4) < 1.2) continue;
    const near = network.nearest(x, z, 40);
    if (near?.road.name === 'Embarcadero' && near.lateral < 0) continue;
    const nb = neighborhoodAt(x, z);
    const yaw = near ? Math.atan2(near.tz, -near.tx) : 0;
    if (RESIDENTIAL.has(nb)) {
      if (hf.height(x, z) > 2.5) yards.push({ x, z, yaw, y: hf.height(x, z), size: step, neighborhood: nb });
      continue;
    }
    const kind = kindFor(nb, x, z, rnd()), K = KINDS[kind];
    for (const f of [1, .75, .55, .4]) {
      const w = Math.max(8, K.w[1] * f), d = Math.max(8, K.d[1] * f);
      const lot = { x, z, w, d, yaw, road: null, kind, neighborhood: nb, infill: true };
      if (index.overlaps(lot, .4) || !lotClear(network, x, z, w, d, yaw)) continue;
      if (!finishLot(lot, hf, rnd)) continue;
      index.add(lot); break;
    }
  }
  // Yards that ended up under a later infill building are dropped.
  const buildings = index.all;
  buildings.forEach((b, i) => {
    b.block = i;
    // Exposed side walls (corners, gaps) get windows, turrets or ghost signs.
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), v = b.d / 2 - 3;
    const open = u => index.distance(b.x + c * u + s * v, b.z - s * u + c * v, 3) > .8;
    b.openL = open(-b.w / 2 - 1.3); b.openR = open(b.w / 2 + 1.3);
    b.shopStreet = SHOP_STREETS.has(b.road);
  });
  return { buildings, yards: yards.filter(y => index.distance(y.x, y.z, 4) > 2) };
}

const cache = new WeakMap();
export function cityPlan(network, hf) {
  if (!cache.has(network)) {
    const t = performance.now(), plan = build(network, hf);
    console.info(`[horizon] city layout: ${plan.buildings.length} buildings, ${plan.yards.length} yard cells in ${Math.round(performance.now() - t)} ms`);
    cache.set(network, plan);
  }
  return cache.get(network);
}
export const cityLayout = (network, hf) => cityPlan(network, hf).buildings;

// Sidewalks are split at every intersection. Walkers reverse at the ends instead
// of wandering into live traffic. Parking occupies separate curbside pull-outs.
export function cityStreetLife(network, hf, buildings = cityLayout(network, hf)) {
  const walks = [], parking = [], random = mulberry32(50012), index = new LotIndex();
  buildings.forEach(b => index.add(b));
  for (const road of network.roads.filter(r => r.city)) for (const side of [-1, 1]) {
    let segment = [];
    const finish = () => { if (segment.length >= 6) walks.push({ road: road.name, side, points: segment }); segment = []; };
    for (let s = 10; s < road.length - 10; s += 3) {
      const p = road.pointAt(s, {}), offset = road.width / 2 + 4.6;
      const x = p.x - p.tz * side * offset, z = p.z + p.tx * side * offset;
      const other = network.nearest(x, z, 24, r => r !== road, {});
      const own = network.nearest(x, z, 24, r => r === road, {});
      if (hf.height(x, z) < 2.5 || (own && own.dist < road.width / 2 + 3.2) || (other && other.dist < other.road.width / 2 + 3) || index.distance(x, z) < 1.5) { finish(); continue; }
      segment.push({ x, z, y: hf.height(x, z) + .16, s, tx: p.tx, tz: p.tz });
    }
    finish();
    if (road.width < 10 || road.name === 'Embarcadero') continue;
    for (let s = 18 + random() * 12; s < road.length - 18; s += 13 + random() * 9) {
      if (random() < .28) continue;
      const p = road.pointAt(s, {}), offset = road.width / 2 + 1.4;
      const x = p.x - p.tz * side * offset, z = p.z + p.tx * side * offset, yaw = Math.atan2(p.tx * side, p.tz * side);
      const lot = { x, z, y: hf.height(x, z), yaw, w: 2.3, d: 5.8, road: road.name };
      const other = network.nearest(x, z, 25, r => r !== road, {});
      if (lot.y < 2.5 || !lotClear(network, x, z, lot.w, lot.d, yaw, .15, .15) || (other && other.dist < other.road.width / 2 + 7) || index.overlaps(lot, 1)) continue;
      const a = hf.height(x + p.tx * 2.5, z + p.tz * 2.5), b = hf.height(x - p.tx * 2.5, z - p.tz * 2.5);
      lot.pitch = -Math.atan2((a - b) * side, 5); lot.y = (a + b) / 2;
      parking.push(lot);
    }
  }
  return { walks, parking };
}
