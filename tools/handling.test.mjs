import test from 'node:test';
import assert from 'node:assert/strict';
import { VehiclePhysics, ASSISTS_OFF } from '../src/vehicle/vehiclephysics.js';
import { CARS, CAR_BY_ID } from '../src/vehicle/carspecs.js';
import { SURF } from '../src/world/worldgen.js';

const DT = 1 / 120;
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function car(spec, surface = SURF.ROAD, kmh = 80, heading = 0, assists = {}) {
  const world = { height: () => 10, sample(x, z, n) { Object.assign(n, { x: 0, y: 1, z: 0 }); return 10; },
    surfaceAt: typeof surface === 'function' ? surface : () => surface };
  const p = new VehiclePhysics(spec, world);
  p.setAssists({ steering: 'normal', ...assists });
  p.reset(0, 0, heading);
  for (let i = 0; i < 240; i++) p.step(DT);
  const v = kmh / 3.6;
  p.vel.set(Math.sin(heading) * v, 0, Math.cos(heading) * v);
  for (const w of p.wheels) w.omega = v / w.r;
  p.gear = v < 0 ? -1 : 3;
  p.autoGear = v >= 0;
  return p;
}

for (const spec of CARS) {
  test(`${spec.id}: sustained steering bends the actual trajectory on every driving surface`, (t) => {
    let worst = 0;
    for (const surface of [SURF.ROAD, SURF.SAND, SURF.GRASS, SURF.FOREST, SURF.FIELD, SURF.DIRTROAD, SURF.SNOW, SURF.MUD]) {
      for (const kmh of [60, 120, 200]) for (const direction of [-1, 1]) {
        const startHeading = 0.7;
        const p = car(spec, surface, kmh, startHeading);
        let maxSlip = 0, courseTurn = 0;
        let prevCourse = startHeading;
        for (let i = 0; i < 480; i++) {
          p.input.steer = direction * Math.min(i / 36, 1);
          p.input.throttle = 1;
          p.step(DT);
          const course = Math.atan2(p.vel.x, p.vel.z);
          courseTurn += angle(course - prevCourse);
          prevCourse = course;
          maxSlip = Math.max(maxSlip, Math.abs(angle(course - p.heading)));
          assert.ok([...p.pos.toArray(), ...p.vel.toArray(), ...p.quat.toArray()].every(Number.isFinite));
        }
        const context = `${spec.id}, surface ${surface}, ${kmh} km/h, steer ${direction}`;
        assert.ok(courseTurn * direction < -0.1, `${context}: velocity did not turn`);
        const displacement = p.pos.x * Math.cos(startHeading) - p.pos.z * Math.sin(startHeading);
        assert.ok(displacement * direction < -3, `${context}: trajectory stayed straight`);
        assert.ok(maxSlip < 0.18, `${context}: body slid ${maxSlip * 180 / Math.PI} degrees from its path`);
        assert.ok(p.grounded >= 3, `${context}: lost ground contact`);
        worst = Math.max(worst, maxSlip);
      }
    }
    t.diagnostic(`Worst heading/course separation: ${(worst * 180 / Math.PI).toFixed(1)} degrees`);
  });
}

test('left and right turns are symmetric, and countersteering changes the course', () => {
  const left = car(CAR_BY_ID.gt), right = car(CAR_BY_ID.gt);
  for (let i = 0; i < 360; i++) {
    for (const [p, sign] of [[left, -1], [right, 1]]) {
      p.input.steer = sign * 0.65; p.input.throttle = 0.35; p.step(DT);
    }
  }
  assert.ok(Math.abs(left.pos.x + right.pos.x) < 0.5);
  assert.ok(Math.abs(left.pos.z - right.pos.z) < 0.5);
  const course = Math.atan2(right.vel.x, right.vel.z);
  for (let i = 0; i < 360; i++) { right.input.steer = -0.65; right.step(DT); }
  assert.ok(angle(Math.atan2(right.vel.x, right.vel.z) - course) > 0.2);
});

test('parking steering cannot rotate the chassis; reverse steering curves the path', () => {
  const parked = car(CAR_BY_ID.gt, SURF.ROAD, 0);
  const reverse = car(CAR_BY_ID.gt, SURF.ROAD, -15);
  for (let i = 0; i < 180; i++) {
    parked.input.steer = 1; parked.input.brake = 1; parked.autoGear = false; parked.step(DT);
    reverse.input.steer = 0.5; reverse.input.throttle = 0.1; reverse.step(DT);
  }
  assert.ok(Math.abs(parked.heading) < 0.001);
  assert.ok(Math.hypot(parked.pos.x, parked.pos.z) < 0.01);
  assert.ok(reverse.pos.z < -2 && reverse.pos.x < -0.2 && reverse.heading > 0.1);
});

test('handbrake still produces a deliberate slide and raw steering keeps mechanical lock', () => {
  const normal = car(CAR_BY_ID.gt, SURF.ROAD, 80);
  const drift = car(CAR_BY_ID.gt, SURF.ROAD, 80);
  const raw = car(CAR_BY_ID.gt, SURF.ROAD, 120, 0, ASSISTS_OFF);
  let maxNormal = 0, maxDrift = 0;
  for (let i = 0; i < 120; i++) {
    for (const p of [normal, drift, raw]) {
      p.input.steer = 0.7; p.input.throttle = 0.3;
      p.input.handbrake = p === drift ? 1 : 0;
      p.step(DT);
    }
    maxNormal = Math.max(maxNormal, Math.abs(normal.slipAngleBody));
    maxDrift = Math.max(maxDrift, Math.abs(drift.slipAngleBody));
  }
  assert.ok(maxDrift > maxNormal * 2 && maxDrift > 0.15);
  assert.ok(raw.steerAngle > normal.steerAngle * 1.3);
});

test('airborne steering cannot pivot the chassis and an unloaded contact stays finite', () => {
  const p = car(CAR_BY_ID.gt);
  p.pos.y = 100; p.angVel.set(0, 0, 0);
  for (let i = 0; i < 60; i++) { p.input.steer = 1; p.step(DT); }
  assert.equal(p.grounded, 0);
  assert.ok(Math.abs(p.heading) < 0.01);
  const q = car(CAR_BY_ID.gt);
  // Rebound can momentarily leave a ray in contact with zero suspension load.
  for (const w of q.wheels) w.compression = 1;
  q.input.throttle = 1;
  q.step(DT);
  assert.ok(q.wheels.some(w => w.contact && w.Fz === 0));
  assert.ok(q.force.z <= 0, 'unloaded tyres accelerated the car without traction');
  assert.ok([...q.pos.toArray(), ...q.vel.toArray(), ...q.quat.toArray()].every(Number.isFinite));
});
