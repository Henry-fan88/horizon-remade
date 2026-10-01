// Vehicle physics bench (Node, no browser). Usage:
//   node tools/physbench.mjs roads [--legacy] [--car gt] [--road "Costa Ring"] [--kmh 220]
//        drives every road lane with an autopilot and reports ride quality
//   node tools/physbench.mjs perf     acceleration / braking / top speed on flat ground
//   node tools/physbench.mjs pulse    steering pulse at speed for each assist level
// --legacy reads the ground through the old 4 m triangle sampler.
import { generateWorld } from '../src/world/worldgen.js';
import { HeightField } from '../src/world/heightfield.js';
import { RoadNetwork } from '../src/world/roadnet.js';
import { SURF } from '../src/world/worldgen.js';
import { VehiclePhysics } from '../src/vehicle/vehiclephysics.js';
import { CARS, CAR_BY_ID } from '../src/vehicle/carspecs.js';
import { WORLD } from '../src/config.js';
import { roadSurfaceAt, isSnowRoad } from '../src/world/snow-surface.js';

const args = process.argv.slice(2);
const mode = args[0] || 'roads';
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const legacy = args.includes('--legacy');
const DT = 1 / 120;
const G = 9.81;

// ------------------------------------------------------------------ worlds
export function flatWorld() {
  return {
    height: () => 0,
    sample: (x, z, n) => {
      n.x = 0;
      n.y = 1;
      n.z = 0;
      return 0;
    },
    surfaceAt: () => SURF.ROAD,
  };
}

async function islandWorld() {
  const gen = opt('worldgen', null) ? (await import(opt('worldgen'))).generateWorld : generateWorld;
  const data = gen({}, () => {});
  if (!data.roads[0].bank) for (const r of data.roads) r.bank = new Float32Array(r.pts.length / 3);
  const hf = new HeightField(data.heights, WORLD.res, WORLD.size);
  const network = new RoadNetwork(data.roads);
  const near = {};
  const w = {
    data,
    hf,
    network,
    height: legacy ? (x, z) => hf.height(x, z) : (x, z) => hf.sampleSmooth(x, z, null),
    sample: legacy
      ? (x, z, n) => hf.sample(x, z, n)
      : (x, z, n) => {
          const g = n;
          const h = hf.sampleSmooth(x, z, g);
          const l = 1 / Math.sqrt(g.gx * g.gx + 1 + g.gz * g.gz);
          n.x = -g.gx * l;
          n.y = l;
          n.z = -g.gz * l;
          return h;
        },
    surfaceAt(x, z) {
      const r = network.nearest(x, z, 24, null, near);
      if (r && r.dist < r.road.width / 2 + 0.25) return roadSurfaceAt(r.road, isSnowRoad(r.road) ? hf.sampleSmooth(x, z, null) : 0);
      const S = WORLD.res + 1;
      const ix = Math.max(0, Math.min(WORLD.res, Math.round((x + hf.half) / hf.cell)));
      const iz = Math.max(0, Math.min(WORLD.res, Math.round((z + hf.half) / hf.cell)));
      const s = data.surface[iz * S + ix];
      return s === SURF.ROAD ? SURF.PAVE : s;
    },
  };
  return w;
}

// ------------------------------------------------------------------ helpers
function makeCar(id, world, setup = {}) {
  const spec = CAR_BY_ID[id];
  const p = new VehiclePhysics(spec, world);
  Object.assign(p, setup);
  return p;
}

// lane-following autopilot with a curvature speed profile
function speedProfile(road, lane, vCap, mu) {
  const ds = 2;
  const n = Math.ceil(road.length / ds);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(road.curvatureAt(i * ds, 10));
    v[i] = Math.min(vCap, k > 1e-5 ? Math.sqrt((0.8 * mu * G) / k) : vCap);
  }
  const brake = 6;
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 2; i >= -(road.closed ? n : 0); i--) {
      const a = ((i % n) + n) % n,
        b = (a + 1) % n;
      if (!road.closed && a === n - 1) continue;
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * brake * ds));
    }
  return { v, ds, n };
}

function drive(p, road, lane, prof, dist, onStep) {
  const pt = {};
  // start on the lane, rolling at the profile speed
  const s0 = 30;
  road.pointAt(s0, pt);
  const rx = -pt.tz,
    rz = pt.tx;
  p.reset(pt.x + rx * lane, pt.z + rz * lane, Math.atan2(pt.tx, pt.tz));
  const f = { x: pt.tx, z: pt.tz };
  p.pos.y = p.world.height(p.pos.x, p.pos.z) + p.cgH + 0.02;
  const v0 = prof.v[Math.floor(s0 / prof.ds) % prof.n] * 0.5;
  p.vel.set(f.x * v0, 0, f.z * v0);
  for (const w of p.wheels) w.omega = v0 / w.r;
  p.gear = 1;
  let s = s0;
  let t = 0;
  const maxT = dist / 15 + 30;
  let lastS = s;
  let latErrMax = 0;
  while (s - s0 < dist && t < maxT) {
    const near = road.pointAt(s, pt);
    // progress: project onto the road locally
    for (let k = 0; k < 3; k++) {
      road.pointAt(s, pt);
      const dx = p.pos.x - pt.x,
        dz = p.pos.z - pt.z;
      s += dx * pt.tx + dz * pt.tz;
    }
    road.pointAt(s, pt);
    const latErr = (p.pos.x - pt.x) * -pt.tz + (p.pos.z - pt.z) * pt.tx - lane;
    latErrMax = Math.max(latErrMax, Math.abs(latErr));
    if (Math.abs(latErr) > 12) return { failed: true, s: s - s0, t, latErrMax };
    const speed = Math.max(0, p.forwardSpeed);
    const look = 6 + speed * 0.45;
    road.pointAt(s + look, pt);
    const tx = pt.x + -pt.tz * lane,
      tz = pt.z + pt.tx * lane;
    const hd = p.heading;
    const ang = Math.atan2(tx - p.pos.x, tz - p.pos.z) - hd;
    const a = Math.atan2(Math.sin(ang), Math.cos(ang));
    const wb = p.spec.style.WB;
    // pure pursuit, scaled up for tyre slip at speed, plus lateral-error feedback
    const delta = Math.atan2(2 * wb * Math.sin(a), look) * (1 + (speed * speed) / 1100) - Math.atan2(latErr * 0.35, speed + 5);
    const maxSteer = 0.6 / Math.pow(1 + Math.max(0, speed - 3) / 11, 0.72);
    p.input.steer = Math.max(-1, Math.min(1, -delta / maxSteer));
    const vT = prof.v[Math.floor((((s + speed * 0.6) % road.length) + road.length) % road.length / prof.ds) % prof.n];
    const err = vT - speed;
    // a tidy driver: less throttle while turning or sliding
    p.input.throttle = err > 0 ? Math.min(1, err * 0.3 + 0.15) * Math.max(0, 1 - 0.6 * Math.abs(p.input.steer)) * Math.max(0, 1 - Math.abs(p.slipAngleBody) * 10) : 0;
    p.input.brake = err < -1.5 ? Math.min(1, -err * 0.15) : 0;
    p.step(DT);
    t += DT;
    if (process.env.TRACE && Math.round(t * 120) % 15 === 0) console.log(`t=${t.toFixed(2)} s=${s.toFixed(0)} lat=${latErr.toFixed(2)} v=${(speed * 3.6).toFixed(0)} vT=${(vT * 3.6).toFixed(0)} steer=${p.input.steer.toFixed(2)} yawRate=${p.angVel.y.toFixed(2)} slip=${p.slipAngleBody.toFixed(3)} gear=${p.gear} grounded=${p.grounded}`);
    onStep?.(p, t, s);
    if (road.closed) {
      /* distance keeps accumulating along s */
    } else if (s > road.length - 40) break;
    lastS = s;
  }
  return { failed: false, s: s - s0, t, latErrMax };
}

function rideStats(car, road, lane, kmh, mu) {
  const world = road._world;
  const p = makeCar(car, world);
  const prof = speedProfile(road, lane, kmh / 3.6, mu);
  let n = 0,
    az2 = 0,
    prevVy = null,
    fzVar = 0,
    air = 0,
    liftoffs = 0,
    inAir = 0,
    maxRoll = 0,
    vsum = 0,
    buzz = 0;
  const hist = [];
  const res = drive(p, road, lane, prof, road.closed ? road.length : road.length - 80, (q, t) => {
    const vy = q.vel.y;
    if (prevVy !== null) {
      const az = (vy - prevVy) / DT;
      az2 += az * az;
      hist.push(az);
    }
    prevVy = vy;
    let grounded = 0;
    for (const w of q.wheels) {
      if (w.contact) {
        grounded++;
        const stat = (q.mass * G) / 4;
        fzVar += ((w.Fz - stat) / stat) ** 2;
      }
    }
    if (grounded === 0) {
      air += DT;
      inAir += DT;
    } else {
      if (inAir > 0.08) liftoffs++;
      inAir = 0;
    }
    const upx = 2 * (q.quat.x * q.quat.y - q.quat.w * q.quat.z);
    maxRoll = Math.max(maxRoll, Math.abs(Math.asin(Math.max(-1, Math.min(1, upx)))));
    vsum += q.speed;
    n++;
  });
  // "buzz": high-frequency vertical acceleration (above ~8 Hz) — differences of successive az
  let hf2 = 0;
  for (let i = 2; i < hist.length; i++) {
    const d = hist[i] - 2 * hist[i - 1] + hist[i - 2];
    hf2 += d * d;
  }
  return {
    failed: res.failed,
    km: res.s / 1000,
    avgKmh: (vsum / Math.max(1, n)) * 3.6,
    azRms: Math.sqrt(az2 / Math.max(1, n)),
    buzz: Math.sqrt(hf2 / Math.max(1, hist.length)) / 4,
    loadRms: Math.sqrt(fzVar / Math.max(1, n * 4)),
    airS: air,
    liftoffs,
    maxRollDeg: (maxRoll * 180) / Math.PI,
    latErrMax: res.latErrMax,
  };
}

// ------------------------------------------------------------------ modes
if (mode === 'roads') {
  const world = await islandWorld();
  const car = opt('car', 'gt');
  const only = opt('road', null);
  const kmh = Number(opt('kmh', 0));
  console.log(`sampler: ${legacy ? 'legacy 4 m triangles' : 'smooth B-spline'} · car: ${car}`);
  console.log('road              lane   target  avg km/h   az rms   buzz   load rms   air(s)  lift-offs  max roll°  max lane err');
  for (const road of world.network.roads) {
    if (only && road.name !== only) continue;
    if (road.kind === 'runway' || road.length < 150) continue;
    road._world = world;
    const cap = kmh || (road.name === 'Costa Ring' ? 220 : road.kind === 'highway' ? 240 : road.kind === 'dirt' ? 110 : road.kind === 'street' ? 90 : 170);
    const mu = road.kind === 'dirt' ? 0.75 : 1.0;
    const lanes = road.kind === 'highway' ? [0.375 * road.width] : [0.25 * road.width];
    for (const lane of lanes) {
      const r = rideStats(car, road, lane, cap, mu);
      console.log(
        `${road.name.padEnd(17)} ${lane.toFixed(1).padStart(5)} ${String(cap).padStart(7)} ${r.avgKmh.toFixed(0).padStart(9)} ${r.azRms.toFixed(2).padStart(8)} ${r.buzz.toFixed(2).padStart(6)} ${r.loadRms.toFixed(3).padStart(10)} ${r.airS.toFixed(2).padStart(8)} ${String(r.liftoffs).padStart(10)} ${r.maxRollDeg.toFixed(1).padStart(10)} ${r.latErrMax.toFixed(1).padStart(13)}${r.failed ? `  LEFT THE ROAD after ${(r.km * 1000).toFixed(0)} m` : ''}`
      );
    }
  }
} else if (mode === 'perf') {
  const world = flatWorld();
  console.log('car          0-100   0-200   ¼ mile   top km/h (spec)   100-0 m');
  for (const spec of CARS) {
    const p = makeCar(spec.id, world);
    p.reset(0, 0, 0, 0);
    p.pos.y = spec.cgH + 0.02;
    let t = 0,
      t100 = null,
      t200 = null,
      tq = null,
      top = 0,
      topT = 0;
    p.input.throttle = 1;
    while (t < 90) {
      p.step(DT);
      t += DT;
      const kmh = p.forwardSpeed * 3.6;
      if (t100 === null && kmh >= 100) t100 = t;
      if (t200 === null && kmh >= 200) t200 = t;
      if (tq === null && p.pos.z >= 402.3) tq = t;
      if (kmh > top + 0.05) {
        top = kmh;
        topT = t;
      }
      if (t - topT > 6) break;
    }
    // braking 100-0
    const b = makeCar(spec.id, world);
    b.reset(0, 0, 0, 0);
    b.pos.y = spec.cgH + 0.02;
    b.vel.set(0, 0, 100 / 3.6);
    for (const w of b.wheels) w.omega = 100 / 3.6 / w.r;
    b.gear = Math.min(4, spec.gears);
    b.input.brake = 1;
    let bt = 0;
    const z0 = b.pos.z;
    while (b.vel.z > 0.3 && bt < 20) {
      b.step(DT);
      bt += DT;
    }
    console.log(
      `${spec.id.padEnd(10)} ${(t100 ?? NaN).toFixed(2).padStart(7)} ${(t200 ?? NaN).toFixed(2).padStart(7)} ${(tq ?? NaN).toFixed(2).padStart(8)} ${top.toFixed(0).padStart(9)} (${spec.topKmh})   ${(b.pos.z - z0).toFixed(1).padStart(8)}`
    );
  }
} else if (mode === 'pulse') {
  const world = flatWorld();
  const car = opt('car', 'gt');
  const levels = (opt('levels', 'off,normal,full') || '').split(',');
  console.log('car ' + car + ' — steering pulse (full lock for 0.35 s, then straight) on flat asphalt, throttle held');
  console.log('assist   km/h   peak slip°   peak yaw°/s   spun out   heading change°');
  for (const level of levels)
    for (const kmh of [100, 180, 250]) {
      const p = makeCar(car, world);
      if (p.setAssists) p.setAssists({ steering: level, stability: level !== 'off', abs: level !== 'off', tc: level !== 'off' });
      p.reset(0, 0, 0, 0);
      p.pos.y = p.cgH + 0.02;
      p.vel.set(0, 0, kmh / 3.6);
      for (const w of p.wheels) w.omega = kmh / 3.6 / w.r;
      p.gear = Math.min(p.spec.gears, 2 + Math.floor(kmh / 60));
      let t = 0,
        peakSlip = 0,
        peakYaw = 0;
      const h0 = p.heading;
      while (t < 4) {
        p.input.steer = t > 0.3 && t < 0.65 ? 1 : 0;
        p.input.throttle = 0.4;
        p.step(DT);
        t += DT;
        peakSlip = Math.max(peakSlip, Math.abs(p.slipAngleBody));
        peakYaw = Math.max(peakYaw, Math.abs(p.angVel.y));
      }
      const dh = Math.atan2(Math.sin(p.heading - h0), Math.cos(p.heading - h0));
      console.log(`${level.padEnd(7)} ${String(kmh).padStart(5)} ${((peakSlip * 180) / Math.PI).toFixed(1).padStart(12)} ${((peakYaw * 180) / Math.PI).toFixed(0).padStart(13)} ${String(peakSlip > 1.2).padStart(10)} ${((dh * 180) / Math.PI).toFixed(0).padStart(16)}`);
    }
}
else if (mode === 'water') {
  // a beach sloping into the sea at 6 %, deepening to 8 m, then flat
  const slope = 0.06;
  const hAt = (z) => Math.max(-8, -z * slope);
  const beach = {
    height: (x, z) => hAt(z),
    sample(x, z, n) {
      const dz = -z * slope > -8 ? -slope : 0;
      const l = 1 / Math.sqrt(1 + dz * dz);
      n.x = 0;
      n.y = l;
      n.z = -dz * l;
      return hAt(z);
    },
    surfaceAt: () => SURF.SAND,
  };
  console.log('car into the sea down a 6 % beach, throttle held (water line at z = 0)');
  console.log('start km/h   stops at z (depth m)   max body under   afloat after s   rescued after s   stalled');
  for (const kmh of [30, 60, 100, 160]) {
    const p = makeCar(opt('car', 'gt'), beach);
    p.reset(0, -40, 0, hAt(-40));
    p.pos.y = hAt(-40) + p.cgH + 0.05;
    p.vel.set(0, 0, kmh / 3.6);
    for (const w of p.wheels) w.omega = kmh / 3.6 / w.r;
    p.gear = 3;
    p.input.throttle = 1;
    let t = 0,
      maxSub = 0,
      afloat = null,
      rescued = null,
      stopZ = null;
    while (t < 20) {
      p.step(DT);
      t += DT;
      maxSub = Math.max(maxSub, p.water.submerged);
      if (afloat === null && p.water.floatTime > 0.2) afloat = t;
      if (rescued === null && (p.water.floatTime > 3.5 || p.water.depth > p.cgH + 1.4 || (p.water.stalled && p.speed < 2 && p.water.submerged > 0.3))) rescued = t;
      if (stopZ === null && p.speed < 0.5 && t > 1) stopZ = p.pos.z;
    }
    const z = stopZ ?? p.pos.z;
    console.log(`${String(kmh).padStart(9)} ${z.toFixed(1).padStart(15)} (${Math.max(0, -hAt(z)).toFixed(2)}) ${maxSub.toFixed(2).padStart(15)} ${(afloat ?? NaN).toFixed(1).padStart(15)} ${(rescued ?? NaN).toFixed(1).padStart(17)}   ${p.water.stalled}`);
  }
}

if (mode === 'crash') {
  const { CollisionWorld, resolveVehiclePair } = await import('../src/world/colliders.js');
  const world = flatWorld();
  const cases = [
    { name: 'wall head-on 50 km/h', kmh: 50, heading: 0, setup: (c) => c.addBox(0, 30, 10, 1, 0, -1, 4, 'building') },
    { name: 'wall 30° 90 km/h', kmh: 90, heading: 0.52, setup: (c) => c.addBox(0, 30, 30, 1, 0, -1, 4, 'building') },
    { name: 'tree offset 60 km/h', kmh: 60, heading: 0, setup: (c) => c.addCircle(0.7, 25, 0.4, -1, 12, 'tree') },
    { name: 'rail glancing 120 km/h', kmh: 120, heading: 0.12, setup: (c) => c.addSegment(3.5, -50, 3.5, 200, 0.25, -1, 1, 'rail') },
  ];
  console.log('case                      impact m/s   speed after   front  rear  left  right   max pitch°  max roll°  scrape m/s');
  for (const cs of cases) {
    const col = new CollisionWorld();
    cs.setup(col);
    const p = makeCar(opt('car', 'gt'), world);
    p.reset(0, 0, cs.heading, 0);
    p.pos.y = p.cgH + 0.02;
    p.vel.set(Math.sin(cs.heading) * cs.kmh / 3.6, 0, Math.cos(cs.heading) * cs.kmh / 3.6);
    for (const w of p.wheels) w.omega = cs.kmh / 3.6 / w.r;
    p.gear = 3;
    p.input.throttle = 0.3;
    let t = 0, imp = 0, pitch = 0, roll = 0, scrape = 0;
    while (t < 4) {
      p.step(DT);
      imp = Math.max(imp, col.resolveVehicle(p));
      scrape = Math.max(scrape, p.scrape);
      p.scrape = 0;
      const e = new (await import('three')).Euler().setFromQuaternion(p.quat, 'YXZ');
      pitch = Math.max(pitch, Math.abs(e.x));
      roll = Math.max(roll, Math.abs(e.z));
      t += DT;
    }
    const d = p.damage;
    console.log(`${cs.name.padEnd(25)} ${imp.toFixed(1).padStart(10)} ${(p.speed * 3.6).toFixed(0).padStart(11)}    ${d.front.toFixed(2)}  ${d.rear.toFixed(2)}  ${d.left.toFixed(2)}  ${d.right.toFixed(2)}   ${(pitch * 57.3).toFixed(1).padStart(10)} ${(roll * 57.3).toFixed(1).padStart(10)} ${scrape.toFixed(1).padStart(10)}`);
  }
  // two cars: T-bone
  const a = makeCar('gt', world),
    b = makeCar('shelby', world);
  a.reset(0, 0, 0, 0);
  a.pos.y = a.cgH + 0.02;
  a.vel.set(0, 0, 60 / 3.6);
  b.reset(0, 12, Math.PI / 2, 0);
  b.pos.y = b.cgH + 0.02;
  let t = 0,
    imp = 0;
  while (t < 3) {
    a.step(DT);
    b.step(DT);
    imp = Math.max(imp, resolveVehiclePair(a, b, false));
    t += DT;
  }
  console.log(`T-bone 60 km/h into a parked car: impact ${imp.toFixed(1)} m/s · hitter front ${a.damage.front.toFixed(2)} · parked car ${JSON.stringify(Object.fromEntries(Object.entries(b.damage).map(([k, v]) => [k, +v.toFixed(2)])))} · parked car pushed ${Math.hypot(b.pos.x, b.pos.z - 12).toFixed(1)} m`);
}
