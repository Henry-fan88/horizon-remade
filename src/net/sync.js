// Motion sync for other players' cars, built to show each car where it is now rather than
// where it was a few hundred milliseconds ago.
//   ServerClock   server time from ping round trips, trusting the fastest (least delayed)
//   predict       where a car is h seconds after a state: velocity, acceleration, turn rate
//   SendGate      sends this car's state when others' prediction of it would go wrong
//   RemoteMotion  draws another car at its predicted pose; corrections from new states
//                 fade in over TAU so the car never jumps (unless it really teleported)
import * as THREE from 'three';

export const localNow = () => performance.timeOrigin + performance.now();

// ---------------------------------------------------------------- server clock
export class ServerClock {
  constructor(size = 12) {
    this.size = size; // with a ping a second: the last 12 seconds
    this.samples = [];
    this.offset = 0; // server time - local time
    this.rtt = 0; // round trip of the sample in use
    this.synced = false;
  }

  // a message sent at local time `sent` was answered with server time `server`, seen at `now`.
  // A late answer (network stall, busy frame) has a long round trip and is outvoted.
  sample(sent, server, now = localNow()) {
    const rtt = Math.max(0, now - sent);
    this.samples.push({ rtt, offset: server + rtt / 2 - now });
    if (this.samples.length > this.size) this.samples.shift();
    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;
    this.offset = best.offset;
    this.rtt = best.rtt;
    this.synced = true;
  }

  now(local = localNow()) {
    return local + this.offset;
  }

  reset() {
    this.samples.length = 0;
    this.synced = false;
  }
}

// ---------------------------------------------------------------- prediction
export const FULL_H = 0.8; // s of full extrapolation; past it (a stalled connection) the car coasts to a stop
const COAST = 0.5; // s: time constant of that coast
const ACC_H = 0.35; // s over which a state's acceleration is trusted
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();

// Where a car is `h` seconds after state `s` ({ pos, quat, vel, angVel, acc }; acc is
// horizontal). Writes the pose, and the velocity if `outVel` is given.
export function predict(s, h, outPos, outQuat, outVel = null) {
  const hv = h <= FULL_H ? h : FULL_H + COAST * (1 - Math.exp(-(h - FULL_H) / COAST));
  const ha = Math.max(0, Math.min(h, ACC_H));
  // accelerate for ha, then hold the speed reached
  const k = 0.5 * ha * ha + ha * Math.max(0, hv - ha);
  outPos.copy(s.pos).addScaledVector(s.vel, hv);
  outPos.x += s.acc.x * k;
  outPos.z += s.acc.z * k;
  const w = s.angVel.length();
  if (w > 1e-5) {
    _dq.setFromAxisAngle(_axis.copy(s.angVel).divideScalar(w), w * hv);
    outQuat.copy(s.quat).premultiply(_dq);
  } else outQuat.copy(s.quat);
  if (outVel) {
    outVel.copy(s.vel);
    outVel.x += s.acc.x * ha;
    outVel.z += s.acc.z * ha;
  }
}

export function makeState() {
  return { ts: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), acc: new THREE.Vector3() };
}

// ---------------------------------------------------------------- sending
const POS_TOL = 0.08; // m between where others draw this car and where it is
const VEL_TOL = 0.5; // m/s
const ANG_TOL = 0.026; // rad (1.5°)
const STEER_TOL = 0.08; // rad of front-wheel angle
const MOVING_MS = 200; // longest silence while moving
const STILL_MS = 1000; // ... and while parked
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class SendGate {
  constructor() {
    this.at = -Infinity; // local time of the last send
    this.last = makeState();
    this.steer = 0;
    this.key = '';
    this.sends = 0;
  }

  // Is state `st` (pos, quat, vel, angVel, acc, steer, key) worth sending at local time `now`?
  // `key` holds discrete things (gear, lights, smoking tyres): any change is sent at once.
  due(now, st, maxHz) {
    const since = now - this.at;
    if (since < 1000 / maxHz - 2) return false;
    if (this.sends === 0 || st.key !== this.key) return true;
    const moving = st.vel.lengthSq() > 0.04 || this.last.vel.lengthSq() > 0.04;
    if (since >= (moving ? MOVING_MS : STILL_MS)) return true;
    if (Math.abs(st.steer - this.steer) > STEER_TOL) return true;
    // what everyone else is drawing right now, from the last state sent
    predict(this.last, since / 1000, _p, _q, _v);
    if (_p.distanceToSquared(st.pos) > POS_TOL * POS_TOL) return true;
    if (_v.distanceToSquared(st.vel) > VEL_TOL * VEL_TOL) return true;
    return _q.angleTo(st.quat) > ANG_TOL;
  }

  sent(now, st) {
    this.at = now;
    const l = this.last;
    l.pos.copy(st.pos);
    l.quat.copy(st.quat);
    l.vel.copy(st.vel);
    l.angVel.copy(st.angVel);
    l.acc.set(st.acc.x, 0, st.acc.z);
    this.steer = st.steer;
    this.key = st.key;
    this.sends++;
  }
}

// ---------------------------------------------------------------- drawing other cars
const TAU = 0.12; // s: a correction fades by e in this time
const SNAP = 15; // m: a bigger correction is a respawn or teleport: jump
const SNAP_ANGLE = 2.5; // rad: only a flip or a teleport; a crash spin slides back in
const IDENTITY = new THREE.Quaternion();
const _pp = new THREE.Vector3();
const _pq = new THREE.Quaternion();

export class RemoteMotion {
  constructor() {
    this.s = null; // the newest state in use
    this.next = null; // a newer one, taken in at the next frame
    this.pos = new THREE.Vector3(); // the pose drawn
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.err = new THREE.Vector3(); // drawn - predicted, fading
    this.errQ = new THREE.Quaternion();
    this.shownAt = 0; // server time of the pose drawn
    this.shown = false;
  }

  // the newest state time known (pending included)
  get ts() {
    return this.next ? this.next.ts : this.s ? this.s.ts : -Infinity;
  }

  push(state) {
    if (state.ts <= this.ts) return false; // late or repeated
    this.next = state;
    return true;
  }

  // The pose at server time `now`; `dt` s since the last frame. `limit(from, to)` may say
  // how much (0..1) of the predicted path from the state is clear of walls: the car is
  // then drawn stopped against the wall it would hit, rather than through it.
  update(now, dt, limit = null) {
    if (this.next) {
      const s = this.next;
      this.next = null;
      if (this.shown) {
        // the correction is what the new state says about the pose already on screen
        predict(s, (this.shownAt - s.ts) / 1000, _pp, _pq);
        this.err.subVectors(this.pos, _pp);
        this.errQ.copy(_pq).invert().premultiply(this.quat);
        if (this.err.lengthSq() > SNAP * SNAP || this.errQ.angleTo(IDENTITY) > SNAP_ANGLE) {
          this.err.set(0, 0, 0);
          this.errQ.identity();
        }
      }
      this.s = s;
    }
    if (!this.s) return false;
    predict(this.s, Math.max(0, (now - this.s.ts) / 1000), this.pos, this.quat, this.vel);
    if (limit) {
      const clear = limit(this.s.pos, this.pos);
      if (clear < 1) {
        this.pos.lerpVectors(this.s.pos, this.pos, clear);
        this.vel.set(0, 0, 0);
      }
    }
    const k = Math.exp(-Math.max(0, dt) / TAU);
    this.err.multiplyScalar(k);
    this.errQ.slerp(IDENTITY, 1 - k);
    this.pos.add(this.err);
    this.quat.premultiply(this.errQ);
    this.shownAt = now;
    this.shown = true;
    return true;
  }
}
