// AI race driver: pure-pursuit steering on the racing line + speed-profile throttle/brake.
import { clamp, lerp, wrapAngle } from '../core/math.js';
import { SURF } from '../world/worldgen.js';
import { SURFACE_INFO, tireSurfaceGrip, weatherGrip } from '../world/surfaces.js';

// Let opponents brake before the snow line and respect the same
// cornering budget as the player's tyres. Entirely dry route profiles stay exact.
export function snowSpeedProfile(profile, route, spec, skill = 1) {
  if (!route.world?.surfaceAt) return profile;
  const snowy = new Uint8Array(route.n);
  let hasSnow = false;
  for (let i = 0; i < route.n; i++) {
    snowy[i] = route.world.surfaceAt(route.x[i], route.z[i]) === SURF.SNOW ? 1 : 0;
    hasSnow ||= snowy[i] !== 0;
  }
  if (!hasSnow) return profile;
  const v = profile.slice(), grip = tireSurfaceGrip(SURFACE_INFO[SURF.SNOW], spec);
  for (let i = 0; i < route.n; i++) if (snowy[i]) v[i] = Math.min(v[i] * Math.sqrt(grip * 0.82), 20);
  for (let pass = 0; pass < (route.closed ? 2 : 1); pass++) {
    for (let i = route.n - (route.closed ? 1 : 2); i >= 0; i--) {
      const j = route.idx(i + 1), snow = snowy[i] || snowy[j];
      const decel = snow ? 9.81 * spec.grip * grip * 0.82 * skill : 7.5 * skill;
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * decel * Math.max(0.5, route.segLen(i))));
    }
  }
  return v;
}

const NAMES = [
  'NightOwl', 'Sofia R.', 'ApexHunter', 'M. Okafor', 'DriftQueen', 'Kenji_T', 'Lucía V.', 'TurboTom', 'Ana Ferreira', 'xXSlideXx',
  'Mateo', 'Jules B.', 'GravelGuru', 'Priya K.', 'SunsetRider', 'Olly', 'Hana M.', 'RevLimiter', 'Diego S.', 'Chloé',
  'Viktor', 'Rosa', 'LateBraker', 'Aiyana', 'Ben W.', 'Kaito', 'Lena', 'Ignacio', 'Marta', 'PixelPilot',
];

export function drivatarNames(n, seed = 1) {
  const out = [];
  let k = seed * 7;
  const used = new Set();
  while (out.length < n) {
    k = (k * 9301 + 49297) % 233280;
    const i = k % NAMES.length;
    if (used.has(i)) continue;
    used.add(i);
    out.push(NAMES[i]);
  }
  return out;
}

export class AIDriver {
  constructor(vehicle, route, opts = {}) {
    this.v = vehicle;
    this.route = route;
    this.skill = opts.skill ?? 0.95;
    this.lane = opts.lane ?? 0;
    this.baseLane = this.lane;
    this.name = opts.name ?? 'Drivatar';
    const spec = vehicle.spec;
    const topV = spec.topKmh / 3.6;
    this.profile = route.speedProfile(spec.grip * this.skill * (spec.style.sill > 0.3 ? 0.85 : 1), topV * 0.98, 7.5 * this.skill);
    this.profile = snowSpeedProfile(this.profile, route, spec, this.skill);
    this.hint = -1;
    this.s = 0;
    this.stuck = 0;
    this.lastProg = 0;
    this.recoverCooldown = 0;
    this.rubber = 1;
    this.steerI = 0;
    this.enabled = true;
  }

  update(dt, ctx) {
    const p = this.v.physics;
    const route = this.route;
    const pr = route.project(p.pos.x, p.pos.z, this.hint);
    this.hint = pr.i;
    this.s = pr.s;
    const speed = Math.max(0, p.forwardSpeed);
    // lookahead target on the racing line with lane offset
    const look = 7 + speed * 0.62;
    const tgt = route.pointAt(pr.s + look, 1, this.lane, this._t || (this._t = {}));
    const fx = Math.sin(p.heading),
      fz = Math.cos(p.heading);
    const dx = tgt.x - p.pos.x,
      dz = tgt.z - p.pos.z;
    const ang = wrapAngle(Math.atan2(dx, dz) - Math.atan2(fx, fz));
    // pure pursuit: steering angle for curvature 2 sin(a)/L
    const wb = this.v.spec.style.WB;
    const delta = Math.atan2(2 * wb * Math.sin(ang), Math.max(look, 1));
    const maxSteer = 0.6 / Math.pow(1 + Math.max(0, speed - 3) / 11, 0.72);
    let steer = clamp(-delta / Math.max(0.05, maxSteer), -1, 1);
    // target speed (looked up a bit ahead so braking happens in time)
    const iAhead = route.idx(pr.i + Math.round(4 + speed * 0.12));
    let target = Math.min(this.profile[pr.i], this.profile[iAhead]) * this.rubber;
    // in the wet the whole speed profile scales with the square root of the grip left, which
    // also scales every braking distance in it consistently (v² / 2a with a scaled by grip)
    const surf = SURFACE_INFO[this.v.physics.wheels[0].surface] || SURFACE_INFO[SURF.ROAD];
    target *= Math.sqrt(weatherGrip(surf, 30));
    // traffic awareness: slow down / change lane behind a slower car
    let blocked = false;
    if (ctx && ctx.others) {
      for (const o of ctx.others) {
        if (o === this.v) continue;
        const op = o.physics.pos;
        const rx = op.x - p.pos.x,
          rz = op.z - p.pos.z;
        const fwdD = rx * fx + rz * fz;
        const latD = rx * fz - rz * fx;
        if (fwdD > 2 && fwdD < 16 && Math.abs(latD) < 2.6) {
          const ov = o.physics.forwardSpeed;
          if (ov < speed - 0.5) {
            blocked = true;
            // pick the side with more room
            const w = tgt.w / 2 - 2;
            this.lane = clamp(this.lane + (latD > 0 ? 1 : -1) * dt * 3, -w, w);
            if (fwdD < 8) target = Math.min(target, ov + 1);
          }
        }
      }
    }
    if (!blocked) this.lane += (this.baseLane - this.lane) * Math.min(1, dt * 0.5);
    let throttle = 0,
      brake = 0;
    const err = target - speed;
    if (err > 0) throttle = clamp(err * 0.35 + 0.35, 0, 1);
    else if (err < -1.5) brake = clamp(-err * 0.12, 0, 1);
    else throttle = 0.15;
    // don't floor it while steering hard at low speed
    if (Math.abs(steer) > 0.8 && speed > 12) throttle *= 0.7;
    // stuck detection / recovery
    this.recoverCooldown -= dt;
    if (ctx && ctx.racing) {
      if (speed < 1.5 || pr.dist > 25) this.stuck += dt;
      else this.stuck = Math.max(0, this.stuck - dt * 2);
      if (this.stuck > 3 && this.recoverCooldown <= 0) {
        this.recover();
        this.stuck = 0;
        this.recoverCooldown = 4;
      }
    }
    const inp = p.input;
    inp.throttle = ctx && ctx.frozen ? (ctx.revving ? 0.4 : 0) : throttle;
    inp.brake = ctx && ctx.frozen ? 1 : brake;
    inp.steer = steer;
    inp.handbrake = 0;
  }

  recover() {
    const pt = this.route.pointAt(this.s + 5, 1, this.baseLane, {});
    const y = this.v.world.height(pt.x, pt.z);
    this.v.place(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), y);
    this.hint = -1;
  }
}

export function lerpSkill(a, b, t) {
  return lerp(a, b, t);
}
