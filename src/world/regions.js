// The outer islands around the original one, each reached by a causeway from the Costa Ring:
//   Sierra Nevada  (north)       an alpine massif with snowy peaks and a switchback pass
//   Autódromo      (south-east)  a motorsport island with a purpose-built circuit
//   Cañón Rojo     (west)        red-rock desert: a mesa cut by a winding canyon
// DOM-free: used by the worldgen worker and by Node tools.
import { smoothstep, saturate, clamp, lerp } from '../core/math.js';

import { duneMask } from './districts.js';

export const REGION = { MAIN: 0, ALPINE: 1, CIRCUIT: 2, CANYON: 3 };

// centre, long-axis direction (radians, x -> z), semi-axes along / across (m)
export const ISLANDS = {
  alpine: { x: -80, z: -2400, angle: 0, a: 1330, b: 545 },
  // a squarer outline (power 4) leaves room for a full-size circuit on the plateau
  circuit: { x: 2130, z: 1490, angle: (125 * Math.PI) / 180, a: 900, b: 560, power: 4, top: 13 },
  canyon: { x: -2440, z: 0, angle: Math.PI / 2, a: 1270, b: 530, mesa: 118 },
};

// Causeways: straight embanked roads across the channels (x, z at each end).
export const CAUSEWAYS = [
  { name: 'Puente Norte', a: [-262, -1300], b: [-262, -1930] },
  { name: 'Puente Este', a: [1196, 760], b: [1672, 1168] },
  // lands at the canyon mouth, where it meets the rally loop
  { name: 'Puente Oeste', a: [-1350, 262], b: [-2062, 300] },
];

// The canyon's centre line, from its mouth on the east shore to the north-west flats.
export const CANYON_PATH = [
  [-1930, 262], [-2040, 250], [-2150, 205], [-2240, 120], [-2290, 10], [-2320, -120], [-2385, -250],
  [-2480, -345], [-2590, -420], [-2670, -540], [-2710, -690], [-2745, -850], [-2790, -990],
];

const gauss = (v, c, w) => Math.exp(-(((v - c) / w) ** 2));

export function local(I, x, z) {
  const dx = x - I.x,
    dz = z - I.z;
  const c = Math.cos(I.angle),
    s = Math.sin(I.angle);
  return { u: dx * c + dz * s, v: -dx * s + dz * c };
}

// normalised elliptical radius with a wobbly coastline
function rho(I, x, z, n) {
  const { u, v } = local(I, x, z);
  const p = I.power || 2;
  const r = Math.pow(Math.abs(u / I.a) ** p + Math.abs(v / I.b) ** p, 1 / p);
  const ang = Math.atan2(v / I.b, u / I.a);
  return r * (1 + 0.055 * n.noise2(Math.cos(ang) * 1.7 + I.x * 0.001, Math.sin(ang) * 1.7 + I.z * 0.001) + 0.02 * n.noise2(Math.cos(ang) * 6, Math.sin(ang) * 6));
}

// land height -> beach -> seabed, like the original island's coast
function coast(r, land) {
  const f = smoothstep(0.8, 0.955, r);
  let beach = 2.8 - 62 * (r - 0.945);
  if (r > 1) beach -= 260 * (r - 1) * (r - 1);
  return Math.max(-42, lerp(land, beach, f));
}

// distance from (x, z) to a polyline, with the parameter along it (0..1)
export function polyDistance(pts, x, z) {
  let best = 1e18,
    bt = 0,
    acc = 0,
    total = 0;
  const lens = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lens.push(l);
    total += l;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i],
      [bx, bz] = pts[i + 1];
    const dx = bx - ax,
      dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
    if (d < best) {
      best = d;
      bt = (acc + t * lens[i]) / total;
    }
    acc += lens[i];
  }
  return { d: Math.sqrt(best), t: bt };
}

// ------------------------------------------------------------------ Sierra Nevada
// Two peaks either side of a saddle; the south face below the saddle is kept smooth and
// evenly inclined so the pass road can zig-zag up it.
function alpineHeight(x, z, n, r) {
  const I = ISLANDS.alpine;
  const { u, v } = local(I, x, z);
  const crest = Math.max(445 * gauss(u, -640, 430), 405 * gauss(u, 640, 400), 262 * gauss(u, -60, 620));
  const ridgeV = -95 + 45 * n.noise2(u / 520, 3.1);
  const dv = v - ridgeV;
  // concave flanks; the south flank (towards the main island) is longer
  const half = dv > 0 ? 610 : 440;
  const t = saturate(Math.abs(dv) / half);
  let h = crest * Math.pow(1 - t, 1.35);
  // smooth, evenly graded south face under the saddle for the switchbacks, with a strip
  // of lowland along the shore where the causeway lands
  const face = smoothstep(-780, -620, u) * (1 - smoothstep(330, 480, u)) * smoothstep(-40, 60, dv);
  const faceH = clamp(6 + Math.max(0, 430 - v) * 0.53, 0, 262);
  h = lerp(h, faceH, face * 0.85);
  // crags and gullies elsewhere
  const rough = 1 - face * 0.9;
  const rg = n.ridged(x / 260 + 11, z / 260 - 7, 4);
  h += rough * (rg - 0.45) * 55 * saturate(h / 180);
  h += n.fbm(x / 140, z / 140, 3) * 7 * rough;
  return coast(r, Math.max(h, 4 + 6 * saturate(1 - r)));
}

// ------------------------------------------------------------------ Autódromo
// A low plateau with gentle undulations: room for a circuit, paddock and grandstands.
function circuitHeight(x, z, n, r) {
  const I = ISLANDS.circuit;
  const land = I.top + 5 * n.fbm(x / 520 + 4, z / 520 - 2, 3) + 1.2 * n.noise2(x / 90, z / 90);
  return coast(r, land);
}

// ------------------------------------------------------------------ Cañón Rojo
// A mesa with stepped cliffs, a winding canyon down to the east shore, and buttes on the
// coastal flats. Terraces in the walls give the layered red-rock look.
function terrace(t, steps = 5) {
  const k = t * steps,
    f = Math.floor(k),
    fr = k - f;
  return (f + smoothstep(0.55, 1, fr)) / steps;
}
// rock towers standing on the mesa (clear of the canyon and the rally loop)
const BUTTES = [
  [-2560, 400, 45, 55],
  [-2600, -120, 38, 48],
  [-2330, 640, 40, 50],
];
function canyonHeight(x, z, n, r) {
  const I = ISLANDS.canyon;
  const top = I.mesa + 12 * n.fbm(x / 400, z / 400, 3);
  // mesa edge: stepped cliffs down to the coastal flats
  const edge = smoothstep(0.58, 0.7, r + 0.03 * n.noise2(x / 120, z / 120));
  const flats = 7 + 7 * n.fbm(x / 300 + 5, z / 300, 2);
  let h = lerp(top, flats, terrace(edge, 4));
  // the canyon
  const c = polyDistance(CANYON_PATH, x, z);
  const floor = lerp(5, 30, smoothstep(0, 0.55, c.t)) - lerp(0, 16, smoothstep(0.7, 1, c.t));
  const wall = smoothstep(34, 125 + 30 * n.noise2(x / 200, z / 200), c.d);
  if (h > floor) h = floor + (h - floor) * terrace(wall, 4);
  // stepped rock towers on the mesa
  for (const [bx, bz, br, bh] of BUTTES) {
    const d = Math.hypot(x - bx, z - bz) / (br * (1 + 0.15 * n.noise2(x / 60, z / 60)));
    if (d < 1.6) h += bh * terrace(1 - smoothstep(0.75, 1.25, d), 3);
  }
  // wind-carved ripples on the flats
  h += 0.8 * n.noise2(x / 18, z / 45) * (1 - smoothstep(0.5, 0.7, r));
  // Broad wind-shaped dunes replace the southern mesa. Their smooth slopes remain
  // drivable; road grading subsequently fits both rally routes to this new terrain.
  const dunes = duneMask(x, z);
  const wave = .5 + .5 * Math.sin(x / 66 + z / 110 + n.noise2(x / 190, z / 190) * 1.4);
  const duneHeight = 9 + 23 * wave * wave + 5 * n.fbm(x / 210, z / 250, 2);
  h = lerp(h, duneHeight, dunes);
  return coast(r, h);
}

// ------------------------------------------------------------------ public
// Height of the outer islands (or -Infinity away from them) and which region a point is in.
export function regionHeight(x, z, n, out) {
  let best = -Infinity,
    region = REGION.MAIN,
    rr = 9;
  for (const [key, I, fn] of [
    ['alpine', ISLANDS.alpine, alpineHeight],
    ['circuit', ISLANDS.circuit, circuitHeight],
    ['canyon', ISLANDS.canyon, canyonHeight],
  ]) {
    const r = rho(I, x, z, n);
    if (r > 1.35) continue;
    const h = fn(x, z, n, r);
    if (h > best) {
      best = h;
      rr = r;
      region = key === 'alpine' ? REGION.ALPINE : key === 'circuit' ? REGION.CIRCUIT : REGION.CANYON;
    }
  }
  if (out) {
    out.region = region;
    out.rho = rr;
  }
  return best;
}

// Causeway embankment: a flat deck with rock-armoured sides, rising out of the sea.
export function causewayHeight(x, z) {
  let h = -Infinity;
  for (const cw of CAUSEWAYS) {
    const { d } = polyDistance([cw.a, cw.b], x, z);
    if (d > 40) continue;
    h = Math.max(h, 2.9 - Math.max(0, d - 10) * 0.62);
  }
  return h;
}

export function regionAt(x, z, n) {
  const o = {};
  regionHeight(x, z, n, o);
  return o.rho < 1.02 ? o.region : REGION.MAIN;
}

// island-local (u along the long axis, v across) to world x, z
export function toWorld(I, u, v) {
  const c = Math.cos(I.angle),
    s = Math.sin(I.angle);
  return [I.x + u * c - v * s, I.z + u * s + v * c];
}

// ------------------------------------------------------------------ region roads
// Paso Nevado: from the causeway up six switchbacks on the south face to the saddle.
export const PASS = [
  [-262, -1930], [-150, -1952], [60, -1972], [200, -1992], [236, -2022], [200, -2052],
  [-60, -2070], [-420, -2082], [-548, -2104], [-560, -2134], [-510, -2160], [-200, -2172],
  [120, -2178], [196, -2198], [200, -2232], [150, -2256], [-200, -2268], [-470, -2276],
  [-528, -2300], [-520, -2330], [-460, -2352], [-150, -2360], [90, -2364], [140, -2384],
  [120, -2410], [40, -2424], [-80, -2436], [-190, -2444],
];

// Autódromo Horizonte, island-local (u, v); +v faces the main island (paddock side).
// Main straight, a double-apex T1, esses, a long right, the back straight, a hairpin,
// a chicane and a fast final corner: about 4.4 km.
export const CIRCUIT_TRACK = [
  [-420, 300], [0, 300], [420, 300], [560, 275], [610, 190], [590, 90], [470, 40], [360, 60],
  [250, 10], [200, -80], [260, -170], [420, -210], [560, -230], [620, -300], [560, -370],
  [420, -385], [60, -384], [-300, -380], [-470, -360], [-560, -290], [-540, -200], [-420, -170],
  [-330, -110], [-360, -40], [-470, 10], [-580, 90], [-610, 190], [-560, 270],
];
// paddock beside the main straight, and the road to it from the causeway
export const PADDOCK = { u: 0, v: 380, len: 760, w: 142 };

// Cañón Rojo rally loop: up the canyon floor, then round the island on the coastal flats
// (an ellipse at 76 % of the island's radius, clear of the beach) back to the causeway.
const CANYON_RING = (() => {
  const I = ISLANDS.canyon;
  const pts = [];
  for (let deg = 128; deg >= -64; deg -= 6) {
    const t = (deg * Math.PI) / 180;
    const r = 0.76 + 0.012 * Math.sin(t * 5);
    const u = I.a * r * Math.cos(t),
      v = I.b * r * Math.sin(t);
    // island axes: u runs along +z, v along -x (see local())
    pts.push([Math.round(I.x - v), Math.round(I.z + u)]);
  }
  return pts;
})();
export const CANYON_LOOP = [
  [-2062, 300], [-2150, 214], [-2235, 130], [-2282, 20], [-2312, -110], [-2372, -240],
  [-2470, -336], [-2580, -410], [-2660, -525], [-2700, -640],
  ...CANYON_RING,
  [-2068, 360],
];
