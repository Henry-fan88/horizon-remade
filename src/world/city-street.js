// San Francisco streetscape: scored concrete sidewalks (brick on Market), curbs
// painted in the city's colour code, street trees by neighbourhood, Path of Gold
// lamps, Muni trolley wires, cable car tracks, red transit lanes, hydrants, stop
// signs and the rest of the street furniture.
import * as THREE from 'three';
import { MID, NEAR, FINE } from './city-kit.js';
import { CURB_IN, CURB_OUT, WALK_OUT, neighborhoodAt } from './city-layout.js';
import { CITY_PARKS, cityMask } from './districts.js';
import { useFarShadow } from '../render/farshadow.js';
import { mulberry32 } from '../core/math.js';

const C = (h) => new THREE.Color(h);
const CURB_PAINT = { red: C('#b8322c'), yellow: C('#e0b43a'), white: C('#f2f0ea'), green: C('#3f8a4f'), blue: C('#2f5fa8') };

// Ribbon builder: quads between two offsets from a road's centre line, following
// the ground, with metre UVs for the paving shader and per-vertex colours.
class Ribbon {
  constructor() { this.pos = []; this.uv = []; this.col = []; }
  quad(a, b, near, far, side, liftA, liftB, h, colA, colB, sa, sb) {
    const P = (p, t, lift) => { const x = p.x - p.tz * t * side, z = p.z + p.tx * t * side; return [x, h(x, z) + lift, z]; };
    const a0 = P(a, near, liftA), a1 = P(a, far, liftB), b0 = P(b, near, liftA), b1 = P(b, far, liftB);
    const v0 = 0, v1 = far - near; // across-street paving coordinate starts at the curb
    const tris = side > 0 ? [[a0, sa, v0, colA], [a1, sa, v1, colB], [b0, sb, v0, colA], [b0, sb, v0, colA], [a1, sa, v1, colB], [b1, sb, v1, colB]]
      : [[a0, sa, v0, colA], [b0, sb, v0, colA], [a1, sa, v1, colB], [b0, sb, v0, colA], [b1, sb, v1, colB], [a1, sa, v1, colB]];
    for (const [p, s, v, c] of tris) { this.pos.push(...p); this.uv.push(s, v); this.col.push(c.r, c.g, c.b); }
  }
  // vertical strip (curb face) from liftA to liftB at offset t
  wall(a, b, t, side, liftA, liftB, h, col) {
    const P = (p, lift) => { const x = p.x - p.tz * t * side, z = p.z + p.tx * t * side; return [x, h(x, z) + lift, z]; };
    const a0 = P(a, liftA), a1 = P(a, liftB), b0 = P(b, liftA), b1 = P(b, liftB);
    const tris = side > 0 ? [a0, b0, a1, b0, b1, a1] : [a0, a1, b0, b0, a1, b1];
    for (const p of tris) { this.pos.push(...p); this.uv.push(0, 0); this.col.push(col.r, col.g, col.b); }
  }
  mesh(props, material, { cast = false, maxDist = 900 } = {}) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('paveUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true; m.castShadow = cast; m.matrixAutoUpdate = false;
    props.group.add(m);
    const s = g.boundingSphere;
    props.chunks.push({ mesh: m, x: s.center.x, z: s.center.z, r: s.radius, maxDist: maxDist + s.radius, shadowDist: 0, cast: false });
    return m;
  }
}

function throughCity(road) {
  for (let s = 0; s < road.length; s += 20) { const p = road.pointAt(s, {}); if (cityMask(p.x, p.z) > .55) return true; }
  return false;
}

export function buildStreets(ctx, plan) {
  const { props, M } = ctx, net = props.world.network, hf = props.world.hf, h = props.h;
  const rnd = mulberry32(84112);
  // City streets, plus the island highway where it runs through town at grade:
  // inside the city it is dressed as a boulevard with sidewalks, trees and lamps.
  const cityRoads = net.roads.filter(r => r.city || (r.kind === 'highway' && throughCity(r)));
  const walks = new Ribbon(), brick = new Ribbon(), curbs = new Ribbon(), gutters = new Ribbon();
  const curbGrey = C('#bdb8ad'), white = C('#ffffff');
  const asphalt = useFarShadow(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .96, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const curbMat = useFarShadow(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, vertexColors: true }));
  const gaps = [];
  for (const road of cityRoads) for (const side of [-1, 1]) {
    const bay = road.name === 'Embarcadero' && side === -1;
    const target = road.name === 'Market Street' ? brick : walks;
    // Walk the street in 3 m steps; runs break at intersections and at water.
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      // Curb paint: red at both ends of every block face, random zones between.
      const len = run.length;
      const zones = [];
      for (let i = 0; i < len - 1; i++) zones.push(i < 2 || i > len - 4 ? CURB_PAINT.red : null);
      for (let i = 3; i < len - 5; i += 4 + Math.floor(rnd() * 6)) {
        const r = rnd();
        if (r < .5) continue;
        const paint = r < .72 ? CURB_PAINT.yellow : r < .84 ? CURB_PAINT.white : r < .95 ? CURB_PAINT.green : CURB_PAINT.blue;
        for (let k = i; k < Math.min(i + 2, len - 4); k++) zones[k] = paint;
      }
      for (let i = 0; i < len - 1; i++) {
        const a = run[i], b = run[i + 1], paint = zones[i] || curbGrey;
        target.quad(a.p, b.p, road.width / 2 + CURB_OUT, road.width / 2 + (bay ? 13 : WALK_OUT), side, .15, .15, h, white, white, a.s, b.s);
        curbs.quad(a.p, b.p, road.width / 2 + CURB_IN, road.width / 2 + CURB_OUT, side, .18, .18, h, paint, paint, a.s, b.s);
        curbs.wall(a.p, b.p, road.width / 2 + CURB_IN, side, .0, .18, h, paint);
        if (!bay) gutters.quad(a.p, b.p, road.width / 2 - .3, road.width / 2 + CURB_IN, side, .035, .035, h, C('#55575a'), C('#4b4d50'), a.s, b.s);
      }
      gaps.push({ road, side, from: run[0].s, to: run[len - 1].s });
      run = [];
    };
    for (let s = 2; s < road.length - 2; s += 3) {
      const p = road.pointAt(s, {}), off = road.width / 2 + 4.5;
      const x = p.x - p.tz * side * off, z = p.z + p.tx * side * off;
      const other = net.nearest(x, z, 24, r => r !== road);
      if (net.junctions.at(x, z, 3) || h(x, z) < 2.5 || (other && other.dist < other.road.width / 2 + 2) || (!road.city && cityMask(x, z) < .55)) { flush(); continue; }
      run.push({ p, s });
    }
    flush();
  }
  walks.mesh(props, M.paving);
  brick.mesh(props, M.brickPaving);
  curbs.mesh(props, curbMat);
  gutters.mesh(props, asphalt);
  new Furniture(ctx, gaps).build();
  return { gaps };
}

const TROLLEY = new Set(['Market Street', 'Mission Street', 'Haight Street', 'Stockton Street', 'Columbus Avenue']);
const CABLE_CAR = new Set(['Powell Street', 'California Street']);
const MAJOR = new Set(['Market Street', 'Embarcadero', 'Mission Street']);
const IRON = C('#1e2224'), POLE = C('#8e9396'), VERDIGRIS = C('#33433b'), WOOD = C('#5b4632'), GOLD = C('#c7a24c');

// Lamps, trees, wires, tracks and the rest, placed along the sidewalk runs.
class Furniture {
  constructor(ctx, gaps) {
    Object.assign(this, ctx); this.gaps = gaps;
    this.net = ctx.props.world.network; this.h = ctx.props.h;
    this.rnd = mulberry32(31337);
    this.lines = new Map(); // wire geometry, chunked by 512 m cell
    this.cityLamps = [];
    ctx.props.cityLamps = this.cityLamps;
  }
  side(p, side, off) { return [p.x - p.tz * side * off, p.z + p.tx * side * off]; }
  clear(x, z, road) {
    const n = this.net.nearest(x, z, 14, r => r !== road, {});
    return !(n && n.dist < n.road.width / 2 + 1.2) && !this.net.junctions.at(x, z, .5);
  }
  // corner furniture must stand on a sidewalk, never in a carriageway or intersection
  onWalk(x, z) {
    const n = this.net.nearest(x, z, 24);
    return !!n && n.dist > n.road.width / 2 + CURB_OUT - .1 && n.dist < n.road.width / 2 + WALK_OUT && !this.net.junctions.at(x, z, 1) && this.h(x, z) > 2.5;
  }
  line(a, b) {
    const k = `${Math.floor((a[0] + b[0]) / 1024)},${Math.floor((a[2] + b[2]) / 1024)}`;
    if (!this.lines.has(k)) this.lines.set(k, []);
    this.lines.get(k).push(...a, ...b);
  }
  // A catenary between two points, sagging by `sag` at mid-span.
  wire(a, b, sag = .35, n = 4) {
    let prev = a;
    for (let i = 1; i <= n; i++) {
      const t = i / n, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
      this.line(prev, q); prev = q;
    }
  }
  build() {
    for (const g of this.gaps) this.run(g);
    this.junctionDressing();
    this.tracks();
    this.redLanes();
    this.lombard();
    this.grantLanterns();
    this.flushLines();
  }

  // ---------------------------------------------------------------- per block face
  run({ road, side, from, to }) {
    const { B, S, M } = this, rnd = this.rnd, h = this.h, w2 = road.width / 2;
    const mid = road.pointAt((from + to) / 2, {});
    const [mx, mz] = this.side(mid, side, w2 + 10);
    const nb = road.name === 'Embarcadero' ? 'embarcadero' : road.name === 'Market Street' ? 'market' : neighborhoodAt(mx, mz);
    const taken = [];
    const free = (s, gap = 3) => !taken.some(t => Math.abs(t - s) < gap);
    const bay = road.name === 'Embarcadero' && side === -1;
    // ---- street lights
    const lamp = road.name === 'Market Street' ? ['gold', 28] : bay ? ['promenade', 30] : road.name === 'Embarcadero' ? ['cobra', 36]
      : nb === 'chinatown' ? ['pagoda', 22] : ['northbeach', 'nobhill', 'russianhill'].includes(nb) ? ['historic', 26]
      : ['victorian', 'mission'].includes(nb) && !TROLLEY.has(road.name) ? ['utility', 34] : ['cobra', 34];
    const alternate = lamp[0] === 'cobra' || lamp[0] === 'historic';
    const start = from + 6 + (alternate && side > 0 ? lamp[1] / 2 : 0);
    let prevPole = null;
    if (!(lamp[0] === 'utility' && side < 0)) for (let s = start; s < to - 5; s += lamp[1]) {
      const p = road.pointAt(s, {}), off = bay ? w2 + 6 : w2 + CURB_OUT + .55;
      const [x, z] = this.side(p, side, off);
      const y = h(x, z) + .15, toRoad = Math.atan2(p.tz * side, -p.tx * side);
      if (!this.clear(x, z, road)) continue;
      this.lamp(lamp[0], x, y, z, toRoad, p);
      taken.push(s);
      if (lamp[0] === 'utility') {
        // overhead distribution lines strung pole to pole
        const top = [x, y + 8.6, z], across = toRoad + Math.PI / 2;
        if (prevPole) for (const [dy, du] of [[0, -.9], [0, .9], [-.9, 0]]) {
          const a = [prevPole[0] + Math.sin(across) * du, prevPole[1] + dy, prevPole[2] + Math.cos(across) * du];
          const b = [top[0] + Math.sin(across) * du, top[1] + dy, top[2] + Math.cos(across) * du];
          this.wire(a, b, .45);
        }
        prevPole = top;
      }
    }
    // ---- Muni trolley poles and overhead wires
    if (TROLLEY.has(road.name)) {
      for (let s = from + 9; s < to - 5; s += 32) {
        const at = free(s, 2.5) ? s : s + 3;
        const p = road.pointAt(at, {}), [x, z] = this.side(p, side, w2 + CURB_OUT + .25), y = h(x, z) + .15;
        if (!this.clear(x, z, road)) continue;
        B.add(S.cyl, M.metal, x, y + 4.1, z, .12, 8.2, .12, 0, MID, C('#3a4741'));
        this.props.game.collision.addCircle(x, z, .2, y, y + 8, 'pole');
        // span wire to the far curb, carrying both pairs of contact wires
        const [ox, oz] = this.side(p, -side, w2 + CURB_OUT + .25);
        if (side > 0) this.wire([x, y + 7.7, z], [ox, h(ox, oz) + 7.85, oz], .25, 2);
        taken.push(at);
      }
      if (side > 0) for (const lane of [-1, 1]) for (const pair of [-.32, .32]) {
        let last = null;
        for (let s = from; s <= to + 7.9; s += 8) {
          const p = road.pointAt(Math.min(s, to), {}), lat = lane * road.width / 4 + pair;
          const q = [p.x - p.tz * lat, p.y + 6.4, p.z + p.tx * lat];
          if (last) this.line(last, q);
          last = q;
        }
      }
    }
    // ---- street trees in wells
    const treeSpec = { market: ['plane', 12, 0], embarcadero: ['canary', 15, 0], fidi: ['plane', 11, .1], transbay: ['ficus', 11, .1], unionsq: ['ficus', 10, .05], soma: ['street', 12, .3], chinatown: [null], northbeach: ['street', 14, .45], nobhill: ['ficus', 13, .35], russianhill: ['street', 13, .35], victorian: ['street', 11, .4], mission: ['street', 11, .4], waterfront: ['canary', 16, .2] }[nb] || ['street', 12, .4];
    if (treeSpec[0]) for (let s = from + 7 + rnd() * 4; s < to - 6; s += treeSpec[1] * (.85 + rnd() * .3)) {
      if (rnd() < treeSpec[2] || !free(s, 3.2)) continue;
      const p = road.pointAt(s, {}), [x, z] = this.side(p, side, bay ? w2 + 9 : w2 + CURB_OUT + 1.0), y = h(x, z) + .15;
      if (!this.clear(x, z, road)) continue;
      this.trees.push({ species: treeSpec[0], x, z, y: y - .05 });
      taken.push(s);
      if (treeSpec[0] !== 'canary') {
        const yaw = Math.atan2(p.tx, p.tz);
        B.add(S.box, M.paint, x, y + .005, z, 1.3, .03, 1.3, yaw, FINE, C('#3d3227'));
        if (['market', 'fidi', 'transbay', 'unionsq'].includes(nb)) B.add(S.box, M.metal, x, y + .02, z, 1.36, .03, 1.36, yaw, FINE, IRON);
        else if (nb === 'soma') for (const d of [-.35, .35]) B.add(S.box, M.paint, x + Math.cos(yaw) * d, y + 1, z - Math.sin(yaw) * d, .05, 2, .05, 0, FINE, C('#8a6f4c'));
      }
    }
    // ---- small furniture: trash cans, newspaper racks, benches, bus shelters
    const commercial = ['market', 'fidi', 'transbay', 'unionsq', 'soma', 'chinatown', 'northbeach', 'embarcadero'].includes(nb);
    if (commercial && !bay) for (let s = from + 4; s < to - 3; s += 45) {
      if (!free(s, 2)) continue;
      const p = road.pointAt(s, {}), [x, z] = this.side(p, side, w2 + CURB_OUT + .6), y = h(x, z) + .15, yaw = Math.atan2(p.tx, p.tz);
      if (!this.clear(x, z, road)) continue;
      B.add(S.cyl, M.paint, x, y + .5, z, .32, 1.0, .32, 0, FINE, C('#2e5a3c'));
      B.add(S.cyl, M.metal, x, y + 1.02, z, .34, .06, .34, 0, FINE, IRON);
      if (nb === 'market' || nb === 'unionsq' || nb === 'fidi') for (let k = 0; k < 3; k++) {
        const ax = x + Math.sin(yaw) * (.9 + k * .55), az = z + Math.cos(yaw) * (.9 + k * .55);
        B.add(S.box, M.paint, ax, y + .55, az, .45, 1.1, .4, yaw, FINE, [C('#2f5fa8'), C('#c33a2f'), C('#e7e2d6'), C('#e0b43a')][(k + Math.floor(s)) % 4]);
      }
      taken.push(s);
    }
    if (road.name === 'Market Street') for (let s = from + 40; s < to - 20; s += 170) this.busShelter(road, side, s);
    if (bay) for (let s = from + 12; s < to - 6; s += 19) {
      const p = road.pointAt(s, {}), [x, z] = this.side(p, side, w2 + 11), y = h(x, z) + .15, yaw = Math.atan2(p.tz * side, -p.tx * side) + Math.PI;
      if (y < 1.6) continue;
      B.add(S.box, M.paint, x, y + .45, z, 2.2, .1, .6, yaw, FINE, C('#7a5a3c'));
      B.add(S.box, M.paint, x - Math.sin(yaw) * .28, y + .8, z - Math.cos(yaw) * .28, 2.2, .6, .08, yaw, FINE, C('#7a5a3c'));
      for (const e of [-1, 1]) B.add(S.box, M.metal, x + Math.cos(yaw) * e * .9, y + .22, z - Math.sin(yaw) * e * .9, .1, .45, .55, yaw, FINE, IRON);
      // seawall railing at the edge of the promenade
      const [rx, rz] = this.side(p, side, w2 + 13), ry = h(rx, rz) + .15;
      B.add(S.box, M.metal, rx, ry + 1.0, rz, .06, .06, 19, Math.atan2(p.tx, p.tz), NEAR, C('#4a5559'));
      B.add(S.cyl, M.metal, rx, ry + .5, rz, .05, 1.0, .05, 0, FINE, C('#4a5559'));
    }
  }

  lamp(kind, x, y, z, toRoad, p) {
    const { B, S, M } = this, along = Math.atan2(p.tx, p.tz), across = along + Math.PI / 2;
    const ax = Math.sin(toRoad), az = Math.cos(toRoad);
    let headX = x, headZ = z, top = 8;
    if (kind === 'gold') {
      // Market Street's Path of Gold standards: fluted post, three globes
      B.add(S.cyl, M.metal, x, y + .6, z, .34, 1.2, .34, 0, NEAR, VERDIGRIS);
      B.add(S.cyl, M.metal, x, y + 4.4, z, .15, 6.4, .15, 0, MID, VERDIGRIS);
      for (const hh of [1.25, 4.0, 7.4]) B.add(S.cyl, M.metal, x, y + hh, z, .21, .18, .21, 0, FINE, GOLD);
      B.add(S.box, M.metal, x, y + 7.75, z, 1.9, .1, .1, across, NEAR, VERDIGRIS);
      for (const d of [-.95, .95]) B.add(S.sphere, M.lamp, x + Math.sin(across) * d, y + 8.1, z + Math.cos(across) * d, .62, .7, .62, 0, MID, C('#fff6e6'));
      B.add(S.sphere, M.lamp, x, y + 8.55, z, .7, .8, .7, 0, MID, C('#fff6e6'));
      B.add(S.cone8, M.metal, x, y + 8.95, z, .14, .5, .14, 0, FINE, GOLD);
      top = 9;
    } else if (kind === 'cobra' || kind === 'utility') {
      const wood = kind === 'utility', H = wood ? 9.2 : 8.4;
      B.add(S.cyl, M.paint, x, y + H / 2, z, wood ? .16 : .11, H, wood ? .16 : .11, 0, MID, wood ? WOOD : POLE);
      if (wood) B.add(S.box, M.paint, x, y + H - .5, z, 2.2, .12, .14, across, MID, WOOD);
      headX = x + ax * 2.1; headZ = z + az * 2.1;
      B.add(S.box, M.metal, x + ax * 1.1, y + H - 1.1, z + az * 1.1, .08, .08, 2.3, toRoad, NEAR, POLE, -.12);
      B.add(S.box, M.metal, headX, y + H - .95, headZ, .38, .16, .75, toRoad, NEAR, C('#5d6265'));
      B.add(S.box, M.lamp, headX, y + H - 1.05, headZ, .3, .04, .6, toRoad, NEAR, C('#fff2dc'));
      top = H - 1;
    } else if (kind === 'historic') {
      B.add(S.cyl, M.metal, x, y + .4, z, .2, .8, .2, 0, NEAR, IRON);
      B.add(S.cyl, M.metal, x, y + 2.3, z, .08, 3.8, .08, 0, NEAR, IRON);
      B.add(S.box, M.lamp, x, y + 4.5, z, .42, .6, .42, along, NEAR, C('#fff1d6'));
      B.add(S.pyramid, M.metal, x, y + 4.8, z, .62, .4, .62, along, NEAR, IRON);
      top = 4.6;
    } else if (kind === 'pagoda') {
      // Chinatown's lantern posts: green poles, red pagoda lamps
      B.add(S.cyl, M.paint, x, y + 2.5, z, .1, 5, .1, 0, NEAR, C('#2f6b47'));
      B.add(S.box, M.lamp, x, y + 5.3, z, .55, .75, .55, along, NEAR, C('#d0302a'));
      B.add(S.pyramid, M.paint, x, y + 5.65, z, 1.1, .5, 1.1, along, NEAR, C('#2f7a52'));
      B.add(S.sphere, M.paint, x, y + 6.25, z, .18, .22, .18, 0, FINE, C('#e0b034'));
      top = 5.3;
    } else if (kind === 'promenade') {
      B.add(S.cyl, M.metal, x, y + 3.6, z, .1, 7.2, .1, 0, MID, IRON);
      B.add(S.box, M.metal, x, y + 6.9, z, 2.0, .08, .08, across, NEAR, IRON);
      for (const d of [-1, 1]) B.add(S.box, M.lamp, x + Math.sin(across) * d, y + 6.55, z + Math.cos(across) * d, .38, .55, .38, along, NEAR, C('#fff1d6'));
      top = 6.5;
    }
    this.props.game.collision.addCircle(x, z, .2, y - .2, y + top, 'pole');
    this.cityLamps.push(headX - ax * 2.2, y, headZ - az * 2.2, toRoad);
  }

  busShelter(road, side, s) {
    const { B, S, M } = this, p = road.pointAt(s, {}), [x, z] = this.side(p, side, road.width / 2 + CURB_OUT + 1.6);
    if (!this.clear(x, z, road)) return;
    const y = this.h(x, z) + .15, yaw = Math.atan2(p.tx, p.tz), out = Math.atan2(p.tz * side, -p.tx * side) + Math.PI;
    const bx = Math.sin(out), bz = Math.cos(out);
    B.add(S.box, M.metal, x, y + 2.55, z, 4.2, .1, 1.7, yaw + Math.PI / 2, NEAR, C('#4f5a5e'));
    B.add(S.box, M.window, x + bx * .8, y + 1.3, z + bz * .8, 4.0, 2.2, .05, out, NEAR, C('#a8c4cc'));
    const ad = this.signs.color('MUNI', { bg: '#c33a2f', fg: '#ffffff', font: 'bold 44px "Barlow Condensed", sans-serif', glow: 1.2 });
    const ex = x + Math.sin(yaw) * 2.05, ez = z + Math.cos(yaw) * 2.05;
    B.add(S.box, M.metal, ex, y + 1.25, ez, .12, 2.5, 1.6, yaw + Math.PI / 2, NEAR, C('#4f5a5e'));
    for (const flip of [0, Math.PI]) B.add(S.plane, this.signs.material, ex + Math.sin(out + flip) * .07, y + 2.25, ez + Math.cos(out + flip) * .07, 1.4, .3, 1, yaw + Math.PI / 2 + flip, FINE, ad);
    B.add(S.box, M.paint, x + bx * .5, y + .45, z + bz * .5, 3.2, .08, .45, yaw + Math.PI / 2, FINE, C('#6b6f70'));
    for (const d of [-2, 2]) B.add(S.cyl, M.metal, x + Math.sin(yaw) * d - bx * .7, y + 1.27, z + Math.cos(yaw) * d - bz * .7, .05, 2.55, .05, 0, FINE, C('#4f5a5e'));
  }

  // ---------------------------------------------------------------- intersections
  junctionDressing() {
    const { B, S, M, net, h } = this, marks = [], done = [];
    const mark = (x, z, w, d, yaw) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), nx = Math.max(1, Math.round(w / 1.2)), nz = Math.max(1, Math.round(d / 1.2));
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const u = -w / 2 + i * w / nx, v = -d / 2 + j * d / nz;
        for (const [a, b] of [[u, v], [u, v + d / nz], [u + w / nx, v], [u + w / nx, v], [u, v + d / nz], [u + w / nx, v + d / nz]]) {
          const xx = x + c * a + s * b, zz = z - s * a + c * b;
          marks.push(xx, h(xx, zz) + .055, zz);
        }
      }
    };
    const stop = this.cutouts.color('STOP', { draw: stopSign });
    for (const j of net.junctions.items) {
      if (!j.links.every(l => l.road.city || cityMask(j.x, j.z) > .55)) continue;
      const allWay = !j.links.some(l => MAJOR.has(l.road.name) || l.road.width > 14);
      let named = false;
      for (const arm of j.arms) {
        const r = arm.road, w2 = r.width / 2;
        const out = [arm.tx, arm.tz], right = [arm.tz, -arm.tx];
        const q = { x: arm.x + out[0] * 2.6, z: arm.z + out[1] * 2.6 };
        if (done.some(o => Math.hypot(o.x - q.x, o.z - q.z) < 7)) continue;
        done.push(q);
        const yaw = Math.atan2(arm.tx, arm.tz);
        // crosswalk: continental bars on wide streets, two lines on narrow ones
        if (r.width >= 12) for (let u = -w2 + .9; u < w2 - .4; u += 1.2) mark(q.x + right[0] * u, q.z + right[1] * u, .55, 2.8, yaw);
        else for (const d of [-1.35, 1.35]) mark(q.x + out[0] * d, q.z + out[1] * d, r.width - .6, .3, yaw);
        if (allWay) {
          // stop bar across the approach lane, and the red octagon on the right corner
          mark(q.x + out[0] * 2.2 + right[0] * w2 / 2, q.z + out[1] * 2.2 + right[1] * w2 / 2, w2 - .2, .45, yaw);
          const sx = q.x + out[0] * 2.4 + right[0] * (w2 + CURB_OUT + .5), sz = q.z + out[1] * 2.4 + right[1] * (w2 + CURB_OUT + .5);
          const sy = h(sx, sz) + .15;
          if (this.onWalk(sx, sz)) {
          B.add(S.cyl, M.metal, sx, sy + 1.25, sz, .035, 2.5, .035, 0, FINE, C('#9aa0a2'));
          B.add(S.plane, this.cutouts.material, sx + arm.tx * .03, sy + 2.45, sz + arm.tz * .03, 6.24, .78, 1, yaw, NEAR, stop);
          B.add(S.cyl8, M.metal, sx, sy + 2.45, sz, .38, .02, .38, yaw, FINE, C('#8d9294'), Math.PI / 2, 0);
          this.props.game.collision.addCircle(sx, sz, .1, sy, sy + 2.6, 'pole');
          }
        }
        // hydrant on the corner (white body, coloured bonnet)
        const hydrant = this.rnd() < .55;
        if (hydrant) {
          const hx = q.x + out[0] * 4.2 - right[0] * (w2 + CURB_OUT + .45), hz = q.z + out[1] * 4.2 - right[1] * (w2 + CURB_OUT + .45);
          const hy = h(hx, hz) + .15;
          if (this.onWalk(hx, hz)) {
          B.add(S.cyl, M.paint, hx, hy + .32, hz, .13, .64, .13, 0, FINE, C('#f1efe8'));
          B.add(S.sphere, M.paint, hx, hy + .66, hz, .3, .22, .3, 0, FINE, [C('#2f5fa8'), C('#c33a2f'), C('#26282a'), C('#e0b43a')][Math.floor(this.rnd() * 4)]);
          for (const d of [-1, 1]) B.add(S.cyl, M.paint, hx + right[0] * d * .14, hy + .42, hz + right[1] * d * .14, .055, .14, .055, 0, FINE, C('#f1efe8'));
          this.props.game.collision.addCircle(hx, hz, .15, hy, hy + .8, 'pole');
          }
        }
        // corner pole with the two street names
        if (!named) {
          const other = j.links.find(l => l.road !== r && l.road.name !== r.name);
          const px = q.x + out[0] * 1.2 - right[0] * (w2 + CURB_OUT + .45), pz = q.z + out[1] * 1.2 - right[1] * (w2 + CURB_OUT + .45);
          if (other && this.onWalk(px, pz)) {
            named = true;
            const py = h(px, pz) + .15, op = other.road.pointAt(other.s, {});
            B.add(S.cyl, M.metal, px, py + 1.8, pz, .04, 3.6, .04, 0, FINE, C('#9aa0a2'));
            for (const [name, yy, ang] of [[r.name, 3.45, Math.atan2(arm.tx, arm.tz) + Math.PI / 2], [other.road.name, 3.7, Math.atan2(op.tx, op.tz) + Math.PI / 2]]) {
              const label = this.signs.color(name.toUpperCase().replace(' STREET', ' ST').replace(' AVENUE', ' AV'), { bg: '#1f6a43', fg: '#ffffff', font: 'bold 44px "Barlow Condensed", sans-serif', glow: .3 });
              for (const flip of [0, Math.PI]) B.add(S.plane, this.signs.material, px + Math.sin(ang + flip) * .02, py + yy, pz + Math.cos(ang + flip) * .02, 1.6, .26, 1, ang + flip, FINE, label);
            }
          }
        }
      }
    }
    // curbside parking: T-marks and meters
    for (const [i, p] of (this.props.cityStreetLife?.parking || []).entries()) {
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      for (const v of [-3.15, 3.15]) mark(p.x + s * v, p.z + c * v, 2.25, .1, p.yaw);
      if (i % 3 === 0) {
        const x = p.x + c * 1.75, z = p.z - s * 1.75, y = h(x, z) + .15;
        B.add(S.cyl, M.metal, x, y + .62, z, .045, 1.24, .045, 0, FINE, C('#4a4f52'));
        B.add(S.box, M.metal, x, y + 1.32, z, .22, .38, .18, p.yaw, FINE, C('#5d6468'));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(marks, 3)); geo.computeVertexNormals();
    const paint = useFarShadow(new THREE.MeshStandardMaterial({ color: 0xe6e4dc, roughness: .9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 }));
    const mesh = new THREE.Mesh(geo, paint); mesh.receiveShadow = true; this.props.group.add(mesh);
  }

  // ---------------------------------------------------------------- road surface details
  tracks() {
    const steel = useFarShadow(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .55, metalness: .5, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 }));
    const rib = new Ribbon(), rail = C('#5f6264'), slot = C('#161718'), plate = C('#3f4142');
    for (const road of this.net.roads.filter(r => CABLE_CAR.has(r.name))) {
      for (let s = 1; s < road.length - 2; s += 2) {
        const a = road.pointAt(s, {}), b = road.pointAt(s + 2, {});
        for (const c of [-road.width / 4, road.width / 4])
          for (const [o, w, col, lift] of [[0, .2, plate, .056], [-.535, .055, rail, .06], [.535, .055, rail, .06], [0, .03, slot, .062]])
            rib.quad(a, b, c + o - w / 2, c + o + w / 2, 1, lift, lift, this.h, col, col, s, s + 2);
      }
    }
    rib.mesh(this.props, steel, { maxDist: 500 });
  }

  redLanes() {
    const red = useFarShadow(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .92, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 }));
    const rib = new Ribbon(), net = this.net, rnd = mulberry32(911);
    for (const road of net.roads.filter(r => r.name === 'Market Street' || r.name === 'Mission Street')) {
      const outer = road.width / 2 - 1.35, inner = outer - 3.3;
      for (let s = 2; s < road.length - 4; s += 3) {
        const a = road.pointAt(s, {}), b = road.pointAt(s + 3, {});
        if (net.junctions.at(a.x, a.z, 4) || net.junctions.at(b.x, b.z, 4)) continue;
        // worn, faded transit paint rather than a fresh plastic red
        for (const side of [-1, 1]) { const col = C('#7f3a31').multiplyScalar(.82 + rnd() * .22); rib.quad(a, b, inner, outer, side, .05, .05, this.h, col, col, s, s + 3); }
      }
    }
    rib.mesh(this.props, red, { maxDist: 900 });
  }

  // Lombard's crooked block: brick paving and hydrangea beds along every bend.
  lombard() {
    const { B, S, M } = this, road = this.net.roads.find(r => r.name === 'Lombard Street');
    if (!road) return;
    const end = Math.min(road.length * .3, 360), rib = new Ribbon(), white = C('#ffffff');
    for (let s = 1; s < end; s += 2) {
      const a = road.pointAt(s, {}), b = road.pointAt(s + 2, {});
      rib.quad(a, b, -road.width / 2 + .1, road.width / 2 - .1, 1, .045, .045, this.h, white, white, s, s + 2);
    }
    rib.mesh(this.props, M.roadBrick, { maxDist: 700 });
    const blooms = [C('#d45d9a'), C('#8e5cc4'), C('#e23d4f'), C('#f08bb8'), C('#6f7fd8')];
    for (let s = 6; s < end - 4; s += 2.4) for (const side of [-1, 1]) {
      const p = road.pointAt(s, {}), [x, z] = this.side(p, side, road.width / 2 + 1.5), y = this.h(x, z), yaw = Math.atan2(p.tx, p.tz);
      if (this.net.junctions.at(x, z, 2)) continue;
      // hydrangea shrubs: rounded mounds with blooms tucked into the foliage
      B.add(S.box, M.stucco, x, y + .15, z, 1.5, .3, 2.4, yaw, NEAR, C('#7a5c45'));
      for (let k = 0; k < 3; k++) {
        const bx = x + Math.sin(yaw) * (k - 1) * .8, bz = z + Math.cos(yaw) * (k - 1) * .8;
        B.add(S.sphere, M.paint, bx, y + .55, bz, 1.25, .9, 1.0, yaw, NEAR, C('#3b6431').multiplyScalar(.85 + ((k + s) % 3) * .08));
        for (let f = 0; f < 3; f++) B.add(S.sphere, M.paint, bx + Math.cos(yaw + f * 2.1) * .32, y + .82 + (f % 2) * .1, bz - Math.sin(yaw + f * 2.1) * .32, .34, .28, .34, 0, FINE, blooms[(k * 3 + f + Math.floor(s)) % blooms.length]);
      }
    }
  }

  grantLanterns() {
    const { B, S, M } = this, road = this.net.roads.find(r => r.name === 'Grant Avenue');
    if (!road) return;
    for (let s = road.length * .2; s < road.length * .92; s += 13) {
      const p = road.pointAt(s, {});
      if (this.net.junctions.at(p.x, p.z, 3)) continue;
      const [ax, az] = this.side(p, -1, road.width / 2 + 5.8), [bx, bz] = this.side(p, 1, road.width / 2 + 5.8);
      const ya = this.h(ax, az) + 7.4, yb = this.h(bx, bz) + 7.4;
      this.wire([ax, ya, az], [bx, yb, bz], .7, 6);
      for (let k = 1; k < 8; k++) {
        const t = k / 8, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ya + (yb - ya) * t - .7 * 4 * t * (1 - t);
        B.add(S.sphere, M.lamp, x, y - .45, z, .42, .56, .42, 0, NEAR, C('#cf2420'));
        B.add(S.cyl, M.paint, x, y - .12, z, .02, .25, .02, 0, FINE, IRON);
      }
    }
  }

  flushLines() {
    const mat = new THREE.LineBasicMaterial({ color: 0x202325 });
    for (const pos of this.lines.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeBoundingSphere();
      const mesh = new THREE.LineSegments(g, mat); mesh.matrixAutoUpdate = false;
      this.props.group.add(mesh);
      const s = g.boundingSphere;
      this.props.chunks.push({ mesh, x: s.center.x, z: s.center.z, r: s.radius, maxDist: 650, shadowDist: 0, cast: false });
    }
  }
}

// Mid-block back yards in the residential neighbourhoods (lawns, garden trees,
// the odd shed) and the planting of the city's hilltop parks.
export function buildYards(ctx, plan) {
  const { props, B, S, M } = ctx, h = props.h, rnd = mulberry32(6060);
  const cells = new Map();
  for (const y of plan.yards) {
    const c = Math.cos(y.yaw), s = Math.sin(y.yaw), half = y.size / 2;
    const k = `${Math.floor(y.x / 256)},${Math.floor(y.z / 256)}`;
    if (!cells.has(k)) cells.set(k, []);
    const pos = cells.get(k);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const P = (a, b) => { const u = -half + a * half, v = -half + b * half, x = y.x + c * u + s * v, z = y.z - s * u + c * v; return [x, h(x, z) + .06, z]; };
      const a = P(i, j), b2 = P(i + 1, j), d = P(i, j + 1), e = P(i + 1, j + 1);
      pos.push(...a, ...d, ...b2, ...b2, ...d, ...e);
    }
    const r = rnd();
    if (r < .3) ctx.trees.push({ species: rnd() < .7 ? 'street' : rnd() < .5 ? 'ficus' : 'cypress', x: y.x + (rnd() - .5) * 3, z: y.z + (rnd() - .5) * 3, scale: .75 + rnd() * .35 });
    else if (r < .36) {
      const yy = h(y.x, y.z), yaw = y.yaw + (rnd() < .5 ? 0 : Math.PI / 2), col = [C('#9a8a6e'), C('#7d8c78'), C('#b5a58c')][Math.floor(rnd() * 3)];
      B.add(S.box, M.paint, y.x, yy + 1.0, y.z, 2.6, 2.0, 2.2, yaw, NEAR, col);
      B.add(S.gable, M.paint, y.x, yy + 2.0, y.z, 2.9, .7, 2.5, yaw, NEAR, C('#5a514a'));
    }
  }
  for (const pos of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, M.lawn); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    props.group.add(mesh);
    const sp = g.boundingSphere;
    props.chunks.push({ mesh, x: sp.center.x, z: sp.center.z, r: sp.radius, maxDist: 1600, shadowDist: 0, cast: false });
  }
  // Alamo Square and Telegraph Hill: Monterey cypress around the edge, benches on the paths
  for (const park of CITY_PARKS) {
    const clear = park.name === 'Telegraph Hill' ? 11 : 0;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + rnd() * .2, r = park.r - 4 - rnd() * 5;
      if (r < clear) continue;
      ctx.trees.push({ species: i % 3 ? 'cypress' : 'street', x: park.x + Math.cos(a) * r, z: park.z + Math.sin(a) * r, scale: 1 + rnd() * .3 });
    }
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + .3, r = Math.max(clear + 3, park.r * .45);
      const x = park.x + Math.cos(a) * r, z = park.z + Math.sin(a) * r, y = h(x, z);
      B.add(S.box, M.paint, x, y + .45, z, 2, .1, .55, a + Math.PI / 2, FINE, C('#6e5238'));
      B.add(S.box, M.paint, x + Math.cos(a) * .25, y + .8, z + Math.sin(a) * .25, 2, .55, .08, a + Math.PI / 2, FINE, C('#6e5238'));
    }
  }
}

// Octagon drawn into the left square of an atlas cell; the plane is scaled to
// show the whole cell and the transparent remainder is cut away.
function stopSign(g, W, H) {
  g.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, r = H / 2 - 2;
  const octagon = (rad) => { g.beginPath(); for (let k = 0; k < 8; k++) { const a = (k + .5) * Math.PI / 4; g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); } g.closePath(); };
  g.fillStyle = '#ffffff'; octagon(r); g.fill();
  g.fillStyle = '#b8211b'; octagon(r - 3); g.fill();
  g.fillStyle = '#ffffff'; g.font = 'bold 19px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('STOP', cx, cy + 1);
}
