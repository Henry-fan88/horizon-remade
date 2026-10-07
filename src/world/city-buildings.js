// San Francisco building types. Each kit models what makes the real type
// recognisable: Victorian rows with canted bays, bracketed cornices, stoops and
// garages; Edwardian flats with stacked bays; Nob Hill apartment canopies;
// Chinatown balconies, pagoda eaves and blade signs; Financial District stone,
// Art Deco setbacks and glass towers; SoMa brick lofts with ghost signs.
import * as THREE from 'three';
import { FAR, BODY, MID, NEAR, FINE, Frame } from './city-kit.js';

const C = (h) => new THREE.Color(h);
const P = (list) => list.map(C);
const mul = (c, k) => c.clone().multiplyScalar(k);
const mix = (a, b, t) => a.clone().lerp(b, t);

// Painted Lady schemes: body, trim, accent.
const LADIES = [
  ['#d9c7a3', '#f4efe3', '#7a2e2a'], ['#8fae9a', '#f1ead6', '#5b3a5e'], ['#c9a0b4', '#f6f0e4', '#3f5e7a'],
  ['#e3c66f', '#fbf6ea', '#6b8e5a'], ['#93b5c8', '#fdf8ee', '#c2763d'], ['#b6c79a', '#f2ecdc', '#8c3b3b'],
  ['#f0d9c4', '#ffffff', '#2f5d62'], ['#a7a3c9', '#f5f1e8', '#b5893c'], ['#7f9c9b', '#ece4d0', '#a23b2f'],
  ['#e9e2d0', '#5f7f63', '#b33c2d'], ['#c75d4b', '#f1e6cf', '#2e3f4f'], ['#3e5b6e', '#efe7d6', '#d8a740'],
  ['#5e6d4f', '#efe6cf', '#a0522d'], ['#d7b98e', '#f7f1e3', '#466b4a'], ['#9fb7a9', '#fffaf0', '#7d3c58'],
  ['#e8a87c', '#fff6ea', '#36525e'],
].map(P);
const STUCCO = P(['#efe6d2', '#e8dcc0', '#d9cdb4', '#f3efe6', '#cfd8cf', '#e4d0b8', '#c9d3d9', '#efd9b5', '#d8c3c8', '#bfcdbd', '#f2e3c6', '#dfe3dd']);
const STONE = P(['#e9dfc9', '#ddd0b4', '#f0ebdf', '#d6c6a8', '#cdbca0', '#e2d6c2', '#c8b49a', '#d9d4c7', '#b9a68c', '#f2efe8', '#c9b28f', '#e6d5bd']);
const DECO = P(['#d9cfbd', '#cbbd9f', '#e3dccd', '#bfb8a8', '#d4c4a2', '#c7c1b4']);
const GLASS = P(['#5d8a93', '#8fa7b3', '#7a6a58', '#46525a', '#7f9fb8', '#6f8f80', '#9aa3a6', '#5b6f86']);
const BRICK = P(['#8b4a38', '#7b3e30', '#96553f', '#6e3b31', '#a0604a', '#84503f']);
const PAINTED_BRICK = P(['#d9d4c8', '#5f6b62', '#3f4a52', '#b5a58c', '#8a3d34', '#e2dccf']);
const CHINA_STUCCO = P(['#efd9a7', '#cfe0c7', '#f2c9b8', '#e9e2cf', '#bcd3d9', '#f0c38a', '#e7d3e0']);
const CHINA_RAIL = P(['#b3262a', '#2f7d4f', '#e0b034', '#2a6e7a', '#c4442b']);
const AWNING = P(['#2f5d4a', '#8c2f2b', '#2d4467', '#c9a227', '#4a4a4a', '#6b2d5c', '#d26b2c', '#1f6f6b', '#7a1f2b']);
const PANELS = P(['#a8664a', '#bf9d52', '#6f8f7c', '#e9e6df', '#3b4146', '#8b9aa3', '#9b5a46']);
const DARK = C('#24292b'), IRON = C('#1d2122'), WHITE = C('#f4f1ea'), CONCRETE = C('#b9b4a8'), GRANITE = C('#77736b');
const BRASS = C('#b08d47'), DOOR = P(['#3b2a20', '#5a2320', '#1f3a33', '#25303d', '#6b4b2e']);

const SHOPS = {
  northbeach: ['CAFFE DEL PORTO', 'SALUMERIA ROSSI', 'TRATTORIA SOLE', 'GELATO BELLA', 'BEAT POETRY BOOKS', 'PANETTERIA', 'NORTH BEACH PIZZA', 'ENOTECA', 'BAR CENTRALE', 'FOCACCIA'],
  chinatown: ['金龍 GOLDEN DRAGON', '福 LUCKY BAKERY', '茶 TEA HOUSE', '藥材 HERBS', '海鮮 SEAFOOD', '點心 DIM SUM', '珠寶 JADE', '燒臘 BBQ', '雜貨 GROCERY', '餅家 BAKERY', '書店 BOOKS', '麵家 NOODLES'],
  mission: ['TAQUERIA LA PALMA', 'PANADERIA', 'VINYL RECORDS', 'VINTAGE', 'BURRITOS', 'LAVANDERIA', 'BIKE SHOP', 'HELADOS', 'BOTANICA', 'TATTOO', 'TACOS', 'COFFEE'],
  victorian: ['CORNER MARKET', 'COFFEE', 'FLOWERS', 'BOOKS', 'DELI', 'WINE SHOP', 'BAKERY', 'LAUNDROMAT'],
  russianhill: ['CORNER MARKET', 'COFFEE', 'FLOWERS', 'WINE BAR', 'CLEANERS', 'BISTRO'],
  nobhill: ['FLORIST', 'WINE BAR', 'CAFE', 'MARKET', 'BISTRO'],
  unionsq: ['BOUTIQUE', 'GALLERY', 'JEWELERS', 'SHOES', 'FLOWERS', 'PHARMACY', 'STEAKHOUSE', 'OYSTER BAR', 'BOOKS', 'HOTEL', 'TEA ROOM', 'CAFE'],
  fidi: ['BANK', 'CAFE', 'DELI', 'WINE BAR', 'STEAKHOUSE', 'SALADS', 'NEWS', 'TAILOR', 'SUSHI', 'GRILL'],
  transbay: ['COFFEE', 'GYM', 'SALADS', 'MARKET', 'POKE', 'BREWERY'],
  soma: ['BREWING CO.', 'COFFEE ROASTERS', 'GALLERY', 'DESIGN STUDIO', 'TACOS', 'BIKES', 'FURNITURE', 'RECORDS', 'CLIMBING GYM', 'PRINT SHOP'],
  waterfront: ['SEAFOOD', 'CRAB HOUSE', 'SOURDOUGH', 'CHOWDER', 'OYSTERS', 'GELATO', 'BAY CAFE', 'FISH MARKET'],
};
const GHOST_SIGNS = ['BAY CITY COFFEE & SPICE CO.', 'PACIFIC SODA WORKS', 'GOLDEN STATE CANDY', 'HARBOR PRINTING CO.', 'MISSION FURNITURE', 'OCEAN BISCUIT CO.'];
const BLADES = ['金龍酒家', '福祿飯店', '茶樓', '藥行', '餅家', '銀行', '海鮮', '點心'];
const CHINA_SIGN = P(['#9e1b1b', '#1d5b3a', '#7a1414', '#173f5f', '#b8860b']);
// Signs are coloured by their text, so each sign occupies a single atlas cell.
const hashText = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0; };
const byText = (list, s) => list[hashText(s) % list.length];

export class BuildingKits {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.shopCount = 0;
  }

  build(b) {
    const F = new Frame(this.B, b);
    const r = this.rng(b);
    if (b.landmark) return; // landmarks are modelled separately
    this.foundation(F, b);
    this[b.kind](F, b, r);
    this.collide(b, b.height + (b.kind === 'victorian' ? 3 : 1));
  }
  rng(b) { let s = Math.floor(b.seed * 1e9) || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
  pick(list, r) { return list[Math.floor(r() * list.length) % list.length]; }
  collide(b, top) { this.props.game.collision.addBox(b.x, b.z, b.w / 2, b.d / 2, -b.yaw, b.base, b.y + top, 'building'); }

  foundation(F, b, col = GRANITE) {
    const drop = b.y - b.base;
    if (drop > .1) F.stack(this.S.box, this.M.stucco, 0, -drop, 0, b.w, drop + .05, b.d, BODY, mul(col, .9));
  }

  // ---------------------------------------------------------------- shared parts
  shopfront(F, b, r, { u0 = -b.w / 2 + .35, u1 = b.w / 2 - .35, h = 0, hh = 4.2, name = null, awning = r() < .6, signBg = null, nb = b.neighborhood } = {}) {
    const { S, M } = this, w = u1 - u0, uc = (u0 + u1) / 2, v = b.d / 2;
    const frame = r() < .5 ? DARK : mix(DARK, this.pick(AWNING, r), .5);
    F.stack(S.box, M.paint, uc, h, v + .04, w, .5, .12, NEAR, mul(frame, 1.2));
    F.stack(S.box, M.shop, uc, h + .5, v + .03, w - .08, hh - 1.6, .08, MID, mix(WHITE, this.pick(AWNING, r), .15));
    const n = Math.max(1, Math.round(w / 2.3));
    for (let k = 0; k <= n; k++) F.stack(S.box, M.metal, u0 + k * w / n, h + .5, v + .1, .1, hh - 1.6, .1, NEAR, frame);
    F.stack(S.box, M.metal, uc, h + hh - 1.15, v + .1, w, .09, .1, NEAR, frame);
    // recessed door at one end, dark against the glass
    const du = r() < .5 ? u0 + .8 : u1 - .8;
    F.stack(S.box, M.window, du, h + .02, v + .07, 1.0, 2.35, .05, NEAR, mul(WHITE, .6));
    F.stack(S.box, M.metal, du, h + 2.37, v + .1, 1.15, .08, .08, NEAR, frame);
    // sign band and lettering
    const label = name || this.pick(SHOPS[nb] || SHOPS.victorian, r);
    const band = signBg || byText(nb === 'chinatown' ? CHINA_SIGN : AWNING, label);
    F.stack(S.box, M.paint, uc, h + hh - 1.05, v + .08, w + .1, .9, .16, MID, mul(band, .9));
    const sign = this.signs.color(label, { bg: '#' + band.getHexString(), fg: '#f6ecd2' });
    F.put(S.plane, this.signs.material, uc, h + hh - .6, v + .17, Math.min(w - .5, Math.max(3, label.length * .32)), .62, 1, NEAR, sign);
    if (awning) {
      const a = this.pick(AWNING, r), depth = 1.3 + r() * .5;
      F.put(S.wedge, M.paint, uc, h + hh - 1.62, v + depth / 2 + .05, w - .2, .55, depth, NEAR, a);
      F.put(S.box, M.paint, uc, h + hh - 2.0, v + depth + .05, w - .2, .26, .03, NEAR, mul(a, .85));
    }
    F.stack(S.box, M.paint, uc, h + hh - .15, v + .1, w + .3, .18, .3, MID, mul(band, .7));
    this.shopCount++;
  }

  window(F, u, h, v, w, hh, trim, { hood = 'flat', range = NEAR, sill = true, accent = trim } = {}) {
    const { S, M } = this;
    F.put(S.box, M.window, u, h + hh / 2, v + .02, w, hh, .06, range, WHITE);
    for (const s of [-1, 1]) F.put(S.box, M.paint, u + s * (w / 2 + .05), h + hh / 2, v + .06, .12, hh + .1, .1, range, trim);
    F.put(S.box, M.paint, u, h + hh / 2, v + .06, .06, hh, .06, FINE, trim); // meeting rail of a double-hung
    if (sill) F.put(S.box, M.paint, u, h - .06, v + .12, w + .35, .12, .24, range, trim);
    if (hood === 'flat') F.put(S.box, M.paint, u, h + hh + .14, v + .12, w + .45, .22, .26, range, accent);
    else if (hood === 'pediment') {
      F.put(S.box, M.paint, u, h + hh + .1, v + .1, w + .4, .16, .22, range, accent);
      F.put(S.gable, M.paint, u, h + hh + .18, v + .1, w + .5, .42, .22, range, accent);
    } else if (hood === 'arch') F.put(S.arch, M.paint, u, h + hh, v + .08, w + .2, w * .55, 1.6, range, accent);
  }

  cornice(F, b, h, w, trim, accent, { brackets = .75, depth = .65, frieze = .5, dentils = false } = {}) {
    const { S, M } = this, v = b.d / 2;
    if (frieze) F.stack(S.box, M.paint, 0, h - frieze, v + .04, w, frieze, .12, MID, accent);
    F.stack(S.box, M.paint, 0, h, v + depth / 2 - .1, w + .3, .32, depth, MID, trim);
    F.stack(S.box, M.paint, 0, h + .32, v + depth / 2, w + .4, .12, depth + .1, MID, mul(trim, .92));
    if (brackets) for (let u = -w / 2 + .25; u <= w / 2 - .2; u += brackets) F.stack(S.box, M.paint, u, h - .5, v + .27, .16, .5, .5, FINE, trim);
    if (dentils) for (let u = -w / 2 + .15; u <= w / 2 - .1; u += .32) F.stack(S.box, M.paint, u, h - .14, v + .1, .14, .14, .16, FINE, trim);
  }

  fireEscape(F, b, u, w, levels, { v = b.d / 2, col = IRON } = {}) {
    const { S, M } = this;
    levels.forEach((h, i) => {
      F.put(S.box, M.metal, u, h, v + .55, w, .07, 1.0, NEAR, col);
      F.put(S.box, M.metal, u, h + 1.0, v + 1.03, w, .05, .05, NEAR, col);
      F.put(S.box, M.metal, u, h + .5, v + 1.03, w, .03, .03, FINE, col);
      for (const s of [-1, 1]) F.put(S.box, M.metal, u + s * w / 2, h + .5, v + .55, .05, 1.0, 1.0, FINE, col);
      for (let k = -1; k <= 1; k++) F.put(S.box, M.metal, u + k * w / 3, h + .5, v + 1.03, .035, 1.0, .035, FINE, col);
      const next = levels[i + 1];
      if (next !== undefined) {
        const rise = next - h, run = w * .85, len = Math.hypot(rise, run);
        F.put(S.box, M.metal, u + (i % 2 ? -1 : 1) * w * .05, h + rise / 2, v + .78, len, .05, .5, NEAR, col, { roll: (i % 2 ? -1 : 1) * Math.atan2(rise, run) });
      }
    });
    const low = levels[0];
    F.put(S.box, M.metal, u - w * .3, low - 1.1, v + .78, .4, 2.0, .04, FINE, col); // drop ladder
  }

  stoop(F, b, u, rise, { width = 1.6, run = 1.5, col = mul(GRANITE, 1.15), rail = IRON } = {}) {
    const { S, M } = this, v = b.d / 2, n = Math.max(3, Math.round(rise / .2)), step = rise / n, tread = run / n;
    for (let k = 0; k < n; k++) {
      const top = (k + 1) * step, out = run - k * tread;
      F.put(S.box, M.stucco, u, top / 2, v + out / 2 + .02, width, top, Math.max(tread, .02) + .02, NEAR, col);
    }
    for (const s of [-1, 1]) {
      F.put(S.wedge, M.stucco, u + s * (width / 2 + .1), rise / 2 + .05, v + run / 2, .2, rise + .1, run + .05, NEAR, mul(col, .92));
      F.put(S.box, M.metal, u + s * (width / 2 + .1), rise / 2 + .9, v + run / 2, .05, .05, Math.hypot(rise, run), FINE, rail, { pitch: Math.atan2(rise, run) });
    }
    const [x, z] = F.at(u, v + run / 2);
    this.props.game.collision.addBox(x, z, width / 2 + .2, run / 2, -b.yaw, b.y - .5, b.y + rise, 'building');
  }

  roofClutter(F, b, h, r, { count = 2, tank = false } = {}) {
    const { S, M } = this;
    for (let k = 0; k < count; k++) {
      const u = (r() - .5) * (b.w - 4), v = (r() - .5) * (b.d - 5) - 1;
      F.stack(S.box, M.metal, u, h, v, 1.2 + r() * 2.2, .9 + r() * 1.1, 1.2 + r() * 2, MID, mix(C('#9aa3a3'), C('#c9cbc6'), r()));
    }
    if (tank) {
      // wooden water tank on a steel stand, still common on SoMa lofts
      const u = (r() - .5) * (b.w - 6), v = -b.d * .2;
      for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.stack(S.box, M.metal, u + a * 1.2, h, v + c * 1.2, .15, 2.6, .15, MID, IRON);
      F.stack(S.cyl, M.paint, u, h + 2.6, v, 1.8, 3.4, 1.8, MID, C('#6d5848'));
      F.stack(S.cone8, M.paint, u, h + 6.0, v, 1.9, 1.2, 1.9, MID, C('#4b4038'));
      for (const y of [.7, 1.7, 2.7]) F.stack(S.cyl, M.metal, u, h + 2.6 + y, v, 1.83, .07, 1.83, FINE, IRON);
    }
  }

  // ---------------------------------------------------------------- Victorian rows
  victorian(F, b, r) {
    const { S, M } = this;
    const [body, trim, accent] = this.pick(LADIES, r);
    const w = b.w, d = b.d, pb = b.podium, fh = b.fh, floors = b.floors, top = pb + floors * fh;
    const variant = Math.floor(r() * 3); // 0 Italianate, 1 Stick-Eastlake, 2 Queen Anne
    const bayLeft = r() < .5, bu = (bayLeft ? -1 : 1) * (w / 2 - 1.75), eu = -Math.sign(bu) * (w / 2 - 1.45);
    const bw = Math.min(3.3, w * .45), bd = .85;
    const shop = b.shopStreet && r() < .7;
    // raised basement (or a ground-floor shop on the neighbourhood's main street)
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, mix(body, C('#8d8a82'), .45));
    F.stack(S.box, M.siding, 0, pb, 0, w, top - pb, d, BODY, body);
    if (shop) this.shopfront(F, b, r, { hh: pb + .6, u0: -w / 2 + .2, u1: w / 2 - .2, awning: r() < .5 });
    else if (r() < .55) {
      // garage under the bay: the classic SF retrofit
      F.stack(S.box, M.paint, bu, 0, d / 2 + .03, 2.5, 2.05, .06, NEAR, this.pick([WHITE, mul(trim, .95), mul(accent, .8), C('#7d7f7a')], r));
      F.stack(S.box, M.paint, bu, 2.05, d / 2 + .06, 2.8, .14, .12, NEAR, trim);
      for (let k = 1; k < 4; k++) F.stack(S.box, M.paint, bu, k * .51, d / 2 + .065, 2.5, .03, .03, FINE, mul(trim, .8));
    } else {
      this.window(F, bu, .7, d / 2, 1.3, .8, trim, { hood: null, sill: false });
    }
    // Canted bay over both floors, glazed on all three faces.
    const bayH = top - pb - .6;
    F.stack(bayShape(S, variant), M.paint, bu, pb + .25, d / 2 + bd / 2, bw, bayH, bd, MID, body);
    F.stack(bayShape(S, variant), M.paint, bu, pb - .05, d / 2 + bd / 2 + .04, bw + .3, .32, bd + .12, MID, accent); // corbel
    F.stack(bayShape(S, variant), M.paint, bu, top - .4, d / 2 + bd / 2 + .06, bw + .45, .38, bd + .2, MID, trim); // cap
    for (let f = 0; f < floors; f++) {
      const h = pb + f * fh + .85, wh = Math.min(2.05, fh - 1.25);
      this.window(F, bu, h, d / 2 + bd, bw * (variant === 1 ? .8 : .45) - .3, wh, trim, { hood: null, sill: false, range: NEAR });
      if (variant !== 1) for (const s of [-1, 1]) {
        const cu = bu + s * bw * .375, ang = s * Math.atan2(bd, bw / 4);
        const [x, z] = F.at(cu, d / 2 + bd / 2);
        this.B.add(S.box, M.window, x, b.y + h + wh / 2, z, Math.hypot(bw / 4, bd) - .45, wh, .07, b.yaw + ang, NEAR, WHITE);
      }
      // panel band under each bay window, picked out in the accent colour
      F.stack(bayShape(S, variant), M.paint, bu, h - .7, d / 2 + bd / 2 + .02, bw + .06, .45, bd + .05, NEAR, accent);
      if (f > 0) F.stack(S.box, M.paint, 0, pb + f * fh - .1, d / 2 + .06, w, .2, .14, NEAR, trim); // belt course
    }
    // Entrance: stoop, portico and the narrow upper windows above it.
    if (!shop) {
      this.stoop(F, b, eu, pb, { width: 1.5, run: 1.45 });
      F.stack(S.box, M.paint, eu, pb, d / 2 + .02, 1.05, 2.35, .08, NEAR, this.pick(DOOR, r));
      F.stack(S.box, M.window, eu, pb + 2.42, d / 2 + .03, 1.0, .45, .06, NEAR, WHITE);
      for (const s of [-1, 1]) F.stack(S.cyl, M.paint, eu + s * .78, pb, d / 2 + .45, .1, 2.75, .1, NEAR, trim);
      F.stack(S.box, M.paint, eu, pb + 2.75, d / 2 + .3, 1.95, .32, .72, NEAR, trim);
      if (variant !== 1) F.stack(S.gable, M.paint, eu, pb + 3.07, d / 2 + .32, 1.95, .5, .7, NEAR, accent);
    }
    for (let f = shop ? 0 : 1; f < floors; f++) {
      const h = pb + f * fh + .85;
      this.window(F, eu, h, d / 2, 1.0, Math.min(2.1, fh - 1.2), trim, { hood: variant === 0 ? 'pediment' : variant === 1 ? 'flat' : 'flat', accent });
    }
    // Roofline: bracketed cornice with a false front, or a Queen Anne gable.
    this.cornice(F, b, top, w, trim, accent, { brackets: .62, depth: .7, frieze: .45 });
    if (variant === 2) {
      const rise = 3.0, gd = 6.5;
      F.stack(S.gable, M.paint, 0, top + .44, d / 2 - gd / 2 + .3, w + .2, rise, gd, MID, body);
      F.stack(S.gable, M.paint, 0, top + .9, d / 2 + .33, w - .9, rise - .9, .08, NEAR, accent); // fish-scale shingle field
      this.window(F, 0, top + 1.2, d / 2 + .38, .8, 1.0, trim, { hood: null, sill: false });
      const pitch = Math.atan2(rise, w / 2 + .1), len = Math.hypot(rise, w / 2 + .4);
      for (const s of [-1, 1]) {
        F.put(S.box, M.paint, s * (w / 4 + .05), top + .44 + rise / 2, d / 2 - gd / 2 + .3, len, .16, gd + .5, MID, mul(DARK, 1.3), { roll: -s * pitch });
        F.put(S.box, M.paint, s * (w / 4 + .05), top + .5 + rise / 2, d / 2 + .52, len, .2, .12, NEAR, trim, { roll: -s * pitch });
      }
      if ((b.openL || b.openR) && w > 7) {
        // corner turret with a candle-snuffer roof
        const tu = (b.openL ? -1 : 1) * (w / 2 - .4);
        F.stack(S.cyl8, M.paint, tu, pb + fh, d / 2 - .1, 1.3, top - pb - fh + .3, 1.3, MID, body);
        F.stack(S.cone8, M.paint, tu, top + .3, d / 2 - .1, 1.45, 3.4, 1.45, MID, mul(DARK, 1.3));
        for (let k = -1; k <= 1; k++) {
          const a = k * .8, [x, z] = F.at(tu + Math.sin(a) * 1.25, d / 2 - .1 + Math.cos(a) * 1.25);
          this.B.add(S.box, M.window, x, b.y + top - 1.35, z, .55, 1.5, .06, b.yaw + a, NEAR, WHITE);
        }
      }
    } else {
      F.stack(S.box, M.siding, 0, top + .44, d / 2 - .15, w, variant === 0 ? .95 : .6, .3, MID, body); // false front
      F.stack(S.box, M.paint, 0, top + .44 + (variant === 0 ? .95 : .6), d / 2 - .1, w + .2, .14, .45, MID, trim);
      if (variant === 1) F.stack(S.gable, M.paint, bu, top + .44, d / 2 + .2, bw + .4, .7, .4, NEAR, accent);
    }
    F.stack(S.box, M.stucco, -bu * .4, top, -d * .3, .7, 1.8, .9, MID, C('#8c4b3c')); // chimney
  }

  // ---------------------------------------------------------------- Edwardian flats
  edwardian(F, b, r) {
    const { S, M } = this;
    const wood = r() < .35;
    const body = wood ? this.pick(LADIES, r)[0] : this.pick(STUCCO, r);
    const trim = wood ? this.pick(LADIES, r)[1] : mix(body, WHITE, .65), accent = wood ? this.pick(LADIES, r)[2] : mul(body, .78);
    const w = b.w, d = b.d, pb = b.podium, fh = b.fh, top = pb + b.floors * fh;
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, mix(body, C('#9a968c'), .35));
    F.stack(S.box, wood ? M.siding : M.masonry, 0, pb, 0, w, top - pb, d, BODY, body);
    const bays = w > 11 ? [-w / 4, w / 4] : [(r() < .5 ? -1 : 1) * (w / 2 - 1.9)];
    const square = r() < .4, bw = 3.0, bd = .8;
    for (const bu of bays) {
      const shape = square ? S.box : S.bay;
      F.stack(shape, M.paint, bu, pb + .3, d / 2 + bd / 2, bw, top - pb - .9, bd, MID, body);
      F.stack(shape, M.paint, bu, top - .6, d / 2 + bd / 2 + .05, bw + .35, .32, bd + .18, MID, trim);
      F.stack(shape, M.paint, bu, pb, d / 2 + bd / 2 + .03, bw + .2, .3, bd + .08, MID, accent);
      for (let f = 0; f < b.floors; f++) {
        const h = pb + f * fh + .8;
        this.window(F, bu, h, d / 2 + bd, square ? 2.4 : 1.25, fh - 1.25, trim, { hood: null, sill: false });
        if (!square) for (const s of [-1, 1]) {
          const cu = bu + s * bw * .375, [x, z] = F.at(cu, d / 2 + bd / 2);
          this.B.add(S.box, M.window, x, b.y + h + (fh - 1.25) / 2, z, Math.hypot(bw / 4, bd) - .4, fh - 1.25, .07, b.yaw + s * Math.atan2(bd, bw / 4), NEAR, WHITE);
        }
        F.stack(shape, M.paint, bu, h - .62, d / 2 + bd / 2 + .02, bw + .05, .4, bd + .04, NEAR, accent);
      }
    }
    if (wood) for (let f = 0; f < b.floors; f++) {
      const u = bays.length > 1 ? 0 : -bays[0] * .55;
      this.window(F, u, pb + f * fh + .8, d / 2, 1.0, fh - 1.3, trim, { hood: 'flat', accent });
    }
    // Ground floor: shops on main streets, otherwise garages and a recessed entry.
    if (b.shopStreet || b.neighborhood === 'northbeach') this.shopfront(F, b, r, { hh: pb + .2 });
    else {
      const doors = w > 11 ? [-w / 4, w / 4] : [bays[0]];
      for (const u of doors) {
        F.stack(S.box, M.paint, u, 0, d / 2 + .03, 2.5, 2.1, .06, NEAR, this.pick([WHITE, mul(trim, .9), C('#7d7f7a'), mul(accent, .9)], r));
        F.stack(S.box, M.paint, u, 2.1, d / 2 + .06, 2.8, .14, .12, NEAR, trim);
      }
      const eu = w > 11 ? 0 : -bays[0] * .6;
      F.stack(S.box, M.paint, eu, .3, d / 2 + .02, 1.3, 2.3, .06, NEAR, mul(DARK, 1.5));
      this.stoop(F, b, eu, .45, { width: 1.4, run: .5 });
    }
    this.cornice(F, b, top, w, trim, accent, { brackets: .9, depth: .75, frieze: .4, dentils: true });
    F.stack(S.box, wood ? M.siding : M.stucco, 0, top + .44, d / 2 - .15, w, .7, .3, MID, body);
    if (!wood && r() < .3) this.fireEscape(F, b, bays.length > 1 ? 0 : -bays[0] * .5, 2.4, Array.from({ length: b.floors }, (_, f) => pb + f * fh + .05).slice(0, 4), { v: d / 2 + .05 });
    this.roofClutter(F, b, top, r, { count: 1 });
  }

  // ---------------------------------------------------------------- Nob Hill / Russian Hill apartments
  apartment(F, b, r) {
    const { S, M } = this;
    const body = this.pick(STONE, r), base = mul(body, .78), trim = mix(body, WHITE, .45);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.masonry, 0, 0, 0, w, pb, d, BODY, base);
    F.stack(S.box, M.masonry, 0, pb, 0, w, top - pb, d, BODY, body);
    F.stack(S.box, M.paint, 0, pb - .1, d / 2 + .2, w + .3, .45, .45, MID, trim);
    // rusticated ground floor: horizontal grooves
    for (let h = .6; h < pb - .3; h += .55) F.stack(S.box, M.paint, 0, h, d / 2 + .03, w, .07, .05, FINE, mul(base, .8));
    if (r() < .55) {
      // stacked masonry bays, windows drawn by the facade shader on every face
      const n = w > 22 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const bu = -w / 2 + w * (k + .5) / n;
        F.stack(S.box, M.masonry, bu, pb + .5, d / 2 + .45, 3.8, top - pb - 1.6, .9, BODY, body);
        F.stack(S.box, M.paint, bu, top - 1.1, d / 2 + .5, 4.1, .3, 1.05, MID, trim);
      }
    }
    // the Nob Hill canopy: runs out to the curb on two slim poles
    const number = `${1000 + Math.floor(r() * 8) * 150}`;
    const eu = (r() - .5) * (w - 6), canopy = byText([C('#2e4b3c'), C('#6b2328'), C('#22324a'), C('#3a3a3a')], number);
    F.stack(S.box, M.shop, eu, 0, d / 2 + .03, 2.4, 3.1, .07, NEAR, WHITE);
    F.stack(S.box, M.paint, eu, 3.25, d / 2 + 1.8, 2.4, .28, 3.6, NEAR, canopy);
    F.stack(S.box, M.paint, eu, 3.18, d / 2 + 1.8, 2.46, .1, 3.65, FINE, BRASS);
    for (const s of [-1, 1]) F.stack(S.cyl, M.chrome, eu + s * 1.1, 0, d / 2 + 3.45, .04, 3.25, .04, NEAR, BRASS);
    const sign = this.signs.color(number, { bg: '#' + canopy.getHexString(), fg: '#e8d9a8', font: 'bold 44px Georgia, serif' });
    for (const s of [-1, 1]) {
      const [x, z] = F.at(eu + s * 1.23, d / 2 + 1.8);
      this.B.add(S.plane, this.signs.material, x, b.y + 3.39, z, 2.6, .24, 1, b.yaw + s * Math.PI / 2, FINE, sign);
    }
    if (r() < .5) this.shopfront(F, b, r, { u0: eu + 1.6, u1: w / 2 - .4, hh: pb - .4, awning: true });
    this.cornice(F, b, top, w, trim, mul(body, .9), { brackets: 1.1, depth: 1.1, frieze: .7, dentils: true });
    F.stack(S.box, M.masonry, 0, top + .44, d / 2 - .2, w, .8, .4, MID, body);
    F.stack(S.box, M.paint, 0, top - fhBand(b), d / 2 + .1, w + .2, .25, .25, MID, trim);
    if (r() < .35) this.fireEscape(F, b, (r() - .5) * (w - 6), 3.0, Array.from({ length: b.floors }, (_, f) => pb + f * b.fh + .05));
    F.stack(S.box, M.masonry, (r() - .5) * 4, top, -d * .15, Math.min(9, w * .4), 3.2, Math.min(8, d * .35), MID, mul(body, .95)); // penthouse
    this.roofClutter(F, b, top, r, { count: 2 });
  }

  midcentury(F, b, r) {
    const { S, M } = this;
    const body = this.pick(P(['#efede6', '#e3dccb', '#cdd6d8', '#d9cdb7', '#c8d3c0', '#f2e6d0']), r);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, mul(body, .85));
    F.stack(S.box, M.ribbon, 0, pb, 0, w, top - pb, d, BODY, body);
    // balconies with glass rails
    const cols = Math.max(1, Math.floor(w / 7));
    for (let f = 0; f < b.floors; f++) for (let k = 0; k < cols; k++) {
      const u = -w / 2 + w * (k + .5) / cols, h = pb + f * b.fh;
      F.stack(S.box, M.paint, u, h - .08, d / 2 + .65, 3.6, .16, 1.3, NEAR, mul(body, .95));
      F.stack(S.box, M.window, u, h + .08, d / 2 + 1.28, 3.6, .95, .04, FINE, C('#9fb7bd'));
      F.stack(S.box, M.metal, u, h + 1.02, d / 2 + 1.3, 3.65, .05, .07, FINE, C('#c8cccc'));
    }
    F.stack(S.box, M.paint, 0, top - .05, 0, w + 1.2, .3, d + 1.2, MID, mul(body, .9));
    for (const u of [-w / 4, w / 4]) F.stack(S.box, M.paint, u, 0, d / 2 + .03, 2.6, 2.2, .06, NEAR, C('#8d9496'));
    F.stack(S.box, M.shop, 0, 0, d / 2 + .03, 2.2, 2.5, .07, NEAR, WHITE);
    this.roofClutter(F, b, top, r, { count: 2 });
  }

  // ---------------------------------------------------------------- Chinatown
  chinatown(F, b, r) {
    const { S, M } = this;
    const brick = r() < .45;
    const body = brick ? this.pick(BRICK, r) : this.pick(CHINA_STUCCO, r);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, brick ? M.brick : M.masonry, 0, pb, 0, w, top - pb, d, BODY, body);
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, mul(body, .8));
    this.shopfront(F, b, r, { hh: pb, awning: r() < .75, nb: 'chinatown' });
    // produce stand on the sidewalk
    if (r() < .35) {
      const u = (r() - .5) * (w - 3);
      F.stack(S.box, M.paint, u, 0, d / 2 + .9, 2.4, .8, .9, FINE, C('#6b5236'));
      for (let k = 0; k < 6; k++) F.stack(S.box, M.paint, u - 1 + k * .4, .8, d / 2 + .9, .36, .16, .8, FINE, this.pick(P(['#d23f2f', '#e6a522', '#5c8f2f', '#f2d24b', '#c7652a']), r));
    }
    // balconies with painted railings on the upper floors
    const rail = this.pick(CHINA_RAIL, r), bal = r() < .65;
    for (let f = 0; f < b.floors; f++) {
      const h = pb + f * b.fh;
      if (bal && f < b.floors) {
        const bw = w * (r() < .5 ? .9 : .6);
        F.stack(S.box, M.paint, 0, h - .05, d / 2 + .5, bw, .14, 1.0, NEAR, mul(body, .9));
        F.stack(S.box, M.paint, 0, h + .95, d / 2 + .98, bw, .08, .08, NEAR, rail);
        F.stack(S.box, M.paint, 0, h + .3, d / 2 + .98, bw, .06, .06, FINE, rail);
        for (let u = -bw / 2; u <= bw / 2 + .01; u += .45) F.stack(S.box, M.paint, u, h + .09, d / 2 + .98, .05, .86, .05, FINE, rail);
        for (const s of [-1, 1]) F.stack(S.box, M.paint, s * bw / 2, h + .09, d / 2 + .5, .06, .9, .95, FINE, rail);
        // lanterns hung from the balcony soffit
        for (let k = 0; k < 2; k++) {
          const u = (k - .5) * bw * .5;
          F.put(S.sphere, M.paint, u, h - .45, d / 2 + .7, .38, .5, .38, FINE, C('#c8201e'));
          F.put(S.box, M.paint, u, h - .17, d / 2 + .7, .02, .2, .02, FINE, IRON);
        }
      }
    }
    // Roofline: green-tiled eaves with upturned corners, red fascia
    const eave = C('#3f7f54'), fascia = C('#a8322d');
    if (r() < .55) {
      F.put(S.wedge, M.paint, 0, top + .55, d / 2 + .55, w + .9, .8, 1.4, MID, eave);
      F.stack(S.box, M.paint, 0, top - .05, d / 2 + .2, w, .3, .3, MID, fascia);
      for (const s of [-1, 1]) F.put(S.box, M.paint, s * (w / 2 + .45), top + .4, d / 2 + 1.1, .9, .14, .35, NEAR, eave, { roll: s * .45 });
      F.stack(S.box, M.paint, 0, top + .95, d / 2 - .1, w + .2, .3, .45, MID, eave);
    } else {
      this.cornice(F, b, top, w, mix(body, WHITE, .5), fascia, { brackets: 0, depth: .5, frieze: .35 });
    }
    if (r() < .18 && (b.openL || b.openR)) {
      // pagoda tower on the corner, after the 1909 Sing Chong and Sing Fat buildings
      const tu = (b.openL ? -1 : 1) * (w / 2 - 2.2), tv = d / 2 - 2.2, t0 = top + .2;
      F.stack(S.box, M.paint, tu, t0, tv, 3.4, 2.8, 3.4, MID, fascia);
      for (const s of [-1, 1]) for (const q of [-1, 1]) F.stack(S.box, M.paint, tu + s * 1.6, t0, tv + q * 1.6, .24, 2.8, .24, NEAR, C('#e0b034'));
      F.stack(S.pyramid, M.paint, tu, t0 + 2.8, tv, 5.2, 1.4, 5.2, MID, eave);
      F.stack(S.box, M.paint, tu, t0 + 4.2, tv, 2.2, 1.6, 2.2, MID, fascia);
      F.stack(S.pyramid, M.paint, tu, t0 + 5.8, tv, 3.6, 1.8, 3.6, MID, eave);
      F.stack(S.cyl, M.paint, tu, t0 + 7.5, tv, .08, 1.4, .08, NEAR, C('#e0b034'));
    }
    if (r() < .45) {
      // vertical blade sign with neon characters
      const u = (r() < .5 ? -1 : 1) * (w / 2 - .6), text = this.pick(BLADES, r);
      const sign = this.blades.color(text, { bg: byText(['#7a1010', '#0f3d2a', '#1d1d1d', '#b8860b'], text), fg: byText(['#ffe27a', '#ff6b5a', '#7fffd4', '#ffffff'], text + '.'), font: 'bold 54px "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif' });
      const h = pb + .6, len = Math.min(top - pb - 1, 5.2);
      for (const s of [-1, 1]) {
        const [x, z] = F.at(u + s * .06, d / 2 + .75);
        this.B.add(S.plane, this.blades.material, x, b.y + h + len / 2, z, 1.1, len, 1, b.yaw + s * Math.PI / 2, NEAR, sign);
      }
      F.stack(S.box, M.metal, u, h + len - .1, d / 2 + .3, .05, .05, .6, FINE, IRON);
    }
  }

  // ---------------------------------------------------------------- downtown masonry
  commercial(F, b, r) {
    const { S, M } = this;
    const body = this.pick(STONE, r), base = mul(this.pick([GRANITE, body, C('#5d5a55')], r), .9), trim = mix(body, WHITE, .35);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    const mat = r() < .4 ? M.masonryGrid : M.masonryTall;
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, base);
    const attic = b.floors > 8 ? 2 * b.fh : 0;
    F.stack(S.box, mat, 0, pb, 0, w, top - pb - attic, d, BODY, body);
    if (attic) {
      F.stack(S.box, M.masonryTall, 0, top - attic, 0, w, attic, d, BODY, mix(body, WHITE, .2));
      F.stack(S.box, M.paint, 0, top - attic - .2, d / 2 + .3, w + .4, .4, .6, MID, trim);
    }
    if (mat === M.masonryGrid) {
      // pilasters between the shader's window bays
      for (const u of gridBays(w, M.masonryGrid.userData.bay, .75)) F.stack(S.box, M.paint, u, pb + .3, d / 2 + .12, .5, top - pb - attic - .6, .25, MID, mix(body, WHITE, .15));
    }
    // ground floor: stone piers and tall shop windows
    const bays = Math.max(2, Math.round(w / 4.5));
    for (let k = 0; k <= bays; k++) F.stack(S.box, M.stucco, -w / 2 + .35 + k * (w - .7) / bays, 0, d / 2 + .15, .7, pb, .3, MID, mul(base, .95));
    for (let k = 0; k < bays; k++) {
      const u = -w / 2 + .35 + (k + .5) * (w - .7) / bays;
      F.stack(S.box, M.shop, u, .45, d / 2 + .04, (w - .7) / bays - .75, pb - 1.2, .08, MID, WHITE);
      if (k === Math.floor(bays / 2)) {
        F.stack(S.box, M.metal, u, pb - .7, d / 2 + .25, (w - .7) / bays - .7, .5, .1, NEAR, BRASS);
      }
    }
    const shopName = this.pick(SHOPS[b.neighborhood] || SHOPS.unionsq, r), band = byText(AWNING, shopName);
    F.put(S.plane, this.signs.material, 0, pb - .45, d / 2 + .32, Math.min(w * .5, 9), .5, 1, NEAR, this.signs.color(shopName, { bg: '#' + band.getHexString(), fg: '#f3e6c4', font: 'bold 40px Georgia, serif' }));
    F.stack(S.box, M.paint, 0, pb - .2, d / 2 + .35, w + .5, .5, .7, MID, trim);
    this.cornice(F, b, top, w, trim, mul(body, .92), { brackets: 1.2, depth: 1.25, frieze: .8, dentils: true });
    F.stack(S.box, mat, 0, top + .44, d / 2 - .25, w, 1.1, .5, MID, body);
    if (b.neighborhood === 'unionsq' && r() < .5) {
      // flagpoles and a vertical HOTEL sign, Union Square style
      for (let k = 0; k < 3; k++) {
        const u = (k - 1) * Math.min(5, w / 4);
        F.put(S.box, M.chrome, u, pb + 2.2, d / 2 + 1.0, .06, .06, 2.4, NEAR, WHITE, { pitch: -.6 });
        F.put(S.box, M.paint, u, pb + 1.6, d / 2 + 1.9, .02, 1.0, 1.5, NEAR, this.pick(AWNING, r), { pitch: -.6 });
      }
      if (r() < .6) {
        const u = (r() < .5 ? -1 : 1) * (w / 2 - .8), sign = this.blades.color('HOTEL', { bg: '#1c1c1c', fg: '#ff5a3c', font: 'bold 62px "Barlow Condensed", sans-serif' });
        const len = Math.min(9, top - pb - 4);
        for (const s of [-1, 1]) {
          const [x, z] = F.at(u + s * .07, d / 2 + .95);
          this.B.add(S.plane, this.blades.material, x, b.y + pb + 2 + len / 2, z, 1.5, len, 1, b.yaw + s * Math.PI / 2, MID, sign);
        }
      }
    }
    if (r() < .25) this.fireEscape(F, b, w / 2 - 2.5, 2.6, Array.from({ length: Math.min(b.floors, 8) }, (_, f) => pb + f * b.fh + .05));
    F.stack(S.box, M.masonry, (r() - .5) * w * .3, top, -d * .2, Math.min(8, w * .35), 3.6, Math.min(7, d * .3), MID, mul(body, .9));
    this.roofClutter(F, b, top, r, { count: 3 });
  }

  // Art Deco tower: base, two setbacks, a stepped crown and a finial.
  deco(F, b, r) {
    const { S, M } = this;
    const body = this.pick(DECO, r), trim = mix(body, WHITE, .3), dark = mul(body, .72);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, mul(GRANITE, .85));
    const tiers = [[0, pb, top * .6], [2.6, top * .6, top * .82], [5.4, top * .82, top * .94]];
    for (const [inset, h0, h1] of tiers) {
      const tw = w - inset * 2, td = d - inset * 2;
      F.stack(S.box, M.masonryGrid, 0, h0, 0, tw, h1 - h0, td, FAR, body);
      F.stack(S.box, M.paint, 0, h1 - .2, 0, tw + .3, .4, td + .3, BODY, trim);
      // continuous vertical piers aligned with the window bays
      for (const face of [1, -1]) for (const u of gridBays(tw, M.masonryGrid.userData.bay, .75)) F.stack(S.box, M.paint, u, h0 + .2, face * (td / 2 + .12), .45, h1 - h0 - .4, .24, BODY, mix(body, WHITE, .12));
      for (const face of [1, -1]) for (const v of gridBays(td, M.masonryGrid.userData.bay, .75)) {
        const [x, z] = F.at(face * (tw / 2 + .12), v);
        this.B.add(S.box, M.paint, x, b.y + (h0 + h1) / 2, z, .24, h1 - h0 - .4, .45, b.yaw, BODY, mix(body, WHITE, .12));
      }
    }
    const cw = w - 13;
    F.stack(S.box, M.paint, 0, top * .94, 0, cw, top * .05, cw, FAR, trim);
    F.stack(S.box, M.paint, 0, top * .99, 0, cw * .6, top * .035, cw * .6, FAR, trim);
    F.stack(S.pyramid, M.paint, 0, top * 1.025, 0, cw * .45, top * .04, cw * .45, FAR, dark);
    F.stack(S.cyl, M.chrome, 0, top * 1.06, 0, .25, 9, .25, FAR, WHITE);
    // entrance: tall bronze-framed portal
    F.stack(S.box, M.shop, 0, 0, d / 2 + .05, 6, pb - .6, .08, MID, WHITE);
    F.stack(S.box, M.metal, 0, pb - .6, d / 2 + .15, 6.6, .6, .3, MID, BRASS);
    this.shopfront(F, b, r, { u0: 3.6, u1: w / 2 - .5, hh: pb - .3, awning: false });
  }

  glass(F, b, r) {
    const { S, M } = this;
    const tint = this.pick(GLASS, r), light = r() < .35, mat = light ? M.glassLight : M.glass;
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    // recessed glass lobby under the tower
    F.stack(S.box, M.shop, 0, 0, 0, w - 2.4, pb, d - 2.4, BODY, WHITE);
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.stack(S.box, M.paint, u * (w / 2 - .8), 0, v * (d / 2 - .8), 1.2, pb, 1.2, MID, CONCRETE);
    F.stack(S.box, M.paint, 0, pb - .4, d / 2 + 1.2, w * .45, .3, 2.6, MID, mul(CONCRETE, .8));
    const style = [0, 0, 1, 1, 2, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 3][Math.floor(r() * 20)]; // X-bracing stays rare, like 181 Fremont
    let roof = top;
    if (style === 1) {
      // setback near the top
      const s = top * .74;
      F.stack(S.box, mat, 0, pb, 0, w, s - pb, d, FAR, tint);
      F.stack(S.box, mat, 0, s, 0, w - 6, top - s, d - 6, FAR, tint);
    } else F.stack(S.box, mat, 0, pb, 0, w, top - pb, d, FAR, tint);
    if (style === 2) {
      // vertical fins on every face
      const fin = light ? WHITE : mul(tint, .6);
      for (const face of [1, -1]) {
        for (let u = -w / 2 + 1.5; u <= w / 2 - 1.4; u += 3) F.stack(S.box, M.paint, u, pb + .5, face * (d / 2 + .2), .14, top - pb - .5, .5, BODY, fin);
        for (let v = -d / 2 + 1.5; v <= d / 2 - 1.4; v += 3) {
          const [x, z] = F.at(face * (w / 2 + .2), v);
          this.B.add(S.box, M.paint, x, b.y + (pb + top) / 2, z, .5, top - pb - .5, .14, b.yaw, BODY, fin);
        }
      }
    }
    if (style === 3) {
      // exposed diagonal bracing, as on 181 Fremont
      const steel = light ? WHITE : C('#c7cdd0'), mod = 8 * b.fh;
      for (let h = pb; h + mod <= top + .1; h += mod) for (const face of [1, -1]) for (const s of [-1, 1]) {
        const ang = Math.atan2(mod, w - 2);
        F.put(S.box, M.paint, 0, h + mod / 2, face * (d / 2 + .35), Math.hypot(mod, w - 2), .7, .5, BODY, steel, { roll: s * ang });
      }
    }
    // crown: mechanical screen, sometimes a mast
    F.stack(S.box, mat, 0, roof, 0, (style === 1 ? w - 6 : w) - 3, 5.5, (style === 1 ? d - 6 : d) - 3, FAR, mul(tint, .85));
    if (r() < .3) F.stack(S.cyl, M.chrome, 0, roof + 5.5, 0, .3, 12 + r() * 10, .3, FAR, WHITE);
    this.shopfront(F, b, r, { u0: -w / 2 + 1.4, u1: -1.5, hh: Math.min(pb - .5, 4.6), awning: false });
  }

  slab(F, b, r) {
    const { S, M } = this;
    const body = this.pick(P(['#cfc8b8', '#d8d2c4', '#c2bcae']), r);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.shop, 0, 0, 0, w - 3, pb, d - 3, BODY, WHITE);
    F.stack(S.box, M.masonry, 0, pb, 0, w, top - pb, d, FAR, body);
    // serrated bays: rows of projecting vertical fins catch the light like the Embarcadero Center
    for (const face of [1, -1]) for (let u = -w / 2 + 1.5; u <= w / 2 - 1.4; u += 2.8)
      F.put(S.box, M.paint, u, (pb + top) / 2, face * (d / 2 + .35), .35, top - pb, .7, BODY, mul(body, 1.08), { yaw: Math.PI / 4 });
    F.stack(S.box, M.paint, 0, top, 0, w - 4, 3.5, d - 4, FAR, mul(body, .9));
    for (const u of [-w / 3, 0, w / 3]) F.stack(S.box, M.paint, u, pb - .4, d / 2 + 1.5, 6, .3, 3, MID, mul(CONCRETE, .85));
  }

  // ---------------------------------------------------------------- SoMa
  loft(F, b, r) {
    const { S, M } = this;
    const painted = r() < .3, body = painted ? this.pick(PAINTED_BRICK, r) : this.pick(BRICK, r);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.brick, 0, 0, 0, w, top, d, BODY, body);
    // ground floor: loading door, loft glazing and a brewpub or gallery front
    const bays = Math.max(2, Math.round(w / 5));
    for (let k = 0; k < bays; k++) {
      const u = -w / 2 + (k + .5) * w / bays, bw = w / bays - 1.2;
      if (k === 0 && r() < .6) {
        F.stack(S.box, M.paint, u, 0, d / 2 + .04, bw, 3.6, .06, NEAR, C('#8d9192'));
        for (let h = .3; h < 3.6; h += .3) F.stack(S.box, M.paint, u, h, d / 2 + .075, bw, .03, .02, FINE, C('#6c7071'));
      } else {
        F.stack(S.box, M.shop, u, .5, d / 2 + .04, bw, pb - 1.3, .08, MID, WHITE);
        F.put(S.arch, M.paint, u, pb - 1.0 - bw * .5, d / 2 + .1, bw + .1, bw + .1, .5, NEAR, mix(body, WHITE, .3));
      }
    }
    if (r() < .55) this.shopfront(F, b, r, { u0: -w / 2 + w / bays + .3, u1: Math.min(w / 2 - .4, -w / 2 + 3 * w / bays), hh: pb - .2, awning: r() < .4, nb: 'soma' });
    // stepped parapet and corbelled cornice
    const trim = mix(body, WHITE, .25);
    F.stack(S.box, M.paint, 0, top - .5, d / 2 + .12, w + .2, .35, .25, MID, trim);
    F.stack(S.box, M.brick, 0, top, d / 2 - .2, w, 1.0, .4, MID, body);
    F.stack(S.box, M.brick, 0, top + 1.0, d / 2 - .2, w * .36, .9, .4, MID, body);
    F.stack(S.box, M.paint, 0, top + 1.9, d / 2 - .2, w * .36 + .2, .15, .55, NEAR, trim);
    if (r() < .4) this.fireEscape(F, b, (r() - .5) * (w - 6), 2.8, Array.from({ length: b.floors }, (_, f) => pb + f * b.fh + .05));
    // faded ghost sign on an exposed side wall
    if ((b.openL || b.openR) && r() < .75) {
      const side = b.openL ? -1 : 1, text = this.pick(GHOST_SIGNS, r);
      const sign = this.cutouts.color(text, { glow: 0, draw: ghostSign });
      const [x, z] = F.at(side * (w / 2 + .03), d * .1);
      this.B.add(S.plane, this.cutouts.material, x, b.y + top - 3.2, z, Math.min(d - 3, 18), 2.6, 1, b.yaw + side * Math.PI / 2, MID, sign);
    }
    this.roofClutter(F, b, top, r, { count: 2, tank: r() < .35 });
  }

  modern(F, b, r) {
    const { S, M } = this;
    const tint = this.pick(GLASS, r), panel = this.pick(PANELS, r);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.shop, 0, 0, 0, w - .4, pb, d - .4, BODY, WHITE);
    F.stack(S.box, M.glass, 0, pb, 0, w, top - pb, d, BODY, tint);
    // coloured fin panels and balconies give SoMa's newer blocks their rhythm
    for (let u = -w / 2 + 1.6; u <= w / 2 - 1; u += 4.2 + (r() < .4 ? 2.4 : 0)) {
      const len = (top - pb) * (.5 + r() * .5);
      F.stack(S.box, M.paint, u, top - len, d / 2 + .2, .45, len, .4, BODY, r() < .5 ? panel : mix(WHITE, panel, .15));
    }
    for (let f = 1; f < b.floors; f += 1) {
      if (r() < .4) continue;
      const u = (r() - .5) * (w - 5), h = pb + f * b.fh;
      F.stack(S.box, M.paint, u, h - .1, d / 2 + .8, 3.4, .15, 1.6, NEAR, CONCRETE);
      F.stack(S.box, M.window, u, h + .05, d / 2 + 1.58, 3.4, 1.0, .04, FINE, C('#a8c0c4'));
    }
    F.stack(S.box, M.paint, 0, top, 0, w + .3, .5, d + .3, MID, C('#7d7f7c'));
    this.shopfront(F, b, r, { hh: pb - .1, awning: false, nb: b.neighborhood === 'transbay' ? 'transbay' : 'soma' });
  }

  shop(F, b, r) {
    const { S, M } = this;
    const body = this.pick([...STUCCO, ...STONE], r);
    const w = b.w, d = b.d, pb = b.podium, top = pb + b.floors * b.fh;
    F.stack(S.box, M.stucco, 0, 0, 0, w, pb, d, BODY, mul(body, .85));
    F.stack(S.box, M.masonry, 0, pb, 0, w, top - pb, d, BODY, body);
    this.shopfront(F, b, r, { hh: pb, nb: 'waterfront' });
    this.cornice(F, b, top, w, mix(body, WHITE, .4), mul(body, .85), { brackets: 1, depth: .8, frieze: .5 });
  }
}

const fhBand = (b) => b.fh + .3;
function bayShape(S, variant) { return variant === 1 ? S.box : S.bay; }

// Centre lines between the window bays of a fixed-grid facade (matches the shader).
export function gridBays(fw, bayT, pier) {
  const usable = fw - 2 * pier, nb = Math.max(1, Math.floor(usable / bayT + .5)), bw = usable / nb, out = [];
  for (let k = 0; k <= nb; k++) out.push(-fw / 2 + pier + k * bw);
  return out;
}

function ghostSign(g, W, H, text) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(70,40,30,.0)'; g.fillRect(0, 0, W, H);
  g.font = 'bold 30px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(232,222,196,.85)';
  g.fillText(text, W / 2, H / 2 + 2);
  g.strokeStyle = 'rgba(232,222,196,.7)'; g.lineWidth = 3; g.strokeRect(10, 6, W - 20, H - 12);
  // weathering: knock out flakes of paint
  for (let i = 0; i < 260; i++) { g.clearRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 7, 1 + Math.random() * 4); }
}
