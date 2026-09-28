// Rigid-body car simulation: raycast suspension + slip-based tyre model + drivetrain.
// Frame: +Z forward, +X left, +Y up (body space, origin at the centre of mass).
import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { torqueCurve } from './carspecs.js';
import { SURFACE_INFO } from '../world/world.js';

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
    this.steerAssist = true;
    this.tractionControl = true;
    this.abs = true;

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
    this.powerMul = 1;
    this.frozen = false;
    this.bodyContacts = 0;
    this.onRoad = true;
    this.offroadFactor = 0;

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
    }
    this.rpm = this.spec.idle || 0;
    this.gear = 1;
    this.upsideTimer = 0;
    this.airTime = 0;
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
    const rxn = _tmp2.crossVectors(_tmp, n);
    const t = new THREE.Vector3();
    this.applyInvInertia(rxn, t);
    const k = new THREE.Vector3().crossVectors(t, _tmp);
    return 1 / this.mass + n.dot(k);
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
    let t = s.peakTorque * torqueCurve(x);
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

    // ---------------- steering (speed sensitive, with countersteer assist)
    const maxSteer = 0.6 / Math.pow(1 + Math.max(0, Math.abs(vf) - 3) / 11, 0.72);
    let target = inp.steer * maxSteer;
    const latV = this.vel.dot(_left);
    const beta = Math.abs(vf) > 2 ? Math.atan2(latV, Math.abs(vf)) : 0; // body slip (+ = sliding left)
    this.slipAngleBody = beta;
    if (this.steerAssist && vf > 4) {
      // wheels follow the direction of travel when sliding
      target += clamp(-beta, -0.5, 0.5) * 0.75 * (1 - Math.abs(inp.steer) * 0.35);
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
    // turbo spool
    if (s.turbo) {
      const tgt = throttle * clamp((this.rpm - s.redline * 0.25) / (s.redline * 0.35), 0, 1);
      this.boost += (tgt - this.boost) * (1 - Math.exp(-dt * (tgt > this.boost ? 2.4 : 6)));
    }
    const wheelRpm = (Math.abs(drivenSpeed) / rWheel) * (60 / (Math.PI * 2));
    let rpmFromWheels = wheelRpm * Math.abs(ratio) * fd;
    const idle = s.idle;
    // clutch slip at low speed lets the engine rev
    const launchRpm = s.electric ? 0 : Math.min(s.redline * 0.55, idle + 3500);
    let rpmTarget = Math.max(rpmFromWheels, idle + throttle * (this.gear !== 0 && Math.abs(vf) < 8 ? launchRpm - idle : 0) * clamp(1 - Math.abs(vf) / 8, 0, 1));
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
    let engineT = this.engineTorque(Math.max(this.rpm, idle), throttle) * this.powerMul;
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
    const nWheelsDriven = this.wheels.filter((w) => w.driven && w.contact).length || drivenCount;
    let grounded = 0;
    let offroad = 0;
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
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w.contact) continue;
      const surf = SURFACE_INFO[w.surface] || SURFACE_INFO[0];
      // offroad-capable vehicles lose less grip on dirt
      const offK = surf.offroad ? lerp(surf.grip, Math.max(surf.grip, 0.93), s.offroad ?? 0.3) : surf.grip;
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
      const loadK = 1 - 0.12 * (Fz / ((this.mass * G) / 4) - 1);
      const mu = s.grip * offK * this.gripMul * clamp(loadK, 0.75, 1.15);
      const maxF = mu * Fz;
      // longitudinal
      let Fx = 0;
      let driveShare = 0;
      if (w.driven) {
        const axleShare = w.front ? frontShare : 1 - frontShare;
        const otherContact = this.wheels[i ^ 1].contact;
        driveShare = axleShare * (otherContact ? 0.5 : 1);
        if (s.drive !== 'AWD' && nWheelsDriven === 0) driveShare = 0;
      }
      const driveF = (wheelTorqueTotal * driveShare) / w.r;
      Fx += driveF;
      const brakeBias = w.front ? 0.64 : 0.36;
      let brakeF = brake * s.brake * this.mass * G * brakeBias * 0.5;
      if (this.abs && brakeF > maxF * 1.25) brakeF = maxF * 1.25;
      Fx -= clamp(vLong / 0.4, -1, 1) * brakeF;
      if (handbrake > 0 && !w.front) {
        Fx = -clamp(vLong / 0.3, -1, 1) * maxF * 0.85;
        w.locked = 1;
      } else w.locked = brakeF > maxF * 1.32 ? 1 : 0;
      Fx -= clamp(vLong, -1, 1) * 0.014 * Fz * (1 + surf.rough * 7); // rolling resistance
      // hold the car still when parked
      if (Math.abs(throttle) < 0.02 && Math.abs(vLong) < 1.2 && speed < 1.5) Fx -= clamp(vLong * 3, -1, 1) * maxF * 0.8;
      // traction limit (friction ellipse: tyres grip harder longitudinally)
      const maxFx = maxF * 1.32;
      let spinning = 0;
      if (Math.abs(Fx) > maxFx) {
        spinning = Math.min(1, (Math.abs(Fx) - maxFx) / maxFx);
        if (this.tractionControl && Math.abs(driveF) > maxFx) {
          Fx = Math.sign(Fx) * maxFx * 0.98;
          spinning *= 0.3;
        } else Fx = Math.sign(Fx) * maxFx * 0.9;
      }
      w.spinning = spinning;
      // lateral (simplified magic formula)
      const alpha = Math.atan2(vLat, Math.abs(vLong) + 0.6);
      w.slipAngle = alpha;
      const B = 10.5,
        C = 1.45;
      let latMu = mu;
      if (handbrake > 0 && !w.front) latMu *= 0.42;
      let Fy = -Fz * latMu * Math.sin(C * Math.atan(B * alpha));
      // combined slip: longitudinal force eats into lateral capacity
      const ux = Fx / maxFx;
      const fyMax = maxF * Math.sqrt(Math.max(0, 1 - ux * ux)) + maxF * 0.06;
      if (Fy > fyMax) Fy = fyMax;
      else if (Fy < -fyMax) Fy = -fyMax;
      w.slip = Math.min(1, Math.abs(alpha) * 2.2 + spinning + (w.locked ? 0.8 : 0));
      // longitudinal force at the contact patch (full pitch transfer); lateral force raised
      // toward the CG to limit roll-overs
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
    this.offroadFactor = grounded ? offroad / grounded : this.offroadFactor;
    this.onRoad = this.offroadFactor < 0.5;

    // ---------------- aerodynamics
    if (speed > 0.5) {
      const drag = 0.5 * RHO * s.CdA * speed;
      this.force.addScaledVector(this.vel, -drag);
      const down = 0.5 * RHO * s.ClA * vf * vf;
      this.force.addScaledVector(_up, -down);
    }

    // ---------------- stability helpers
    if (grounded === 0) {
      this.airTime += dt;
      // gently level the car in the air so landings are on the wheels
      _tmp.crossVectors(_up, new THREE.Vector3(0, 1, 0));
      this.torque.addScaledVector(_tmp, this.mass * 3.0);
      this.torque.addScaledVector(this.angVel, -this.mass * 0.35);
    } else {
      this.airTime = 0;
      // yaw damping at speed when not deliberately sliding (stability assist)
      if (this.steerAssist && handbrake === 0) {
        const yawRate = this.angVel.dot(_up);
        this.torque.addScaledVector(_up, -yawRate * this.mass * 0.35 * clamp(speed / 30, 0, 1));
      }
    }

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
        if (vn < -3) this.lastImpact = Math.max(this.lastImpact, -vn);
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
