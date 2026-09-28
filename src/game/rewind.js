// Rewind: ring buffer of vehicle states (player + race AI) sampled at 30 Hz.
const HZ = 30;
const SECONDS = 12;
const CAP = HZ * SECONDS;

function snapVehicle(v) {
  const p = v.physics;
  return {
    v,
    pos: p.pos.clone(),
    quat: p.quat.clone(),
    vel: p.vel.clone(),
    angVel: p.angVel.clone(),
    rpm: p.rpm,
    gear: p.gear,
    steer: p.steerAngle,
    wheels: p.wheels.map((w) => [w.compression, w.omega, w.angle]),
  };
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
  s.wheels.forEach((w, i) => {
    p.wheels[i].compression = p.wheels[i].prevCompression = w[0];
    p.wheels[i].omega = w[1];
    p.wheels[i].angle = w[2];
  });
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
    const frame = { vehicles: [snapVehicle(g.player)], raceTime: race ? race.raceTime : 0, racers: null };
    if (race && race.state === 'racing') {
      for (const r of race.racers) if (!r.isPlayer) frame.vehicles.push(snapVehicle(r.v));
      frame.racers = race.racers.map((r) => ({ r, dist: r.dist, hint: r.hint, lap: r.lap, finished: r.finished }));
      frame.nextCp = race.nextCp;
    }
    this.buf[this.head] = frame;
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
