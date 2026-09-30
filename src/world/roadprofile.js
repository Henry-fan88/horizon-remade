// Road cross-section and profile helpers shared by world generation (terrain carve),
// the road ribbon meshes and the physics road surface, so all three agree exactly.
// Lateral offsets are positive to the right of the road's point order (right = (-tz, tx)).

// crown: cross slope at the edge of a straight road; emax: largest superelevation;
// vd: design speed (m/s) that sets how quickly curves reach full banking.
export const ROAD_CROSS = {
  highway: { crown: 0.02, emax: 0.05, vd: 36 },
  road: { crown: 0.02, emax: 0.07, vd: 26 },
  street: { crown: 0.02, emax: 0, vd: 0 },
  runway: { crown: 0.01, emax: 0, vd: 0 },
  dirt: { crown: 0.03, emax: 0.06, vd: 18 },
  // race circuit: light crown for drainage and a little camber in the corners
  track: { crown: 0.012, emax: 0.035, vd: 40 },
};

const G = 9.81;

// Signed superelevation per road sample (slope, rise per metre toward the right).
// Banking follows curvature smoothed over ~40 m so it rolls in and out gently.
export function computeBank(pts, closed, kind) {
  const n = pts.length / 3;
  const P = ROAD_CROSS[kind] || ROAD_CROSS.road;
  const bank = new Float32Array(n);
  if (!P.emax || n < 8) return bank;
  const K = 5; // samples (10 m) either side for the curvature estimate
  const raw = new Float32Array(n);
  const at = (i) => (closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i)));
  for (let i = 0; i < n; i++) {
    const a = at(i - K),
      b = at(i),
      c = at(i + K);
    const ax = pts[b * 3] - pts[a * 3],
      az = pts[b * 3 + 2] - pts[a * 3 + 2];
    const bx = pts[c * 3] - pts[b * 3],
      bz = pts[c * 3 + 2] - pts[b * 3 + 2];
    const la = Math.hypot(ax, az),
      lb = Math.hypot(bx, bz);
    if (la < 1e-3 || lb < 1e-3) continue;
    // cross > 0 when the road bends toward its right-hand side (right = (-tz, tx))
    const cross = (ax * bz - az * bx) / (la * lb);
    const kappaRight = Math.asin(Math.max(-1, Math.min(1, cross))) / ((la + lb) / 2);
    // outside of the curve goes up: a right-hand bend lowers the right edge
    raw[i] = Math.max(-P.emax, Math.min(P.emax, (-kappaRight * P.vd * P.vd) / G * 0.35));
  }
  // smooth the banking so it transitions over ~40 m
  const R = 10;
  for (let i = 0; i < n; i++) {
    let s = 0,
      w = 0;
    for (let k = -R; k <= R; k++) {
      const j = closed ? ((i + k) % n + n) % n : i + k;
      if (j < 0 || j >= n) continue;
      const q = 1 - Math.abs(k) / (R + 1);
      s += raw[j] * q;
      w += q;
    }
    bank[i] = s / w;
  }
  if (!closed) {
    // flat ends so junctions meet level
    for (let i = 0; i < Math.min(n, 15); i++) {
      const f = i / 15;
      bank[i] *= f;
      bank[n - 1 - i] *= f;
    }
  }
  return bank;
}

// Height of the road surface relative to its centre-line profile at lateral offset lat.
// A parabolic crown on straights fades out as the one-sided superelevation grows;
// crownScale (0..1) removes it where a road runs into another one.
export function crossOffset(kind, hw, bank, lat, crownScale = 1) {
  const P = ROAD_CROSS[kind] || ROAD_CROSS.road;
  const l = lat < -hw ? -hw : lat > hw ? hw : lat;
  const crownK = (P.emax > 0 ? Math.max(0, 1 - Math.abs(bank) / P.emax) : 1) * crownScale;
  return -(P.crown / (2 * hw)) * l * l * crownK + bank * l;
}

// Road ribbons are drawn this far above the smooth ground the wheels roll on; enough to
// clear the terrain's 4 m triangles (which bulge above the smooth surface on crests).
export const RIBBON_LIFT = 0.03;
