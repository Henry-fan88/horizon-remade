// Rewind: ring buffer of vehicle states (player + race AI) sampled at 30 Hz.
import * as THREE from 'three';
const HZ = 30;
const SECONDS = 12;
const CAP = HZ * SECONDS;

// Snapshots are preallocated and overwritten in place (the buffer fills 30 times a second).
function makeSnap() {
  return { v: null, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), angVel: new THREE.Vector3(), rpm: 0, gear: 1, steer: 0, wheels: [new Float32Array(3), new Float32Array(3), new Float32Array(3), new Float32Array(3)], damage: { front: 0, rear: 0, left: 0, right: 0 } };
}

function snapVehicle(v, s) {
  const p = v.physics;
  s.v = v;
  s.pos.copy(p.pos);
  s.quat.copy(p.quat);
  s.vel.copy(p.vel);
  s.angVel.copy(p.angVel);
  s.rpm = p.rpm;
  s.gear = p.gear;
  s.steer = p.steerAngle;
  for (let i = 0; i < 4; i++) {
    const w = p.wheels[i];
    s.wheels[i][0] = w.compression;
    s.wheels[i][1] = w.omega;
    s.wheels[i][2] = w.angle;
  }
  Object.assign(s.damage, p.damage);
  return s;
}

function applyVehicle(s) {
  const p = s.v.physics;
  p.pos.copy(s.pos);
  p.quat.copy(s.quat);
  p.vel.copy(s.vel);
  p.angVel.copy(s.angVel);
  p.rpm = s.rpm;
  p.gear = s.gear;
  p.steerAngle = s.steer;
  for (let i = 0; i < 4; i++) {
    const w = s.wheels[i];
    p.wheels[i].compression = p.wheels[i].prevCompression = w[0];
    p.wheels[i].omega = w[1];
    p.wheels[i].angle = w[2];
  }
  Object.assign(p.damage, s.damage);
  p.updateDamageEffects();
  s.v.saveState();
}

export class Rewind {
  constructor(game) {
    this.game = game;
    this.buf = new Array(CAP);
    this.head = 0;
    this.size = 0;
    this.acc = 0;
    this.active = false;
    this.cursor = 0;
    this.overlay = document.createElement('div');
    this.overlay.className = 'rewind-overlay';
    this.overlay.innerHTML = '<div>◀◀ REWIND</div>';
    document.getElementById('ui').appendChild(this.overlay);
  }

  clear() {
    this.size = 0;
    this.head = 0;
  }

  record(dt) {
    if (this.active) return;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc = 0;
    const g = this.game;
    const race = g.race.active;
    const frame = this.buf[this.head] || (this.buf[this.head] = { vehicles: [], snaps: [], raceTime: 0, racers: null, racerPool: [], racerObjs: [], nextCp: 0 });
    frame.vehicles.length = 0;
    const snap = (v) => {
      const k = frame.vehicles.length;
      frame.vehicles.push(snapVehicle(v, frame.snaps[k] || (frame.snaps[k] = makeSnap())));
    };
    snap(g.player);
    frame.raceTime = race ? race.raceTime : 0;
    frame.racers = null;
    if (race && race.state === 'racing') {
      for (const r of race.racers) if (!r.isPlayer) snap(r.v);
      frame.racers = frame.racerPool;
      frame.racers.length = 0;
      race.racers.forEach((r, k) => {
        const o = frame.racerObjs[k] || (frame.racerObjs[k] = {});
        o.r = r;
        o.dist = r.dist;
        o.hint = r.hint;
        o.lap = r.lap;
        o.finished = r.finished;
        frame.racers.push(o);
      });
      frame.nextCp = race.nextCp;
    }
    this.head = (this.head + 1) % CAP;
    this.size = Math.min(CAP, this.size + 1);
  }

  start() {
    if (this.size < 5) return false;
    const race = this.game.race.active;
    if (race && race.state !== 'racing') return false;
    this.active = true;
    this.cursor = 0;
    this.overlay.classList.add('on');
    this.game.audio.ui('back');
    return true;
  }

  // step back through history while held; returns true while rewinding
  update(dt, held) {
    if (!this.active) return false;
    if (!held) {
      this.stop();
      return false;
    }
    this.cursor = Math.min(this.size - 1, this.cursor + dt * HZ * 1.5);
    const idx = (this.head - 1 - Math.floor(this.cursor) + CAP * 2) % CAP;
    const f = this.buf[idx];
    if (!f) return true;
    for (const s of f.vehicles) applyVehicle(s);
    const race = this.game.race.active;
    if (race && f.racers) {
      race.raceTime = f.raceTime;
      for (const r of f.racers) {
        r.r.dist = r.dist;
        r.r.hint = r.hint;
        r.r.lap = r.lap;
        r.r.finished = r.finished;
      }
      race.nextCp = f.nextCp;
      this.game.race.updateGates();
    }
    for (const s of f.vehicles) s.v.syncVisual(1);
    return true;
  }

  stop() {
    this.active = false;
    this.overlay.classList.remove('on');
    // drop the future we rewound over
    const drop = Math.floor(this.cursor);
    this.head = (this.head - drop + CAP * 2) % CAP;
    this.size = Math.max(0, this.size - drop);
    this.game.skills.breakChain('REWOUND');
    this.game.gameCam.snap();
  }
}
