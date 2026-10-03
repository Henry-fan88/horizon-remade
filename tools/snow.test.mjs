import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VehiclePhysics, ASSISTS_OFF } from '../src/vehicle/vehiclephysics.js';
import { CAR_BY_ID, CARS } from '../src/vehicle/carspecs.js';
import { SURF } from '../src/world/worldgen.js';
import { SURFACE_INFO, tireSurfaceGrip } from '../src/world/surfaces.js';
import { SnowEffects } from '../src/vehicle/snow-effects.js';
import { buildSnowPine } from '../src/world/snow-pine.js';
import { snowSpeedProfile } from '../src/game/ai.js';
import { RIBBON_LIFT } from '../src/world/roadprofile.js';

const DT = 1 / 120;
function flat(surface) {
  return { height: () => 10, sample(x, z, n) { Object.assign(n, { x: 0, y: 1, z: 0 }); return 10; },
    surfaceAt: typeof surface === 'function' ? surface : () => surface };
}
function car(surface, id = 'gt', assists) {
  const p = new VehiclePhysics(CAR_BY_ID[id], flat(surface));
  p.autoGear = false; p.reset(0, 0, 0);
  for (let i = 0; i < 180; i++) { p.input.brake = 1; p.step(DT); }
  p.gear = 3; p.autoGear = true; p.input.brake = 0;
  if (assists) p.setAssists(assists);
  return p;
}
function rolling(p, speed = 80 / 3.6) {
  p.vel.z = speed;
  for (const wheel of p.wheels) wheel.omega = speed / wheel.r;
  return p;
}
function braking(surface, abs = true, speed) {
  const p = rolling(car(surface, 'gt', { abs }), speed);
  let steps = 0;
  while (p.vel.length() > 0.5 && steps < 1800) { p.input.brake = 1; p.step(DT); steps++; }
  return { distance: p.pos.z, seconds: steps * DT, p };
}

test('packed snow needs substantially longer braking, and ABS improves locked-wheel stopping', t => {
  const dry = braking(SURF.ROAD), snow = braking(SURF.SNOW), locked = braking(SURF.SNOW, false);
  assert.ok(snow.distance > dry.distance * 2.5);
  assert.ok(snow.seconds > dry.seconds * 2.5 && snow.seconds < 12);
  assert.ok(locked.distance > snow.distance * 1.15);
  assert.ok(snow.p.grounded === 4 && locked.p.grounded === 4);
  assert.ok(snow.p.vel.length() < 0.5);
  t.diagnostic(`80 km/h stopping: asphalt ${dry.distance.toFixed(1)} m, snow with ABS ${snow.distance.toFixed(1)} m, snow locked ${locked.distance.toFixed(1)} m`);
});

test('snow keeps a wider turning trajectory while assisted steering controls body slip', () => {
  const dry = rolling(car(SURF.ROAD)), snow = rolling(car(SURF.SNOW));
  let drySlip = 0, snowSlip = 0;
  for (let i = 0; i < 240; i++) {
    for (const p of [dry, snow]) { p.input.steer = 0.65; p.step(DT); }
    drySlip = Math.max(drySlip, Math.abs(dry.slipAngleBody));
    snowSlip = Math.max(snowSlip, Math.abs(snow.slipAngleBody));
  }
  assert.ok(snowSlip < 0.18 && drySlip < 0.15, 'assisted cornering should not force the body into a slide');
  assert.ok(Math.abs(snow.pos.x) < Math.abs(dry.pos.x) * 0.7, 'snow turned as tightly as asphalt');
  assert.ok(snow.pos.z > dry.pos.z);
  assert.ok(snow.snowGrip < 0.4);
});

test('snow limits launches and permits wheelspin; off-road tuning cannot restore asphalt grip', () => {
  const dry = car(SURF.ROAD), snow = car(SURF.SNOW), spinning = car(SURF.SNOW, 'gt', ASSISTS_OFF);
  for (const p of [dry, snow, spinning]) p.gear = 1;
  let spin = 0;
  for (let i = 0; i < 480; i++) {
    for (const p of [dry, snow, spinning]) { p.input.throttle = 1; p.step(DT); }
    spin = Math.max(spin, ...spinning.wheels.map(w => w.spinning));
  }
  assert.ok(snow.forwardSpeed < dry.forwardSpeed * 0.65);
  assert.ok(spin > 0.5);
  assert.ok(tireSurfaceGrip(SURFACE_INFO[SURF.SNOW], { offroad: 1 }) < 0.4);
  assert.ok(tireSurfaceGrip(SURFACE_INFO[SURF.SAND], { offroad: 1 }) > 0.9);
});

test('all cars remain finite on split snow/asphalt and regain dry grip after leaving snow', () => {
  for (const spec of CARS) {
    const p = rolling(car((x, z) => z < 26 && x > -0.1 ? SURF.SNOW : SURF.ROAD, spec.id), 12);
    let mixed = false;
    for (let i = 0; i < 720; i++) {
      p.input.throttle = 0.35; p.input.steer = i < 120 ? 0.15 : 0; p.step(DT);
      mixed ||= p.wheels.some(w => w.surface === SURF.SNOW) && p.wheels.some(w => w.surface === SURF.ROAD);
      assert.ok([...p.pos.toArray(), ...p.vel.toArray(), ...p.quat.toArray()].every(Number.isFinite), spec.id);
      assert.ok(p.pos.y > 9.8 && p.pos.y < 12, spec.id);
    }
    assert.ok(mixed, `${spec.id}: missed mixed contacts`);
    assert.equal(p.snowGrip, 1, `${spec.id}: retained snow grip on dry ground`);
  }
});

test('respawning from snow queries the destination surface at the first tyre contact', () => {
  let surface = SURF.SNOW;
  const p = car(() => surface);
  assert.ok(p.wheels.every(w => w.surface === SURF.SNOW));
  surface = SURF.ROAD; p.reset(0, 100, 0); p.autoGear = false;
  for (let i = 0; i < 60; i++) {
    p.step(DT);
    if (p.wheels.some(w => w.contact)) {
      assert.ok(p.wheels.filter(w => w.contact).every(w => w.surface === SURF.ROAD));
      return;
    }
  }
  assert.fail('respawn never reached the ground');
});

test('asphalt braking and acceleration retain the pre-snow handling baseline', () => {
  const stop = braking(SURF.ROAD, true, 20);
  assert.ok(Math.abs(stop.distance - 15.236273163629471) < 1e-8);
  const p = car(SURF.ROAD);
  for (let i = 0; i < 1200; i++) { p.input.throttle = 0.7; p.step(DT); }
  assert.ok(Math.abs(p.pos.z - 276.3829482976165) < 1e-8);
  assert.equal(p.snowGrip, 1);
});

test('AI slows before snow and respects snowy turns without changing a dry route profile', () => {
  const profile = new Float32Array([35, 35, 35, 35, 14, 14]);
  const route = { n: 6, closed: false, x: new Float32Array(6), z: new Float32Array([0, 10, 20, 30, 40, 50]),
    idx: i => Math.min(5, i), segLen: () => 10, world: flat(SURF.ROAD) };
  assert.strictEqual(snowSpeedProfile(profile, route, CAR_BY_ID.gt), profile);
  route.world = flat((x, z) => z >= 30 ? SURF.SNOW : SURF.ROAD);
  const snow = snowSpeedProfile(profile, route, CAR_BY_ID.gt);
  assert.ok(snow[2] < profile[2], 'AI waited until entering snow to brake');
  assert.ok(snow[3] <= 20 && snow[4] < profile[4] * 0.6);
  assert.equal(profile[2], 35);
});

function effectsFixture(reverse = false) {
  const world = { hf: { height: (x, z) => x * 0.05 + z * 0.025 }, data: {} }, clouds = [];
  const effects = new SnowEffects(world, { spawn: (...args) => clouds.push(args) });
  const v = { root: { id: 7 }, spec: { style: { wheelW: 0.25, wheelWr: 0.3 } },
    physics: { vel: new THREE.Vector3(0, 0, reverse ? -12 : 12), quat: new THREE.Quaternion(), forwardSpeed: reverse ? -12 : 12 } };
  const wheel = { contact: true, surface: SURF.SNOW, point: new THREE.Vector3(0, 0, 0),
    x: 0.8, steer: 0, spinning: 0, slip: 0, slipAngle: 0, omega: reverse ? -40 : 40 };
  return { effects, v, wheel, world, clouds };
}

test('snow chunks follow forward/reverse tyre travel, with no powder on dry or airborne tyres', () => {
  for (const reverse of [false, true]) {
    const { effects, v, wheel, clouds } = effectsFixture(reverse);
    for (let i = 0; i < 30; i++) effects.wheel(v, wheel, 0, 1 / 60, 1);
    assert.ok(effects.chunks.emitted > 30 && clouds.length > 0);
    assert.ok(effects.chunks.particles.filter(p => p.alive).every(p => reverse ? p.vz > 0 : p.vz < 0));
    const before = effects.chunks.emitted;
    wheel.surface = SURF.ROAD; effects.wheel(v, wheel, 0, 1, 1);
    wheel.surface = SURF.SNOW; wheel.contact = false; effects.wheel(v, wheel, 0, 1, 1);
    wheel.contact = true; v.physics.vel.set(0, 0, 0); effects.wheel(v, wheel, 0, 1, 1);
    assert.equal(effects.chunks.emitted, before);
    wheel.spinning = 0.9; effects.wheel(v, wheel, 0, 1 / 60, 1);
    assert.ok(effects.chunks.emitted > before);
  }
});

test('powder settles on the snow and expires; tread follows slopes and breaks at gaps', () => {
  const { effects, v, wheel, world } = effectsFixture();
  effects.wheel(v, wheel, 0, 1 / 60, 1); wheel.point.z = 2;
  effects.wheel(v, wheel, 0, 1 / 60, 1);
  const count = effects.tracks.count;
  assert.ok(count > 0);
  for (let i = 0; i < count * 12; i++) {
    const a = effects.tracks.position;
    assert.ok(a.getY(i) >= world.hf.height(a.getX(i), a.getZ(i)));
  }
  wheel.contact = false; effects.wheel(v, wheel, 0, 1 / 60, 1);
  wheel.contact = true; wheel.point.z = 3; effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.equal(effects.tracks.count, count);
  wheel.point.z = 1000; effects.wheel(v, wheel, 0, 1 / 60, 1);
  assert.equal(effects.tracks.count, count);
  for (let i = 0; i < 180; i++) {
    effects.update(DT, 1);
    for (const p of effects.chunks.particles) if (p.alive) assert.ok(p.y >= world.hf.height(p.x, p.z));
  }
  assert.equal(effects.chunks.count, 0);
});

test('snow effects have bounded pools, including a long frame and continuous driving', () => {
  const { effects, v, wheel } = effectsFixture(); wheel.spinning = 1; wheel.slip = 1;
  effects.wheel(v, wheel, 0, 10, 1);
  assert.ok(effects.chunks.emitted < 50);
  for (let i = 0; i < 1800; i++) { wheel.point.z += 1; effects.wheel(v, wheel, 0, 1 / 60, 1); }
  effects.update(DT, 1);
  assert.ok(effects.chunks.count <= 2400);
  assert.equal(effects.tracks.count, 3600);
  assert.ok(Math.max(...effects.tracks.mesh.geometry.index.array) < effects.tracks.position.count);
});

test('snow treads stay above a mountain road ribbon and its smooth collision surface', () => {
  const { effects, v, wheel, world } = effectsFixture();
  world.height = (x, z) => world.hf.height(x, z) + 0.09;
  world.network = { nearest: () => ({ dist: 0, road: { width: 9 } }) };
  effects.wheel(v, wheel, 0, 1 / 60, 1); wheel.point.z = 1.5;
  effects.wheel(v, wheel, 0, 1 / 60, 1);
  const a = effects.tracks.position;
  for (let i = 0; i < effects.tracks.count * 12; i++) assert.ok(a.getY(i) > world.height(a.getX(i), a.getZ(i)) + RIBBON_LIFT);
});

test('snow pine LODs keep their seeded crowns and separate bark, needles and physical snow caps', () => {
  for (const seed of [1104, 1181, 1258]) {
    const near = buildSnowPine(seed, 0), far = buildSnowPine(seed, 1);
    for (const g of [near, far]) {
      assert.equal(g.groups.length, 3);
      for (const a of Object.values(g.attributes)) assert.ok(a.array.every(Number.isFinite));
      assert.ok(g.boundingBox.max.y > 12 && g.boundingBox.max.x - g.boundingBox.min.x > 7);
      assert.ok(g.groups[2].count > g.groups[1].count, 'snow was only a recolored needle texture');
    }
    assert.ok(near.index.count / 3 < 11000 && far.index.count / 3 < 2200);
    assert.ok(Math.abs(near.boundingBox.max.y - far.boundingBox.max.y) < 0.05);
    assert.ok(near.boundingBox.min.distanceTo(far.boundingBox.min) < 0.3);
    assert.ok(near.boundingBox.max.distanceTo(far.boundingBox.max) < 0.3);
    near.dispose(); far.dispose();
  }
});
