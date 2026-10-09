// Rigid-body car simulation: raycast suspension + slip-based tyre model + drivetrain.
// Frame: +Z forward, +X left, +Y up (body space, origin at the centre of mass).
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { torqueCurve } from './carspecs.js';
import { SURFACE_INFO, tireSurfaceGrip, weatherGrip } from '../world/surfaces.js';
import { WORLD } from '../config.js';

const G = 9.81;
const RHO = 1.225;

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _left = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _r = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _f = new THREE.Vector3();
const _l = new THREE.Vector3();
const _F = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _qInv = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _nrm = { x: 0, y: 1, z: 0 };
const _t3 = new THREE.Vector3();
const _k3 = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// Driver aids. 'full' is what AI and traffic use; the player picks theirs in Settings.
//   steering  off | normal | full   auto-countersteer strength (off = none)
//   stability                        yaw control + throttle cut in slides, and a gentle
//                                    attitude hold in the air (off = none)
//   abs / tc                         anti-lock brakes / traction control
export const ASSISTS_FULL = { steering: 'full', stability: true, abs: true, tc: true };
export const ASSISTS_OFF = { steering: 'off', stability: false, abs: false, tc: false };

export class VehiclePhysics {
  constructor(spec, world) {
    this.spec = spec;
    this.world = world;
    const st = spec.style;
    this.mass = spec.mass;
    const m = this.mass;
    const L = st.L,
      W = st.W,
      H = st.H * 0.75;
    // body-space inertia (x = pitch, y = yaw, z = roll)
    this.invI = new THREE.Vector3(1 / ((m / 12) * (H * H + L * L) * 0.95), 1 / ((m / 12) * (W * W + L * L) * 1.05), 1 / ((m / 12) * (W * W + H * H) * 1.1));

    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();

    // centre of mass in model space
    const wf = spec.wf;
    const a = st.WB * (1 - wf); // CG -> front axle
    const b = st.WB * wf; // CG -> rear axle
    this.cgModel = new THREE.Vector3(0, spec.cgH, b - st.WB / 2);
    this.cgH = spec.cgH;
    const travel = spec.travel ?? 0.2;
    const freq = spec.susp ?? 1.9;
    const wheels = [];
    const defs = [
      { x: st.trackF / 2, z: a, r: st.wheelR, front: true },
      { x: -st.trackF / 2, z: a, r: st.wheelR, front: true },
      { x: st.trackR / 2, z: -b, r: st.wheelRr ?? st.wheelR, front: false },
      { x: -st.trackR / 2, z: -b, r: st.wheelRr ?? st.wheelR, front: false },
    ];
    for (const d of defs) {
      const corner = m * (d.front ? wf : 1 - wf) * 0.5;
      const w0 = 2 * Math.PI * freq;
      const k = corner * w0 * w0;
      const c = 2 * 0.32 * Math.sqrt(k * corner);
      const x0 = (corner * G) / k; // static compression
      const rest = travel;
      const mountY = -spec.cgH + d.r + (rest - x0);
      wheels.push({
        ...d,
        local: new THREE.Vector3(d.x, mountY, d.z),
        rest,
        k,
        cBump: c,
        cReb: c * 1.35,
        compression: x0,
        prevCompression: x0,
        contact: false,
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(0, 1, 0),
        Fz: 0,
        slip: 0,
        slipAngle: 0,
        spinning: 0,
        locked: 0,
        omega: 0,
        angle: 0,
        steer: 0,
        surface: 8,
        surfTimer: 0,
        driven: spec.drive === 'AWD' || (spec.drive === 'RWD' && !d.front) || (spec.drive === 'FWD' && d.front),
        suspLen: rest - x0,
        vLong: 0,
        vLat: 0,
      });
    }
    this.wheels = wheels;
    this.arb = [wheels[0].k * 0.7, wheels[2].k * 0.45];

    // drivetrain
    this.rpm = spec.idle || 0;
    this.gear = 1; // -1 reverse, 0 neutral, 1..n
    this.shiftTimer = 0;
    this.clutch = 1;
    this.boost = 0;
    this.throttleOut = 0;
    this.revLimiter = 0;
    this.redline = spec.redline;
    this.maxRpm = spec.redline * 1.02;
    this.autoGear = true;

    // input state
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
    this.steerAngle = 0;
    this.assists = { ...ASSISTS_FULL };
    // how hard each aid is intervening this step (0..1), for the HUD
    this.aid = { esc: 0, tcs: 0, abs: 0 };

    // outputs for gameplay/effects
    this.speed = 0;
    this.forwardSpeed = 0;
    this.airTime = 0;
    this.grounded = 0;
    this.slipAngleBody = 0;
    this.lastImpact = 0;
    this.upsideTimer = 0;
    this.bottomOut = 0;
    this.gripMul = 1;
    this.snowGrip = 1;
    this.lateralAcceleration = G * spec.grip;
    this.powerMul = 1;
    this.frozen = false;
    this.bodyContacts = 0;
    this.onRoad = true;
    this.offroadFactor = 0;
    // water: depth at the centre of mass, share of the body under water, how long the car
    // has been afloat, and how flooded the cabin is (0 dry .. 1 sinking)
    this.water = { depth: 0, submerged: 0, wheelsWet: 0, floatTime: 0, flood: 0, stalled: false };
    // damage per zone (0 intact .. 1 wrecked). 'cosmetic' only reports it; 'simulation' also
    // costs engine power and pulls the steering; 'off' ignores hits
    this.damage = { front: 0, rear: 0, left: 0, right: 0 };
    this.damageMode = 'cosmetic';
    this.damagePower = 1;
    this.damagePull = 0;
    this.lastDamage = 0; // damage taken since the game last read it
    this.scrape = 0; // fastest sliding contact since the game last read it (m/s)
    this.scrapePoint = new THREE.Vector3();
    this.impactPoint = new THREE.Vector3();
    this.seaLevel = WORLD.seaLevel;

    const hw = W / 2 - 0.1,
      hl = L / 2 - 0.1;
    const yLow = -spec.cgH + st.sill + 0.05,
      yHigh = -spec.cgH + st.H;
    const zc = -this.cgModel.z;
    this.bodyPoints = [
      [hw, yLow, zc + hl],
      [-hw, yLow, zc + hl],
      [hw, yLow, zc - hl],
      [-hw, yLow, zc - hl],
      [hw * 0.8, yHigh, zc + hl * 0.3],
      [-hw * 0.8, yHigh, zc + hl * 0.3],
      [hw * 0.8, yHigh, zc - hl * 0.4],
      [-hw * 0.8, yHigh, zc - hl * 0.4],
      [hw, (yLow + yHigh) / 2, zc],
      [-hw, (yLow + yHigh) / 2, zc],
      [0, yLow, zc],
    ].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    // 3 x 2 columns of the body for buoyancy and hull drag (bottom point, height, area)
    this.hullCols = [];
    for (const cz of [-1, 0, 1])
      for (const cx of [-1, 1]) this.hullCols.push(new THREE.Vector3(cx * W * 0.25, yLow - 0.05, zc + cz * L * 0.3));
    this.hullColH = st.H - st.sill;
    this.hullColA = (L * W) / 6;
    this.halfExtents = new THREE.Vector3(W / 2, (st.H - st.sill) / 2, L / 2);
    this.boxCenterLocal = new THREE.Vector3(0, -spec.cgH + (st.H + st.sill) / 2, zc);
  }

  // Place the car at a world position/heading, resting on the ground
  reset(x, z, heading, y = null) {
    const hgt = y ?? this.world.height(x, z);
    this.pos.set(x, hgt + this.cgH + 0.15, z);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    for (const w of this.wheels) {
      w.compression = w.prevCompression = (this.mass * G) / 4 / w.k;
      w.omega = 0;
      w.surfTimer = 0; // a respawn must query its new snow/asphalt contacts immediately
    }
    this.rpm = this.spec.idle || 0;
    this.gear = 1;
    this.snowGrip = 1;
    this.lateralAcceleration = G * this.spec.grip;
    this.steerAngle = 0;
    this.upsideTimer = 0;
    this.airTime = 0;
    const wt = this.water;
    wt.depth = wt.submerged = wt.wheelsWet = wt.floatTime = wt.flood = 0;
    wt.stalled = false;
    this.powerMul = 1;
  }

  get heading() {
    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(_fwd.x, _fwd.z);
  }

  applyForceAt(F, point) {
    this.force.add(F);
    _tmp.subVectors(point, this.pos);
    this.torque.add(_tmp2.crossVectors(_tmp, F));
  }

  // world-space inverse inertia applied to a vector
  applyInvInertia(v, out) {
    _qInv.copy(this.quat).invert();
    out.copy(v).applyQuaternion(_qInv);
    out.x *= this.invI.x;
    out.y *= this.invI.y;
    out.z *= this.invI.z;
    return out.applyQuaternion(this.quat);
  }

  // impulse at a world point (used by collisions)
  applyImpulse(J, point) {
    this.vel.addScaledVector(J, 1 / this.mass);
    _tmp.subVectors(point, this.pos);
    _tmp2.crossVectors(_tmp, J);
    this.applyInvInertia(_tmp2, _tmp2);
    this.angVel.add(_tmp2);
  }

  // effective inverse mass along normal n at world point p
  invMassAt(p, n) {
    _tmp.subVectors(p, this.pos);
    _tmp2.crossVectors(_tmp, n);
    this.applyInvInertia(_tmp2, _t3);
    _k3.crossVectors(_t3, _tmp);
    return 1 / this.mass + n.dot(_k3);
  }

  // a sliding contact against a wall, rail or car (called by the collision code)
  noteScrape(p, vt) {
    if (vt > this.scrape) {
      this.scrape = vt;
      this.scrapePoint.copy(p);
    }
    if (this.damageMode !== 'off') this.hurt(p, vt * 0.0001);
  }

  // an impact at world point p with closing speed v (m/s)
  addDamage(p, v) {
    // Impact effects still need the contact point when damage is disabled.
    this.impactPoint.copy(p);
    if (this.damageMode === 'off' || v < 3.5) return;
    this.hurt(p, (v - 3.5) * (v - 3.5) * 0.0015);
  }

  hurt(p, amount) {
    // zone from where the contact is on the body
    _tmp.subVectors(p, this.pos).applyQuaternion(_qInv.copy(this.quat).invert());
    const he = this.halfExtents;
    const fz = (_tmp.z - this.boxCenterLocal.z) / he.z,
      fx = _tmp.x / he.x;
    const d = this.damage;
    const zone = Math.abs(fz) * 1.15 > Math.abs(fx) ? (fz > 0 ? 'front' : 'rear') : fx > 0 ? 'left' : 'right';
    d[zone] = Math.min(1, d[zone] + amount);
    this.lastDamage += amount;
    this.updateDamageEffects();
  }

  updateDamageEffects() {
    const d = this.damage;
    if (this.damageMode !== 'simulation') {
      this.damagePower = 1;
      this.damagePull = 0;
      return;
    }
    const worst = Math.max(d.front, d.rear);
    const k = Math.min(1, Math.max(0, (worst - 0.35) / 0.65));
    this.damagePower = 1 - 0.22 * k * k * (3 - 2 * k);
    // a bent corner pulls the car toward the damaged side
    this.damagePull = 0.035 * (d.right - d.left) * (0.4 + 0.6 * d.front);
  }

  repair() {
    const d = this.damage;
    d.front = d.rear = d.left = d.right = 0;
    this.updateDamageEffects();
  }

  setAssists(a) {
    Object.assign(this.assists, a);
  }
  get tractionControl() {
    return this.assists.tc;
  }
  set tractionControl(v) {
    this.assists.tc = !!v;
  }
  get abs() {
    return this.assists.abs;
  }
  set abs(v) {
    this.assists.abs = !!v;
  }

  gearRatio() {
    if (this.gear === 0) return 0;
    if (this.gear < 0) return -this.spec.ratios[0] * 1.1;
    return this.spec.ratios[this.gear - 1];
  }

  engineTorque(rpm, throttle) {
    const s = this.spec;
    if (s.electric) {
      const w = Math.max(1, (rpm / 60) * Math.PI * 2);
      const tMax = s.peakTorque;
      const pMax = s.powerKW * 1000;
      return Math.min(tMax, pMax / w) * throttle;
    }
    const x = clamp(rpm / s.redline, 0.05, 1.05);
    let t = s.peakTorque * torqueCurve(x, s.tqPeak, s.tqFall);
    if (s.turbo) t *= 0.62 + 0.38 * this.boost;
    // engine braking when off throttle
    const brakeT = s.peakTorque * (0.12 + 0.18 * x);
    return t * throttle - brakeT * (1 - throttle) * (rpm > s.idle * 1.1 ? 1 : 0);
  }

  step(dt) {
    const s = this.spec;
    const inp = this.input;
    const world = this.world;
    if (this.frozen) return;
    this.force.set(0, -G * this.mass, 0);
    this.torque.set(0, 0, 0);

    _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _left.set(1, 0, 0).applyQuaternion(this.quat);

    const speed = this.vel.length();
    this.speed = speed;
    const vf = this.vel.dot(_fwd);
    this.forwardSpeed = vf;

    // ---------------- steering (speed-sensitive lock, optional countersteer assist)
    const A = this.assists;
    const steerLevel = A.steering === 'full' ? 2 : A.steering === 'normal' ? 1 : 0;
    // a steering ratio that tightens with speed (pads / keys); raw mode keeps more lock
    // (single-seaters have less lock and far quicker responses: steerScale trims it)
    const maxSteer = (0.6 * (s.steerScale ?? 1)) / Math.pow(1 + Math.max(0, Math.abs(vf) - 3) / 11, steerLevel === 0 ? 0.64 : 0.72);
    let target = inp.steer * maxSteer + this.damagePull;
    const latV = this.vel.dot(_left);
    const beta = Math.abs(vf) > 2 ? Math.atan2(latV, Math.abs(vf)) : 0; // body slip (+ = sliding left)
    this.slipAngleBody = beta;
    // Digital full lock must not ask for a radius tighter than the contact patches can
    // support. Keep a little tyre slip for cornering, but avoid steering far past the
    // grip peak at speed. Raw steering and deliberate handbrake slides keep full lock.
    if (steerLevel > 0 && !inp.handbrake && Math.abs(vf) > 3) {
      const normalAcceleration = G + 0.5 * RHO * s.ClA * vf * vf / this.mass;
      const surfaceGrip = clamp(this.lateralAcceleration / Math.max(0.001, s.grip * normalAcceleration), 0, 1);
      const gripLock = Math.atan(s.style.WB * this.lateralAcceleration * 0.95 / (vf * vf)) + 0.045 * surfaceGrip;
      target = clamp(target, -gripLock, gripLock);
    }
    if (steerLevel > 0 && vf > 4) {
      // the front wheels follow the direction of travel in a slide; 'normal' lets small
      // slides through and only catches bigger ones
      const b = steerLevel === 2 ? beta : Math.sign(beta) * Math.max(0, Math.abs(beta) - 0.05);
      target += clamp(-b, -0.5, 0.5) * (steerLevel === 2 ? 0.75 : 0.4) * (1 - Math.abs(inp.steer) * 0.35);
    }
    target = clamp(target, -0.65, 0.65);
    const rate = 2.6 + Math.abs(target - this.steerAngle) * 3;
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);

    // ---------------- drivetrain
    const ratio = this.gearRatio();
    const fd = s.finalDrive;
    let drivenSpeed = 0,
      drivenCount = 0;
    for (const w of this.wheels)
      if (w.driven) {
        drivenSpeed += w.omega * w.r;
        drivenCount++;
      }
    drivenSpeed /= Math.max(1, drivenCount);
    const rWheel = this.wheels[2].r;
    let throttle = inp.throttle;
    let brake = inp.brake;
    // reverse logic: hold brake at standstill to reverse, throttle in reverse acts as brake
    if (this.autoGear) {
      if (this.gear > 0 && vf < 0.6 && brake > 0.2 && throttle < 0.1) {
        this.reverseTimer = (this.reverseTimer || 0) + dt;
        if (this.reverseTimer > 0.25) this.gear = -1;
      } else this.reverseTimer = 0;
      if (this.gear < 0) {
        if (throttle > 0.1 && vf > -0.6) this.gear = 1;
        else {
          const t = throttle;
          throttle = brake;
          brake = t;
        }
      }
    }
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      throttle *= 0.0;
    }
    // ---------------- stability control: compare the yaw rate with what the steering asks
    // for; when the car rotates (or slides) well beyond it, add a correcting yaw moment (as
    // from braking single wheels) and cut the throttle
    this.aid.esc = 0;
    let escYaw = 0;
    if (A.stability && !inp.handbrake && vf > 5 && this.grounded >= 2) {
      let rDes = (-vf * Math.tan(this.steerAngle)) / s.style.WB;
      // the most the tyres can turn the car, including what the wings press down at speed
      const rMax = 0.95 * this.lateralAcceleration / vf;
      rDes = clamp(rDes, -rMax, rMax);
      const yawRate = this.angVel.dot(_up);
      // Only arrest excess rotation. Adding yaw to an understeering car turns its body
      // without the matching lateral force, making it skate along its original course.
      const excessYaw = Math.max(0, Math.abs(yawRate) - Math.abs(rDes) - 0.10);
      const wrongWay = yawRate * rDes < 0 ? Math.abs(yawRate) : 0;
      const slideYaw = beta * yawRate < 0 ? 2 * Math.max(0, Math.abs(beta) - 0.055) : 0;
      const over = Math.max(excessYaw, wrongWay, slideYaw);
      if (over > 0) {
        this.aid.esc = Math.min(1, over * 3);
        escYaw = -Math.sign(yawRate) * Math.min(1, over / 0.3) * this.mass * 3.2 * this.snowGrip;
        throttle *= clamp(1 - over * 2.5, 0.15, 1);
      }
    }
    // turbo spool
    if (s.turbo) {
      const tgt = throttle * clamp((this.rpm - s.redline * 0.25) / (s.redline * 0.35), 0, 1);
      this.boost += (tgt - this.boost) * (1 - Math.exp(-dt * (tgt > this.boost ? 2.4 : 6)));
    }
    const wheelRpm = (Math.abs(drivenSpeed) / rWheel) * (60 / (Math.PI * 2));
    let rpmFromWheels = wheelRpm * Math.abs(ratio) * fd;
    const idle = s.idle;
    // clutch slip at low speed lets the engine rev; a race car (spec.launchRpm) holds its
    // launch revs on the clutch until the wheels catch up instead of bogging down
    const launchRpm = s.electric ? 0 : s.launchRpm ?? Math.min(s.redline * 0.55, idle + 3500);
    const launch = s.launchRpm && this.gear > 0 ? throttle * (launchRpm - idle) : throttle * (this.gear !== 0 && Math.abs(vf) < 8 ? launchRpm - idle : 0) * clamp(1 - Math.abs(vf) / 8, 0, 1);
    let rpmTarget = Math.max(rpmFromWheels, idle + launch);
    if (this.gear === 0 || this.shiftTimer > 0) rpmTarget = Math.max(idle, this.rpm * 0.985 + throttle * 60);
    this.rpm += (rpmTarget - this.rpm) * (1 - Math.exp(-dt * 14));
    // rev limiter
    if (this.rpm >= this.maxRpm) {
      this.revLimiter = 0.06;
    }
    if (this.revLimiter > 0) {
      this.revLimiter -= dt;
      throttle *= 0.0;
      this.rpm = Math.min(this.rpm, this.maxRpm);
    }
    this.throttleOut = throttle;
    let engineT = this.engineTorque(Math.max(this.rpm, idle), throttle) * this.powerMul * this.damagePower;
    if (this.gear === 0) engineT = 0;
    const eff = 0.88;
    let wheelTorqueTotal = engineT * ratio * fd * eff;

    // automatic gearbox
    if (this.autoGear && this.gear > 0 && this.shiftTimer <= 0 && s.gears > 1) {
      const up = s.redline * 0.955;
      const nGear = s.ratios.length;
      const pedal = inp.throttle;
      // wheel-driven rpm (ignores clutch slip) decides when a gear is too short
      const overRev = rpmFromWheels > s.redline * 1.02;
      if (this.gear < nGear && ((this.rpm > up && pedal > 0.1 && this.grounded > 1) || overRev)) this.shift(1);
      else if (this.gear > 1) {
        const lowerRpm = (this.rpm * s.ratios[this.gear - 2]) / s.ratios[this.gear - 1];
        const downAt = pedal > 0.6 ? s.redline * 0.72 : s.redline * 0.52;
        if (lowerRpm < downAt && this.rpm < s.redline * 0.5) this.shift(-1);
      }
    }
    if (inp.shiftUp) {
      inp.shiftUp = false;
      if (this.gear < s.ratios.length) this.shift(1);
    }
    if (inp.shiftDown) {
      inp.shiftDown = false;
      if (this.gear > -1) this.shift(-1);
    }

    // ---------------- wheels
    let nWheelsDriven = 0;
    for (const w of this.wheels) if (w.driven && w.contact) nWheelsDriven++;
    if (!nWheelsDriven) nWheelsDriven = drivenCount;
    let grounded = 0;
    let offroad = 0;
    let rumble = 0;
    const frontShare = s.drive === 'AWD' ? s.split ?? 0.4 : s.drive === 'FWD' ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      // ray origin & direction
      _o.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      _d.copy(_up).negate();
      let contact = false;
      let t = 0;
      if (_d.y < -0.25) {
        const h0 = world.height(_o.x, _o.z);
        t = (_o.y - h0) / -_d.y;
        _cp.copy(_o).addScaledVector(_d, t);
        const hq = world.sample(_cp.x, _cp.z, _nrm);
        _n.set(_nrm.x, _nrm.y, _nrm.z);
        _tmp.set(_cp.x, hq, _cp.z).sub(_o);
        const denom = _n.dot(_d);
        if (denom < -1e-3) t = _n.dot(_tmp) / denom;
        contact = t < w.rest + w.r && t > -w.r * 0.8;
      }
      w.prevCompression = w.compression;
      if (!contact) {
        w.contact = false;
        w.compression = 0;
        w.suspLen = w.rest;
        w.Fz = 0;
        w.slip = 0;
        w.spinning = 0;
        // free-spinning wheel keeps rotating, driven wheels spin up on throttle
        if (w.driven && this.gear !== 0) w.omega += ((engineT * ratio * fd) / 4 / 1.5) * dt;
        w.omega *= Math.exp(-dt * 0.8);
        if (inp.brake > 0.1 || (inp.handbrake && !w.front)) w.omega *= Math.exp(-dt * 12);
        continue;
      }
      grounded++;
      w.contact = true;
      let comp = w.rest + w.r - t;
      const bottom = comp > w.rest;
      w.compression = Math.min(comp, w.rest + 0.12);
      w.suspLen = w.rest - Math.min(comp, w.rest);
      w.point.copy(_o).addScaledVector(_d, t);
      w.normal.copy(_n);
      // surface lookup (cached, updated every few steps)
      w.surfTimer -= dt;
      if (w.surfTimer <= 0) {
        w.surface = world.surfaceAt(w.point.x, w.point.z);
        w.surfTimer = 0.05;
      }
      const surf = SURFACE_INFO[w.surface] || SURFACE_INFO[0];
      if (surf.offroad) offroad++;
      if (surf.rumble) rumble++;
      // --- suspension
      const cv = (w.compression - w.prevCompression) / dt;
      let Fs = w.k * Math.min(w.compression, w.rest) + (cv > 0 ? w.cBump : w.cReb) * cv;
      if (bottom) {
        Fs += w.k * 12 * (comp - w.rest);
        this.bottomOut = Math.max(this.bottomOut, cv);
      }
      Fs = Math.max(0, Fs);
      w.Fs = Fs;
    }
    // anti-roll bars
    for (let axle = 0; axle < 2; axle++) {
      const a = this.wheels[axle * 2],
        b = this.wheels[axle * 2 + 1];
      if (!a.contact || !b.contact) continue;
      const diff = (a.compression - b.compression) * this.arb[axle];
      a.Fs = Math.max(0, a.Fs + diff);
      b.Fs = Math.max(0, b.Fs - diff);
    }
    const handbrake = inp.handbrake;
    let absWork = 0,
      tcWork = 0;
    let snowLoad = 0, totalLoad = 0, lateralForce = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) continue;
      const surf = SURFACE_INFO[w.surface] || SURFACE_INFO[0];
      const offK = tireSurfaceGrip(surf, s);
      const Fs = w.Fs;
      _F.copy(_up).multiplyScalar(Fs);
      this.applyForceAt(_F, w.point);
      w.Fz = Fs;
      // --- tyre frame
      const steer = w.front ? this.steerAngle : 0;
      w.steer = steer;
      _f.copy(_fwd).multiplyScalar(Math.cos(steer)).addScaledVector(_left, -Math.sin(steer));
      _f.addScaledVector(w.normal, -_f.dot(w.normal)).normalize();
      _l.crossVectors(w.normal, _f);
      _r.subVectors(w.point, this.pos);
      _vc.crossVectors(this.angVel, _r).add(this.vel);
      const vLong = _vc.dot(_f),
        vLat = _vc.dot(_l);
      w.vLong = vLong;
      w.vLat = vLat;
      const Fz = Math.min(Fs, this.mass * G * 1.2);
      totalLoad += Fz;
      snowLoad += Fz * (surf.name === 'snow' ? offK : 1);
      const loadK = 1 - 0.12 * (Fz / ((this.mass * G) / 4) - 1);
      // standing water under the tyre: less grip as it gets deeper (aquaplaning)
      const wet = this.seaLevel - w.point.y;
      const wetK = wet > 0 ? 1 - 0.55 * Math.min(1, wet / 0.45) : 1;
      // rain on the road (weatherGrip is exactly 1 in the dry, so dry results don't move)
      const mu = s.grip * offK * this.gripMul * wetK * weatherGrip(surf, Math.abs(vLong)) * clamp(loadK, 0.75, 1.15);
      const maxF = mu * Fz;
      lateralForce += maxF;
      // An unloaded contact has no friction budget. Avoid 0/0 in TC and the ellipse.
      if (maxF < 1e-6) { w.slip = w.spinning = w.locked = 0; continue; }
      const maxFx = maxF * (surf.longitudinal ?? 1.32);
      // lateral force from the slip angle (simplified magic formula)
      const alpha = Math.atan2(vLat, Math.abs(vLong) + 0.6);
      w.slipAngle = alpha;
      const B = surf.cornerStiffness ?? 10.5,
        C = surf.cornerShape ?? 1.45;
      let Fy = -Fz * mu * Math.sin(C * Math.atan(B * alpha));
      // longitudinal: drive, brakes, rolling resistance
      let driveShare = 0;
      if (w.driven) {
        const axleShare = w.front ? frontShare : 1 - frontShare;
        const otherContact = this.wheels[i ^ 1].contact;
        driveShare = axleShare * (otherContact ? 0.5 : 1);
        if (s.drive !== 'AWD' && nWheelsDriven === 0) driveShare = 0;
      }
      let driveF = (wheelTorqueTotal * driveShare) / w.r;
      const brakeBias = w.front ? 0.64 : 0.36;
      let brakeF = brake * s.brake * this.mass * G * brakeBias * 0.5;
      // ABS keeps the brake just under the lock-up point (so the car still steers)
      if (A.abs && brakeF > maxFx * 0.96) {
        brakeF = maxFx * 0.96;
        absWork = Math.max(absWork, brake);
      }
      const handLocked = handbrake > 0 && !w.front;
      const locked = handLocked || (brakeF > maxFx && Math.abs(vLong) > 0.5);
      w.locked = locked ? 1 : 0;
      let Fx = 0;
      let spinning = 0;
      if (locked && Math.hypot(vLong, vLat) > 0.3) {
        // a locked tyre slides: its friction opposes the contact patch's velocity
        const vm = Math.hypot(vLong, vLat);
        const slide = mu * Fz * (surf.lockedGrip ?? 0.82);
        Fx = (-vLong / vm) * slide;
        Fy = (-vLat / vm) * slide;
      } else {
        // traction control leaves room for the cornering force the tyre is making
        if (A.tc && driveF !== 0) {
          const room = maxFx * Math.sqrt(Math.max(0, 1 - (Fy / maxF) * (Fy / maxF))) * 0.97;
          if (Math.abs(driveF) > room) {
            tcWork = Math.max(tcWork, Math.min(1, (Math.abs(driveF) - room) / maxFx + 0.3));
            driveF = Math.sign(driveF) * Math.max(room, maxFx * 0.12);
          }
        }
        Fx = driveF - clamp(vLong / 0.4, -1, 1) * brakeF;
        Fx -= clamp(vLong, -1, 1) * 0.014 * Fz * (1 + surf.rough * 7); // rolling resistance
        // hold the car still when parked
        if (Math.abs(throttle) < 0.02 && Math.abs(vLong) < 1.2 && speed < 1.5) Fx -= clamp(vLong * 3, -1, 1) * maxF * 0.8;
        // friction ellipse: the combined force can't exceed what the tyre can give; beyond
        // it the tyre is sliding and both components shrink together (wheelspin kills
        // cornering grip — power oversteer — unless traction control prevents it)
        const ux = Fx / maxFx,
          uy = Fy / maxF;
        const m2 = ux * ux + uy * uy;
        if (m2 > 1) {
          const mag = Math.sqrt(m2);
          const k = (1 - (surf.slideLoss ?? 0.1) * Math.min(1, mag - 1)) / mag;
          if (driveF !== 0 && Math.abs(ux) > 0.2) spinning = Math.min(1, (mag - 1) * Math.abs(ux) / mag * 1.5);
          Fx *= k;
          Fy *= k;
        }
      }
      w.spinning = spinning;
      w.slip = Math.min(1, Math.abs(alpha) * 2.2 + spinning + (w.locked ? 0.8 : 0));
      // longitudinal force at the contact patch (full pitch transfer); lateral force at
      // roll-centre height, about half way up to the centre of mass
      _F.copy(_f).multiplyScalar(Fx);
      this.applyForceAt(_F, w.point);
      _F.copy(_l).multiplyScalar(Fy);
      _cp.copy(w.point).addScaledVector(_up, this.cgH * 0.5);
      this.applyForceAt(_F, _cp);
      // wheel spin for visuals / rpm
      const target = vLong / w.r;
      if (w.locked) w.omega += (0 - w.omega) * Math.min(1, dt * 30);
      else if (spinning > 0.05 && driveF !== 0) w.omega += (target * (1 + spinning * 1.5) + Math.sign(driveF) * spinning * 20 - w.omega) * Math.min(1, dt * 10);
      else w.omega = target;
    }
    this.grounded = grounded;
    // ESC has only the grip available at the tyres, including split snow/asphalt.
    this.snowGrip = totalLoad > 0 ? snowLoad / totalLoad : 1;
    this.lateralAcceleration = lateralForce / this.mass;
    this.aid.abs = absWork;
    this.aid.tcs = tcWork;
    this.offroadFactor = grounded ? offroad / grounded : this.offroadFactor;
    // share of the tyres drumming over circuit kerbs (camera shake + rumble sound)
    this.kerbFactor = grounded ? rumble / 4 : 0;
    this.onRoad = this.offroadFactor < 0.5;

    // ---------------- aerodynamics
    if (speed > 0.5) {
      const drag = 0.5 * RHO * s.CdA * speed;
      this.force.addScaledVector(this.vel, -drag);
      const down = 0.5 * RHO * s.ClA * vf * vf;
      this.force.addScaledVector(_up, -down);
    }

    // ---------------- stability control / air attitude
    if (grounded === 0) {
      this.airTime += dt;
      if (A.stability) {
        // gentle attitude hold in the air so landings are on the wheels (pitch/roll only)
        _tmp.crossVectors(_up, WORLD_UP);
        this.torque.addScaledVector(_tmp, this.mass * 1.4);
        _tmp2.copy(_up).multiplyScalar(this.angVel.dot(_up));
        _tmp.subVectors(this.angVel, _tmp2);
        this.torque.addScaledVector(_tmp, -this.mass * 0.25);
      }
    } else {
      this.airTime = 0;
      if (escYaw !== 0) this.torque.addScaledVector(_up, escYaw);
    }

    // ---------------- water: wading drag on the wheels, buoyancy and drag on the body
    this.stepWater(dt);

    // ---------------- chassis contacts with the ground (roll-overs, bottoming out)
    this.bodyContacts = 0;
    for (const bp of this.bodyPoints) {
      _cp.copy(bp).applyQuaternion(this.quat).add(this.pos);
      const h = world.sample(_cp.x, _cp.z, _nrm);
      const depth = h - _cp.y;
      if (depth > 0) {
        this.bodyContacts++;
        _n.set(_nrm.x, _nrm.y, _nrm.z);
        _r.subVectors(_cp, this.pos);
        _vc.crossVectors(this.angVel, _r).add(this.vel);
        const vn = _vc.dot(_n);
        const Fn = Math.max(0, this.mass * 180 * depth - this.mass * 10 * vn);
        _F.copy(_n).multiplyScalar(Fn);
        // friction
        _tmp.copy(_vc).addScaledVector(_n, -vn);
        const vt = _tmp.length();
        if (vt > 0.01) _F.addScaledVector(_tmp, (-Math.min(Fn * 0.6, vt * this.mass * 2)) / vt);
        this.applyForceAt(_F, _cp);
        if (vn < -3 && -vn > this.lastImpact) {
          this.lastImpact = -vn;
          this.impactPoint.copy(_cp);
        }
      }
    }

    // ---------------- integrate
    this.vel.addScaledVector(this.force, dt / this.mass);
    this.applyInvInertia(this.torque, _tmp);
    this.angVel.addScaledVector(_tmp, dt);
    // mild angular damping
    this.angVel.multiplyScalar(1 - dt * 0.15);
    this.pos.addScaledVector(this.vel, dt);
    const wl = this.angVel.length();
    if (wl > 1e-6) {
      _dq.setFromAxisAngle(_tmp.copy(this.angVel).divideScalar(wl), wl * dt);
      this.quat.premultiply(_dq).normalize();
    }
    // wheel visual rotation
    for (const w of this.wheels) w.angle += w.omega * dt;

    // upside down detection
    _up.set(0, 1, 0).applyQuaternion(this.quat);
    if (_up.y < 0.3 && speed < 4) this.upsideTimer += dt;
    else this.upsideTimer = 0;
  }

  stepWater(dt) {
    const wt = this.water;
    const sea = this.seaLevel;
    wt.depth = sea - this.pos.y;
    // cheap exit when the whole car is clear of the water
    if (this.pos.y - this.cgH - 0.2 > sea) {
      wt.submerged = wt.wheelsWet = 0;
      wt.floatTime = 0;
      wt.flood = Math.max(0, wt.flood - dt * 0.2);
      return;
    }
    const RHO_W = 1000;
    // wheels pushing through water: drag grows with depth and speed squared
    let wetWheels = 0;
    for (const w of this.wheels) {
      _o.copy(w.local).applyQuaternion(this.quat).add(this.pos);
      const d = Math.min(2 * w.r, sea - (_o.y - w.suspLen - w.r));
      if (d <= 0) continue;
      wetWheels++;
      _r.subVectors(_o, this.pos);
      _vc.crossVectors(this.angVel, _r).add(this.vel);
      const v = _vc.length();
      if (v < 0.05) continue;
      const F = Math.min(this.mass * 6, 9 * d * v * v + 60 * d * v);
      _F.copy(_vc).multiplyScalar(-F / v);
      _F.y *= 0.3;
      this.applyForceAt(_F, _o);
    }
    wt.wheelsWet = wetWheels / 4;
    // hull columns: buoyancy from the submerged part (less as the cabin floods), and drag
    const fill = 0.42 * (1 - 0.75 * wt.flood);
    let sub = 0;
    for (const c of this.hullCols) {
      _o.copy(c).applyQuaternion(this.quat).add(this.pos);
      const h = Math.min(this.hullColH, sea - _o.y);
      if (h <= 0) continue;
      const frac = h / this.hullColH;
      sub += frac;
      _cp.copy(_o).addScaledVector(_up, h * 0.5);
      _F.set(0, RHO_W * 9.81 * this.hullColA * h * fill, 0);
      this.applyForceAt(_F, _cp);
      _r.subVectors(_cp, this.pos);
      _vc.crossVectors(this.angVel, _r).add(this.vel);
      const v = _vc.length();
      if (v > 0.01) {
        // bluff-body drag on the wetted part (sideways and vertical motion damped harder)
        const cd = 0.5 * RHO_W * 0.12 * this.hullColA * frac;
        _F.copy(_vc).multiplyScalar(-cd * v);
        _F.y *= 4;
        this.applyForceAt(_F, _cp);
      }
    }
    wt.submerged = sub / this.hullCols.length;
    // afloat: no wheel on the ground and the hull in the water
    if (this.grounded === 0 && wt.submerged > 0.08) wt.floatTime += dt;
    else wt.floatTime = Math.max(0, wt.floatTime - dt * 2);
    // water gets in once the sills are under; the engine drowns when the intake goes under
    if (wt.submerged > 0.35) wt.flood = Math.min(1, wt.flood + dt * 0.12 * wt.submerged);
    if (wt.depth > this.cgH + 0.25 && !this.spec.electric) wt.stalled = true;
    if (wt.stalled) this.powerMul = 0;
  }

  shift(dir) {
    const n = this.spec.ratios.length;
    const g = this.gear + dir;
    if (g < -1 || g > n) return;
    if (g === 0 && this.autoGear) {
      this.gear = dir > 0 ? 1 : -1;
    } else this.gear = g;
    this.shiftTimer = this.spec.electric ? 0 : 0.14;
    this.justShifted = dir;
  }

  // body-space basis helpers
  getForward(out) {
    return out.set(0, 0, 1).applyQuaternion(this.quat);
  }
  getUp(out) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }
  getLeft(out) {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }
}
