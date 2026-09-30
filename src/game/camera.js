// Chase / hood / bumper / cockpit cameras.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { clamp, damp, dampAngle, wrapAngle } from '../core/math.js';

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _origin = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _carUp = new THREE.Vector3();
const _right = new THREE.Vector3();
const _accel = new THREE.Vector3();

export const CAMERA_MODES = ['Chase', 'Far Chase', 'Hood', 'Bumper', 'Cockpit'];
export const COCKPIT = 4;

// The chase camera hangs off the car on a soft spring: it drops back while the car pulls
// hard and closes in under braking, so a launch reads as the car leaping away from you.
const SURGE_W = 4.2; // rad/s
const SURGE_ZETA = 0.8;
const SURGE_GAIN = 2.3; // ~1.2 m back at 1 g
// Wider view with speed, most of it arriving early (0-150 km/h), plus a kick while accelerating.
const speedFov = (kmh, max, scale) => max * (1 - Math.exp(-Math.max(kmh, 0) / scale));

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.lag = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.baseFov = 62;
    this.fov = 62;
    this.lookBack = false;
    this.initialized = false;
    this.orbitAngle = 0;
    this.pitchFollow = 0;
    this.accelLong = 0; // smoothed longitudinal acceleration, m/s^2
    this.accelFov = 0;
    this.surge = 0;
    this.surgeVel = 0;
    this.blur = 0; // radial speed blur for the post pass (0..1)
    this.cinematic = null;
    // in-car head motion (metres / radians), smoothed
    this.head = new THREE.Vector3();
    this.headYaw = 0;
    this.headPitch = 0;
    this.prevVelocity = new THREE.Vector3();
  }

  get inCar() {
    return this.mode === COCKPIT;
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.initialized = false;
  }

  addShake(a) {
    this.shake = Math.min(1.5, this.shake + a);
  }

  snap() {
    this.initialized = false;
  }

  update(dt, vehicle, world) {
    const cam = this.camera;
    const p = vehicle.root.position;
    const q = vehicle.root.quaternion;
    const phys = vehicle.physics;
    const vel = phys.vel;
    const speed = vel.length();
    _fwd.set(0, 0, 1).applyQuaternion(q);
    let heading = Math.atan2(_fwd.x, _fwd.z);
    const reversing = phys.forwardSpeed < -1.5;
    if (speed > 4 && !reversing) {
      const vh = Math.atan2(vel.x, vel.z);
      heading += clamp(wrapAngle(vh - heading), -0.9, 0.9) * 0.42;
    }
    if (this.lookBack) heading += Math.PI;
    // longitudinal acceleration from the change in forward speed
    const aRaw = this.initialized ? clamp((phys.forwardSpeed - this._lastFwd) / Math.max(dt, 1e-3), -30, 30) : 0;
    this._lastFwd = phys.forwardSpeed;
    if (!this.initialized) {
      this.yaw = heading;
      this.pitchFollow = 0;
      this.accelLong = this.accelFov = this.surge = this.surgeVel = 0;
    }
    this.accelLong = damp(this.accelLong, aRaw, 10, dt);
    const pull = clamp(this.accelLong / 9.81, 0, 1.2);
    this.accelFov = damp(this.accelFov, pull, 4, dt);
    // semi-implicit spring, sub-stepped so a long frame can't make it ring
    const drive = SURGE_GAIN * this.accelLong * (this.accelLong > 0 ? 1 : 0.55);
    const steps = Math.min(8, Math.ceil(dt / 0.01));
    for (let s = 0; s < steps; s++) {
      const h = dt / steps;
      this.surgeVel += (drive - SURGE_W * SURGE_W * this.surge - 2 * SURGE_ZETA * SURGE_W * this.surgeVel) * h;
      this.surge = clamp(this.surge + this.surgeVel * h, -1.1, 2.2);
    }
    this.yaw = dampAngle(this.yaw, heading, this.mode >= 2 ? 30 : 5.2 + Math.min(speed, 40) * 0.05, dt);

    const kmh = speed * 3.6;
    let targetFov = this.baseFov;
    if (this.mode <= 1) {
      const dist = (this.mode === 0 ? 5.7 : 8.2) + Math.min(kmh, 300) * 0.0055 + this.surge;
      const height = (this.mode === 0 ? 1.75 : 2.45) - Math.min(kmh, 300) * 0.0012 - Math.max(this.surge, 0) * 0.06;
      // pitch follow on slopes
      this.pitchFollow = damp(this.pitchFollow, clamp(_fwd.y, -0.35, 0.35), 3, dt);
      const dx = Math.sin(this.yaw),
        dz = Math.cos(this.yaw);
      _tgt.set(p.x - dx * dist, p.y + height - this.pitchFollow * dist * 0.7, p.z - dz * dist);
      // stay above the ground and the water surface
      const ground = Math.max(world.height(_tgt.x, _tgt.z), WORLD.seaLevel) + 0.6;
      if (_tgt.y < ground) _tgt.y = ground;
      if (!this.initialized) this.pos.copy(_tgt);
      else {
        this.pos.x = damp(this.pos.x, _tgt.x, 18, dt);
        this.pos.z = damp(this.pos.z, _tgt.z, 18, dt);
        this.pos.y = damp(this.pos.y, _tgt.y, 9, dt);
        if (this.pos.y < ground) this.pos.y = ground;
      }
      _look.set(p.x + dx * 3.2, p.y + 0.85 - this.pitchFollow * 1.5, p.z + dz * 3.2);
      if (!this.initialized) this.lookAt.copy(_look);
      else this.lookAt.lerp(_look, 1 - Math.exp(-dt * 25));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.lookAt);
      targetFov = this.baseFov + speedFov(kmh, 15, 160) + this.accelFov * 4.5;
    } else if (this.mode === COCKPIT) {
      targetFov = this.updateCockpit(dt, vehicle, kmh);
    } else {
      // hood / bumper cams are rigidly attached with a little smoothing
      const st = vehicle.spec.style;
      const cg = phys.cgModel;
      const [vy, vz] = this.mode === 2 ? st.views.hood : st.views.bumper;
      _tgt.set(0, vy - cg.y, vz - cg.z);
      _tgt.applyQuaternion(q).add(p);
      cam.position.copy(_tgt);
      _m.lookAt(_origin, _look.set(0, 0, this.lookBack ? -1 : 1).applyQuaternion(q), _worldUp);
      // keep horizon steadier: blend roll out
      _q.setFromRotationMatrix(_m);
      cam.quaternion.copy(_q);
      targetFov = this.baseFov + 6 + speedFov(kmh, 12, 160) + this.accelFov * 3.5;
    }
    const near = this.mode === COCKPIT ? 0.04 : 0.3;
    if (cam.near !== near) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.initialized = true;
    // shake: a fine buzz from road speed and a hard-pulling engine, plus slower impact knocks
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.shakeT += dt;
    const t = this.shakeT;
    const inCar = this.mode === COCKPIT;
    const surface = phys.grounded > 0 ? phys.offroadFactor * clamp(kmh / 120, 0, 1) * 0.02 + (phys.kerbFactor || 0) * clamp(kmh / 60, 0, 1) * 0.03 : 0;
    const road = Math.pow(clamp((kmh - 20) / 280, 0, 1), 1.2) * 0.01;
    const engine = Math.min(pull, 1) * clamp(phys.throttleOut, 0, 1) * 0.004;
    const buzz = (road + surface) * (inCar ? 0.35 : 1) + engine * (inCar ? 0.8 : 1);
    const knock = this.shake * 0.08 * (inCar ? 0.35 : 1);
    if (buzz + knock > 0) {
      cam.position.x += (Math.sin(t * 71.3) + Math.sin(t * 113.9) * 0.6) * buzz * 0.5 + (Math.sin(t * 37.1) + Math.sin(t * 23.3)) * knock * 0.5;
      cam.position.y += (Math.sin(t * 83.1) + Math.sin(t * 127.3) * 0.6) * buzz * 0.5 + (Math.sin(t * 41.7) + Math.sin(t * 19.1)) * knock * 0.5;
      cam.rotation.x += Math.sin(t * 97.7) * buzz * 0.12;
      cam.rotation.z += Math.sin(t * 61.9) * buzz * 0.2 + Math.sin(t * 29.3) * knock * 0.3;
    }
    // radial blur: from town speeds up, and a touch more while the car is pulling hard
    this.blur = this.mode <= 1 ? clamp(clamp((kmh - 70) / 230, 0, 1) + Math.min(this.accelFov, 1) * clamp((kmh - 30) / 70, 0, 1) * 0.22, 0, 1) : 0;
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  // Driver's eye view. The head rides with the car but leans against g-forces, looks a
  // little into corners and keeps the horizon steadier than the chassis (as a real neck does).
  updateCockpit(dt, vehicle, kmh) {
    const cam = this.camera;
    const phys = vehicle.physics;
    const q = vehicle.root.quaternion;
    const ck = vehicle.spec.style.cockpit;
    // acceleration in the car's frame (m/s^2), from the change in velocity
    _accel.copy(phys.vel).sub(this.prevVelocity).divideScalar(Math.max(dt, 1e-3));
    this.prevVelocity.copy(phys.vel);
    if (!this.initialized) _accel.set(0, 0, 0);
    _right.set(1, 0, 0).applyQuaternion(q);
    _fwd.set(0, 0, 1).applyQuaternion(q);
    _carUp.set(0, 1, 0).applyQuaternion(q);
    const lat = clamp(_accel.dot(_right), -30, 30);
    const lon = clamp(_accel.dot(_fwd), -30, 30);
    const vert = clamp(_accel.dot(_carUp), -40, 40);
    const k = this.initialized ? 1 : 0;
    this.head.x = damp(this.head.x * k, clamp(-lat * 0.0022, -0.045, 0.045), 7, dt);
    // pressed back into the seat on a launch, thrown forward into the belts under braking
    this.head.z = damp(this.head.z * k, clamp(-lon * 0.0042, -0.065, 0.04), 7, dt);
    this.head.y = damp(this.head.y * k, clamp(-vert * 0.0012, -0.03, 0.03), 12, dt);
    // look towards where the car is turning (yaw rate), and back over the shoulder
    const yawRate = phys.angVel.dot(_carUp);
    this.headYaw = damp(this.headYaw * k, this.lookBack ? Math.PI * 0.92 : clamp(yawRate * 0.16, -0.22, 0.22), this.lookBack ? 9 : 3.5, dt);
    this.headPitch = damp(this.headPitch * k, clamp(lon * -0.0025, -0.03, 0.03), 5, dt);
    const cg = phys.cgModel;
    const [ex, ey, ez] = ck.eye;
    _tgt.set(ex + this.head.x, ey + this.head.y - cg.y, ez + this.head.z - cg.z).applyQuaternion(q).add(vehicle.root.position);
    this.camera.position.copy(_tgt);
    // orientation: car frame turned by the head, up vector partly levelled towards the world
    _look.set(Math.sin(this.headYaw), -0.06 + this.headPitch, Math.cos(this.headYaw)).applyQuaternion(q);
    _up.copy(_carUp).lerp(_worldUp, 0.3).normalize();
    _m.lookAt(_origin, _look, _up);
    cam.quaternion.setFromRotationMatrix(_m);
    return ck.fov + speedFov(kmh, 6, 170) + this.accelFov * 3;
  }

  // slow orbit around a target (menus / title / garage)
  orbit(dt, target, radius = 6.5, height = 1.3, speed = 0.12, world = null) {
    this.orbitAngle += dt * speed;
    const cam = this.camera;
    const x = target.x + Math.sin(this.orbitAngle) * radius,
      z = target.z + Math.cos(this.orbitAngle) * radius;
    let y = target.y + height;
    if (world) y = Math.max(y, Math.max(world.height(x, z), WORLD.seaLevel) + 0.5);
    cam.position.set(x, y, z);
    cam.lookAt(target.x, target.y + 0.5, target.z);
    this.fov = damp(this.fov, 42, 2, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    this.initialized = false;
  }
}
