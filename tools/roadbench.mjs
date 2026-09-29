// Road surface audit: node tools/roadbench.mjs [--json out.json]
// Walks every lane of every road on the generated island and reports, per road:
//   bumps  – metres of wheel track where the ground deviates > 5 cm from a 6 m-smoothed profile
//   tilt   – sideways slope between the two wheel tracks (max, and metres above 5 % / 8 %)
//   crests – distinct crests whose geometric lift-off speed (v = sqrt(g / curvature)) is below
//            100 / 150 / 200 / 250 km/h, plus the lowest lift-off speed found
//   poke   – how far the terrain triangles rise above the drawn road ribbon (cm)
// The ground is read through the same sampler the vehicle physics uses (world.sample).
import { generateWorld } from '../src/world/worldgen.js';
import { HeightField } from '../src/world/heightfield.js';
import { RoadNetwork } from '../src/world/roadnet.js';
import { WORLD } from '../src/config.js';
import { RIBBON_LIFT } from '../src/world/roadprofile.js';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const legacy = args.includes('--legacy');
const t0 = performance.now();
const data = generateWorld({}, () => {});
const genMs = performance.now() - t0;
const hf = new HeightField(data.heights, WORLD.res, WORLD.size);
const network = new RoadNetwork(data.roads);
const nrm = { x: 0, y: 1, z: 0 };
const ground = legacy ? (x, z) => hf.height(x, z) : (x, z) => hf.sampleSmooth(x, z, nrm);

const G = 9.81;
const DS = 0.5;
const TRACK = 0.8; // half the wheel track

function gauss(arr, sigmaSamples, closed) {
  const n = arr.length;
  const R = Math.ceil(sigmaSamples * 3);
  const w = [];
  for (let k = -R; k <= R; k++) w.push(Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples)));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0,
      ws = 0;
    for (let k = -R; k <= R; k++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      s += arr[j] * w[k + R];
      ws += w[k + R];
    }
    out[i] = s / ws;
  }
  return out;
}

function laneOffsets(road) {
  if (road.kind === 'highway') return [-0.375, -0.125, 0.125, 0.375].map((f) => f * road.width);
  if (road.kind === 'runway') return [0];
  return [-0.25, 0.25].map((f) => f * road.width);
}

const rows = [];
const p = {};
for (const road of network.roads) {
  const n = Math.floor(road.length / DS);
  const agg = { name: road.name, kind: road.kind, km: road.length / 1000, bumpM: 0, maxBump: 0, maxTilt: 0, tilt5M: 0, tilt8M: 0, crest100: 0, crest150: 0, crest200: 0, crest250: 0, minLift: Infinity, maxGrade: 0 };
  for (const off of laneOffsets(road)) {
    const hc = new Float64Array(n),
      tilt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      road.pointAt(i * DS, p);
      const rx = -p.tz,
        rz = p.tx;
      const cx = p.x + rx * off,
        cz = p.z + rz * off;
      const hl = ground(cx - rx * TRACK, cz - rz * TRACK);
      const hr = ground(cx + rx * TRACK, cz + rz * TRACK);
      hc[i] = (hl + hr) / 2;
      tilt[i] = (hr - hl) / (2 * TRACK);
    }
    const smooth6 = gauss(hc, 6 / DS, road.closed);
    const car = gauss(hc, 1.2 / DS, road.closed);
    let crestRun = null;
    const closeCrest = () => {
      if (!crestRun) return;
      const v = crestRun.minV * 3.6;
      if (v < 100) agg.crest100++;
      if (v < 150) agg.crest150++;
      if (v < 200) agg.crest200++;
      if (v < 250) agg.crest250++;
      agg.minLift = Math.min(agg.minLift, v);
      crestRun = null;
    };
    const k = Math.round(2 / DS);
    const lanes = laneOffsets(road).length;
    // designated Danger Sign kickers on this road are reported separately
    const jumpsHere = data.jumps.filter((j) => j.road === road.id);
    const inJump = (s) => jumpsHere.some((j) => s > j.s - 40 && s < j.s + 35);
    agg.jumps = jumpsHere.length;
    for (let i = 0; i < n; i++) {
      if (inJump(i * DS)) {
        closeCrest();
        continue;
      }
      const dev = Math.abs(hc[i] - smooth6[i]);
      if (dev > 0.05) agg.bumpM += DS / lanes;
      agg.maxBump = Math.max(agg.maxBump, dev);
      const t = Math.abs(tilt[i]);
      agg.maxTilt = Math.max(agg.maxTilt, t);
      if (t > 0.05) agg.tilt5M += DS / lanes;
      if (t > 0.08) agg.tilt8M += DS / lanes;
      if (i >= k && i < n - k) {
        const kap = (car[i - k] - 2 * car[i] + car[i + k]) / ((k * DS) ** 2);
        agg.maxGrade = Math.max(agg.maxGrade, Math.abs(car[i + k] - car[i - k]) / (2 * k * DS));
        if (kap < -1e-4) {
          const v = Math.sqrt(G / -kap);
          if (v < 250 / 3.6) {
            if (!crestRun) crestRun = { minV: v };
            else crestRun.minV = Math.min(crestRun.minV, v);
          } else closeCrest();
        } else closeCrest();
      }
    }
    closeCrest();
  }
  // ribbon poke-through: terrain triangles above the drawn road ribbon
  agg.pokeCm = ribbonPoke(road) * 100;
  rows.push(agg);
}

function ribbonPoke(road) {
  const cols = road.kind === 'highway' || road.kind === 'runway' ? 7 : 5;
  const yo = legacy ? { highway: 0.07, road: 0.055, runway: 0.05, street: 0.045, dirt: 0.04 }[road.kind] ?? 0.05 : RIBBON_LIFT;
  const hw = road.width / 2;
  const rowsN = road.closed ? road.n + 1 : road.n;
  const vtx = (row, c) => {
    const i = row % road.n;
    const off = -hw + (c / (cols - 1)) * road.width;
    const x = road.pts[i * 3] - road.tan[i * 2 + 1] * off;
    const z = road.pts[i * 3 + 2] + road.tan[i * 2] * off;
    return [x, (legacy ? hf.height(x, z) : Math.max(hf.height(x, z), hf.sampleSmooth(x, z, null))) + yo, z];
  };
  let worst = 0;
  for (let row = 0; row < rowsN - 1; row++)
    for (let c = 0; c < cols - 1; c++) {
      const a = vtx(row, c),
        b = vtx(row, c + 1),
        c2 = vtx(row + 1, c),
        d = vtx(row + 1, c + 1);
      for (const [A, B, C] of [
        [a, b, c2],
        [b, d, c2],
      ])
        for (let u = 0; u <= 4; u++)
          for (let v = 0; v <= 4 - u; v++) {
            const w0 = u / 4,
              w1 = v / 4,
              w2 = 1 - w0 - w1;
            const x = A[0] * w0 + B[0] * w1 + C[0] * w2;
            const y = A[1] * w0 + B[1] * w1 + C[1] * w2;
            const z = A[2] * w0 + B[2] * w1 + C[2] * w2;
            worst = Math.max(worst, hf.height(x, z) - y);
          }
    }
  return worst;
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '-');
console.log(`world generated in ${genMs.toFixed(0)} ms · sampler: ${legacy ? 'legacy 4 m triangles' : 'smooth B-spline'}`);
console.log('(Danger Sign kickers on a road are excluded from bumps/crests; see the jumps column)');
console.log('road              kind      km   bump>5cm(m) maxBump(cm)  maxTilt%  tilt>5%(m) tilt>8%(m)  crests<100/150/200/250  minLift(km/h)  maxGrade%  poke(cm)  jumps');
for (const r of rows)
  console.log(
    `${r.name.padEnd(17)} ${r.kind.padEnd(8)} ${fmt(r.km, 2).padStart(5)} ${fmt(r.bumpM, 0).padStart(11)} ${fmt(r.maxBump * 100).padStart(11)} ${fmt(r.maxTilt * 100).padStart(9)} ${fmt(r.tilt5M, 0).padStart(11)} ${fmt(r.tilt8M, 0).padStart(10)}  ${[r.crest100, r.crest150, r.crest200, r.crest250].join('/').padStart(20)}  ${fmt(r.minLift, 0).padStart(13)} ${fmt(r.maxGrade * 100).padStart(10)} ${fmt(r.pokeCm).padStart(9)}  ${r.jumps || ''}`
  );
const ji = args.indexOf('--json');
if (ji >= 0) writeFileSync(args[ji + 1], JSON.stringify(rows, null, 1));
