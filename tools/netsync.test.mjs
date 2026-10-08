import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ServerClock, SendGate, RemoteMotion, predict, makeState, FULL_H } from '../src/net/sync.js';
import { CollisionWorld } from '../src/world/colliders.js';

// A car on a circle: speed v (m/s), yaw rate w (rad/s), starting at the origin heading +z.
function circle(v, w) {
  const r = v / w;
  return (t) => {
    const a = w * t;
    const s = makeState();
    s.pos.set(r * (1 - Math.cos(a)), 0.5, r * Math.sin(a));
    s.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    s.vel.set(v * Math.sin(a), 0, v * Math.cos(a));
    s.angVel.set(0, w, 0);
    s.acc.set(w * v * Math.cos(a), 0, -w * v * Math.sin(a)); // centripetal
    s.ts = t * 1000;
    return s;
  };
}

test('server clock: trusts the fastest round trips, ignores stalls and busy frames', () => {
  const trueOffset = 5000;
  const clock = new ServerClock();
  let local = 1000;
  const ping = (up, down, busy = 0) => {
    const sent = local;
    const server = sent + up + trueOffset;
    local = sent + up + down + busy;
    clock.sample(sent, server, local);
    local += 1000;
  };
  ping(80, 80, 900); // the welcome, handled late while the game loads
  assert.ok(Math.abs(clock.offset - trueOffset) > 400, 'a lone late sample is off');
  for (let i = 0; i < 5; i++) ping(78 + i, 82 - i);
  assert.ok(Math.abs(clock.offset - trueOffset) <= 3, `settles: ${clock.offset}`);
  assert.ok(clock.rtt >= 158 && clock.rtt <= 162);
  ping(80, 1500); // a stall on the way back
  ping(80, 80, 400); // a long frame before the answer was read
  assert.ok(Math.abs(clock.offset - trueOffset) <= 3, `unmoved by the stall: ${clock.offset}`);
  assert.equal(Math.round(clock.now(2000)), 2000 + Math.round(clock.offset));
});

test('prediction follows a turning car, and coasts to a stop on a stalled connection', () => {
  const car = circle(25, 0.5);
  const s = car(0);
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion();
  for (const h of [0.05, 0.15, 0.3]) {
    predict(s, h, p, q);
    const truth = car(h);
    const err = p.distanceTo(truth.pos);
    assert.ok(err < 0.05, `${h * 1000} ms ahead: ${err.toFixed(3)} m off`);
    assert.ok(q.angleTo(truth.quat) < 1e-6);
  }
  // a still car stays put; a long stall moves a car at most FULL_H + coast seconds of travel
  const still = makeState();
  predict(still, 3, p, q);
  assert.equal(p.length(), 0);
  const straight = makeState();
  straight.vel.set(0, 0, 30);
  predict(straight, 5, p, q);
  assert.ok(p.z > 30 * FULL_H && p.z < 30 * (FULL_H + 0.51), `coasted ${p.z.toFixed(1)} m`);
});

// Run a receiver against a car: states sent every `every` s, arriving `delay` ± `jitter` s
// later, drawn at 60 fps. Returns the drawn-vs-true error and the largest frame-to-frame jump.
function drive(car, { every = 0.05, delay = 0.15, jitter = 0.03, seconds = 6, seed = 1 } = {}) {
  let rnd = seed;
  const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const motion = new RemoteMotion();
  const inbox = [];
  for (let t = 0; t < seconds; t += every) inbox.push({ at: t + delay + (random() * 2 - 1) * jitter, s: car(t) });
  inbox.sort((a, b) => a.at - b.at);
  const errs = [];
  let maxJump = 0;
  let maxStep = 0;
  const prev = new THREE.Vector3();
  const dt = 1 / 60;
  for (let t = 0, i = 0; t < seconds; t += dt) {
    while (i < inbox.length && inbox[i].at <= t) motion.push(inbox[i++].s);
    if (!motion.update(t * 1000, dt)) continue;
    const truth = car(t);
    if (t > 1) {
      errs.push(motion.pos.distanceTo(truth.pos));
      const step = motion.pos.distanceTo(prev);
      const trueStep = truth.pos.distanceTo(car(t - dt).pos);
      maxJump = Math.max(maxJump, step - trueStep);
      maxStep = Math.max(maxStep, step);
    }
    prev.copy(motion.pos);
  }
  errs.sort((a, b) => a - b);
  return { p50: errs[errs.length >> 1], p90: errs[Math.floor(errs.length * 0.9)], max: errs[errs.length - 1], maxJump, maxStep };
}

test('other cars are drawn where they are now, not where they were', () => {
  // 90 km/h around a bend, states 150 ms late with jitter: the old interpolation drew the car
  // ~300 ms behind, 7.5 m back along the road
  const r = drive(circle(25, 0.5));
  assert.ok(r.p50 < 0.3 && r.max < 1, `error p50 ${r.p50.toFixed(2)} m, max ${r.max.toFixed(2)} m`);
  assert.ok(r.maxJump < 0.15, `no jumps: worst extra step ${r.maxJump.toFixed(3)} m`);
  // a slalom (turn rate flipping every 0.7 s) is harder: still a fraction of a car length
  const slalom = (t) => {
    // integrate heading numerically
    const s = makeState();
    const v = 25;
    let x = 0,
      z = 0,
      a = 0;
    const step = 0.002;
    for (let u = 0; u < t; u += step) {
      const w = Math.sin((u / 0.7) * Math.PI) > 0 ? 0.6 : -0.6;
      a += w * step;
      x += v * Math.sin(a) * step;
      z += v * Math.cos(a) * step;
    }
    const w = Math.sin((t / 0.7) * Math.PI) > 0 ? 0.6 : -0.6;
    s.pos.set(x, 0.5, z);
    s.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    s.vel.set(v * Math.sin(a), 0, v * Math.cos(a));
    s.angVel.set(0, w, 0);
    s.ts = t * 1000;
    return s;
  };
  const rs = drive(slalom, { seconds: 4 });
  assert.ok(rs.p50 < 0.8 && rs.max < 3, `slalom error p50 ${rs.p50.toFixed(2)} m, max ${rs.max.toFixed(2)} m`);
  assert.ok(rs.maxJump < 0.4, `slalom: worst extra step ${rs.maxJump.toFixed(3)} m`);
});

test('collision sweep: walls and trees ahead stop a path; a car scraping a wall keeps sliding', () => {
  const w = new CollisionWorld();
  w.addBox(0, 10, 5, 0.5, 0, 0, 4); // a wall across the path, z 9.5..10.5
  w.addCircle(20, 10, 0.5, 0, 8); // a tree
  const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
  close(w.sweep(0, 0, 0, 20, 1, 1), 8.5 / 20); // hits the wall's near face, grown by the car's radius
  close(w.sweep(20, 0, 20, 20, 1, 1), 8.5 / 20); // the tree: centre 10, radius 0.5 + 1
  assert.equal(w.sweep(10, 0, 10, 20, 1, 1), 1, 'clear beside the wall');
  assert.equal(w.sweep(0, 0, 0, 20, 1, 9), 1, 'well above the wall');
  assert.equal(w.sweep(0, 8.8, 4, 8.8, 1, 1), 1, 'already touching the wall: free to slide along it');
  // a remote car predicted into the wall is drawn stopped against it
  const m = new RemoteMotion();
  const s = makeState();
  s.ts = 0;
  s.vel.set(0, 0, 30);
  m.push(s);
  const limit = (from, to) => w.sweep(from.x, from.z, to.x, to.z, 1, from.y);
  m.update(0, 1 / 60, limit);
  m.update(500, 1 / 60, limit); // 0.5 s later: unchecked it would be 15 m on, through the wall
  close(m.pos.z, 8.5, 1e-3);
  assert.equal(m.vel.length(), 0);
});

test('a teleport snaps; late and repeated states are ignored', () => {
  const m = new RemoteMotion();
  const a = makeState();
  a.ts = 1000;
  m.push(a);
  m.update(1000, 1 / 60);
  const b = makeState();
  b.ts = 1100;
  b.pos.set(200, 0, 0); // respawned far away
  m.push(b);
  m.update(1100, 1 / 60);
  assert.ok(m.pos.distanceTo(b.pos) < 1e-9, 'jumped straight there');
  const old = makeState();
  old.ts = 1050;
  assert.equal(m.push(old), false);
  assert.equal(m.push(b), false);
});

test('the send gate: quiet when predictable, quick when the car changes, within the rate', () => {
  const run = (car, seconds, maxHz = 30, keyAt = () => '') => {
    const gate = new SendGate();
    const sends = [];
    for (let t = 0; t < seconds; t += 1 / 60) {
      const s = car(t);
      const st = { pos: s.pos, quat: s.quat, vel: s.vel, angVel: s.angVel, acc: s.acc, steer: 0, key: keyAt(t) };
      if (gate.due(t * 1000, st, maxHz)) {
        sends.push(t);
        gate.sent(t * 1000, st);
      }
    }
    return sends;
  };
  // parked: once a second
  const parked = run(() => makeState(), 5);
  assert.ok(parked.length >= 5 && parked.length <= 6, `parked: ${parked.length} sends in 5 s`);
  // cruising straight at 30 m/s is perfectly predictable: just the 5 Hz heartbeat
  const cruise = (t) => {
    const s = makeState();
    s.pos.set(0, 0.5, 30 * t);
    s.vel.set(0, 0, 30);
    return s;
  };
  const c = run(cruise, 5);
  assert.ok(c.length >= 24 && c.length <= 27, `cruise: ${c.length} sends in 5 s`);
  // a car that starts turning at 1 s is sent within a few frames of it
  const turnAt = (t) => {
    if (t < 1) return cruise(t);
    const s = circle(30, 0.8)(t - 1);
    s.pos.z += 30;
    return s;
  };
  const sends = run(turnAt, 2);
  const after = sends.find((t) => t >= 1);
  assert.ok(after - 1 < 0.07, `first send ${((after - 1) * 1000).toFixed(0)} ms into the turn`);
  // never faster than the world allows, even when everything changes every frame
  const chaos = run((t) => Object.assign(makeState(), { pos: new THREE.Vector3(Math.sin(t * 50) * 5, 0, 0) }), 3, 10);
  const gaps = chaos.slice(1).map((t, i) => t - chaos[i]);
  assert.ok(Math.min(...gaps) >= 0.098, `fastest gap ${(Math.min(...gaps) * 1000).toFixed(0)} ms at 10 Hz`);
  // gear, lights or smoking tyres changing go out at once
  const g2 = new SendGate();
  const st = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), acc: new THREE.Vector3(), steer: 0, key: 'a' };
  g2.sent(0, st);
  assert.equal(g2.due(40, st, 30), false);
  assert.equal(g2.due(40, { ...st, key: 'b' }, 30), true);
});
